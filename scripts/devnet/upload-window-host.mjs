import {
  closeSync,
  createReadStream,
  createWriteStream,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Connection, PublicKey } from "@solana/web3.js";

import {
  PLAN_UPLOAD_IDENTITIES,
} from "./plan-upload-command.mjs";
import {
  CANDIDATE_EVIDENCE_SCHEMA,
  buildCandidateEvidenceFromUploadInputs,
  candidateEvidenceSha256,
} from "./candidate-evidence.mjs";
import { createRpcRequestScheduler } from "./rpc-request-scheduler.mjs";
import {
  DEVNET_GENESIS_HASH,
  DEVNET_RPC_URL,
} from "./safety.mjs";
import {
  createPlanFingerprint,
} from "./throttled-uploader.mjs";
import {
  parseUploadProcessSupervisorArgs,
} from "./upload-process-supervisor.mjs";
import {
  planBufferUpload,
} from "./upload-plan.mjs";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SUPERVISOR_PATH = resolve(REPO_ROOT, "scripts/devnet/upload-process-supervisor.mjs");
const BINARY_PATH = resolve(REPO_ROOT, "target/sbf-solana-solana/release/oss_bounty_escrow.so");
const BUFFER_METADATA_LENGTH = 37;
const MAX_TIMER_MS = 2_147_483_647;
const MAX_TERMINAL_TAIL_BYTES = 64 * 1024;
const HOST_SCHEMA_VERSION = "UPLOAD_WINDOW_HOST_RESULT_V2";
const AUTHORIZATION_SCHEMA_VERSION = "UPLOAD_WINDOW_HOST_AUTHORIZATION_V2";
const INVOCATION_SCHEMA_VERSION = "UPLOAD_WINDOW_HOST_INVOCATION_V1";
const EXECUTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const WINDOWS_RESERVED_NAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const HEX_40 = /^[a-f0-9]{40}$/;
const HEX_64 = /^[a-f0-9]{64}$/;

const HOST_KEYS = new Set([
  "execution-id",
  "child-lifecycle-timeout-ms",
  "outer-cleanup-allowance-ms",
  "finalization-timeout-ms",
  "host-total-timeout-ms",
  "result-root",
  "expected-repository-sha",
  "expected-state-sha",
  "expected-buffer-sha",
  "expected-binary-sha",
  "expected-plan-fingerprint",
  "expected-candidate-evidence-sha",
  "expected-candidates",
  "expected-invocations",
]);

export const HOST_EXIT_CODES = Object.freeze({
  SUCCESS: 0,
  MANIFEST_FAILURE: 64,
  EXECUTION_ID_CONSUMED: 65,
  CHILD_NONZERO: 66,
  INNER_TERMINAL_MISSING: 67,
  INNER_TERMINAL_MALFORMED: 68,
  OUTER_TIMEOUT: 69,
  INTERRUPTED: 70,
  CLEANUP_FAILURE: 71,
  PERSISTENCE_FAILURE: 72,
  FINALIZATION_TIMEOUT: 73,
});

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function parsePositiveInteger(value, label, { allowZero = false } = {}) {
  if (!/^\d+$/.test(value ?? "")) throw new Error(`${label} must be an integer in milliseconds`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < (allowZero ? 0 : 1) || parsed > MAX_TIMER_MS) {
    throw new Error(`${label} is outside the supported range`);
  }
  return parsed;
}

function assertSafeExecutionId(value) {
  if (
    !EXECUTION_ID_PATTERN.test(value ?? "") ||
    value === "." ||
    value === ".." ||
    value.endsWith(".") ||
    value.endsWith(" ") ||
    WINDOWS_RESERVED_NAME.test(value)
  ) {
    throw new Error("execution ID is unsafe");
  }
}

function parseCandidateRange(value) {
  const match = /^(\d+)-(\d+)$/.exec(value ?? "");
  if (!match) throw new Error("expected-candidates must be one contiguous inclusive range");
  const first = Number(match[1]);
  const last = Number(match[2]);
  if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 0 || last < first || last - first > 1024) {
    throw new Error("expected-candidates range is invalid");
  }
  return Object.freeze(Array.from({ length: last - first + 1 }, (_, offset) => first + offset));
}

function sanitizeUrl(value) {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString().replace(/\/$/, "");
  } catch {
    return "<redacted-url>";
  }
}

export function sanitizeHostArguments(args) {
  const sanitized = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = String(args[index]);
    const previous = String(args[index - 1] ?? "");
    if (previous === "--authority" || /keypair/i.test(value)) {
      sanitized.push("<redacted-keypair-path>");
    } else if (/^https?:\/\//i.test(value)) {
      sanitized.push(sanitizeUrl(value));
    } else {
      sanitized.push(value);
    }
  }
  return Object.freeze(sanitized);
}

export function parseUploadWindowHostArgs(argv, { repoRoot = REPO_ROOT } = {}) {
  if (!Array.isArray(argv)) throw new Error("outer-host arguments are required");
  const separator = argv.indexOf("--");
  if (separator < 0 || separator === argv.length - 1) {
    throw new Error("inner supervisor command is required after --");
  }
  const optionArgs = argv.slice(0, separator);
  if (optionArgs.length % 2 !== 0) throw new Error("complete outer-host options are required");
  const values = {};
  for (let index = 0; index < optionArgs.length; index += 2) {
    const flag = optionArgs[index];
    if (!flag?.startsWith("--")) throw new Error("outer-host flags must use --name value");
    const key = flag.slice(2);
    if (!HOST_KEYS.has(key)) throw new Error(`unknown outer-host option --${key}`);
    if (Object.hasOwn(values, key)) throw new Error(`duplicate outer-host option --${key}`);
    values[key] = optionArgs[index + 1];
  }
  for (const key of HOST_KEYS) {
    if (!Object.hasOwn(values, key) || values[key] === "") {
      const label = key === "execution-id"
        ? "execution ID"
        : key === "expected-invocations"
          ? "expected-invocations"
          : `--${key}`;
      throw new Error(`${label} is required`);
    }
  }

  assertSafeExecutionId(values["execution-id"]);
  const childLifecycleTimeoutMs = parsePositiveInteger(
    values["child-lifecycle-timeout-ms"],
    "child lifecycle timeout",
  );
  const outerCleanupAllowanceMs = parsePositiveInteger(
    values["outer-cleanup-allowance-ms"],
    "outer cleanup allowance",
  );
  const finalizationTimeoutMs = parsePositiveInteger(
    values["finalization-timeout-ms"],
    "finalization timeout",
  );
  const hostTotalTimeoutMs = parsePositiveInteger(
    values["host-total-timeout-ms"],
    "total host timeout",
  );
  const expectedInvocations = parsePositiveInteger(values["expected-invocations"], "expected-invocations");
  if (expectedInvocations !== 1) throw new Error("expected-invocations must equal exactly one");

  const innerCommand = argv[separator + 1];
  const innerArgs = argv.slice(separator + 2);
  if (resolve(innerCommand) !== resolve(process.execPath)) {
    throw new Error("inner supervisor must use the current Node executable");
  }
  if (innerArgs.length < 2 || resolve(repoRoot, innerArgs[0]) !== resolve(repoRoot, "scripts/devnet/upload-process-supervisor.mjs")) {
    throw new Error("inner supervisor path is invalid");
  }
  const parsedSupervisor = parseUploadProcessSupervisorArgs(innerArgs.slice(1));
  if (childLifecycleTimeoutMs <= parsedSupervisor.timeoutMs + parsedSupervisor.cleanupTimeoutMs) {
    throw new Error("child lifecycle timeout must outlive inner runtime and cleanup");
  }
  const minimumCompleteBudget =
    parsedSupervisor.timeoutMs +
    parsedSupervisor.cleanupTimeoutMs +
    outerCleanupAllowanceMs +
    finalizationTimeoutMs;
  if (
    hostTotalTimeoutMs <= minimumCompleteBudget ||
    hostTotalTimeoutMs <=
      childLifecycleTimeoutMs + outerCleanupAllowanceMs + finalizationTimeoutMs
  ) {
    throw new Error("total host timeout arithmetic is invalid");
  }

  const hashes = {
    repository: values["expected-repository-sha"],
    state: values["expected-state-sha"],
    buffer: values["expected-buffer-sha"],
    binary: values["expected-binary-sha"],
    planFingerprint: values["expected-plan-fingerprint"],
    candidateEvidence: values["expected-candidate-evidence-sha"],
  };
  if (!HEX_40.test(hashes.repository)) throw new Error("expected repository SHA is invalid");
  for (const [label, value] of Object.entries(hashes).filter(([key]) => key !== "repository")) {
    if (!HEX_64.test(value)) throw new Error(`expected ${label} SHA is invalid`);
  }
  const expectedCandidates = parseCandidateRange(values["expected-candidates"]);
  if (expectedCandidates.length !== parsedSupervisor.uploaderArgs[parsedSupervisor.uploaderArgs.indexOf("--max-chunks") + 1] * 1) {
    throw new Error("expected-candidates count must equal the inner max-chunks value");
  }

  const resultRoot = values["result-root"];
  if (resultRoot.includes("\0")) throw new Error("result root is invalid");
  const resolvedResultRoot = resolve(repoRoot, resultRoot);
  const statePath = resolve(repoRoot, parsedSupervisor.statePath);
  if (
    resolvedResultRoot === `${statePath}.upload-lease` ||
    relative(`${statePath}.upload-lease`, resolvedResultRoot).split(/[\\/]/)[0] !== ".."
  ) {
    throw new Error("result root must remain outside upload-lease lifecycle");
  }

  return Object.freeze({
    executionId: values["execution-id"],
    childLifecycleTimeoutMs,
    outerCleanupAllowanceMs,
    finalizationTimeoutMs,
    hostTotalTimeoutMs,
    resultRoot,
    resolvedResultRoot,
    expectedInvocations,
    innerCommand: process.execPath,
    innerArgs: Object.freeze([...innerArgs]),
    innerRuntimeTimeoutMs: parsedSupervisor.timeoutMs,
    innerCleanupTimeoutMs: parsedSupervisor.cleanupTimeoutMs,
    supervisorRequest: parsedSupervisor,
    manifest: Object.freeze({
      expectedRepositorySha: hashes.repository,
      expectedStateSha: hashes.state,
      expectedBufferSha: hashes.buffer,
      expectedBinarySha: hashes.binary,
      expectedPlanFingerprint: hashes.planFingerprint,
      expectedCandidateEvidenceSha: hashes.candidateEvidence,
      expectedCandidates,
      expectedInvocations,
    }),
  });
}

function runGit(repoRoot, args) {
  const result = spawnSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) throw new Error(`Git verification failed: git ${args[0]}`);
  return result.stdout.trim();
}

async function collectRepositorySnapshotProduction(repoRoot, resultRoot) {
  const root = resolve(runGit(repoRoot, ["rev-parse", "--show-toplevel"]));
  const branch = runGit(repoRoot, ["branch", "--show-current"]);
  const head = runGit(repoRoot, ["rev-parse", "HEAD"]);
  const originMain = runGit(repoRoot, ["rev-parse", "origin/main"]);
  const [behindText, aheadText] = runGit(repoRoot, ["rev-list", "--left-right", "--count", "origin/main...HEAD"]).split(/\s+/);
  const clean = runGit(repoRoot, ["status", "--porcelain=v1", "--untracked-files=all"]) === "";
  const gitDirectory = resolve(repoRoot, runGit(repoRoot, ["rev-parse", "--git-dir"]));
  const gitOperationActive = [
    "MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "BISECT_LOG",
    "index.lock", "shallow.lock", "rebase-merge", "rebase-apply",
  ].some((entry) => existsSync(join(gitDirectory, entry)));
  const ignored = spawnSync("git", ["check-ignore", "-q", "--no-index", resultRoot], {
    cwd: repoRoot,
    windowsHide: true,
    shell: false,
  }).status === 0;
  return {
    root,
    branch,
    head,
    originMain,
    behind: Number(behindText),
    ahead: Number(aheadText),
    clean,
    gitOperationActive,
    resultRootIgnored: ignored,
  };
}

async function retainedProcessCountProduction({ statePath, stateArgument, program, buffer }) {
  const command = process.platform === "win32"
    ? ["powershell", ["-NoProfile", "-NonInteractive", "-Command", "Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress"]]
    : ["ps", ["-eo", "pid=,args="]];
  const result = spawnSync(command[0], command[1], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) throw new Error("retained uploader process inspection failed");
  const pattern = /upload-process-supervisor\.mjs|upload-buffer-cli\.mjs/;
  const normalizedStatePath = resolve(statePath).replaceAll("\\", "/").toLowerCase();
  const normalizedStateArgument = String(stateArgument).replaceAll("\\", "/").toLowerCase();
  const isOwnedUpload = (commandLine) => {
    const normalized = String(commandLine ?? "").replaceAll("\\", "/").toLowerCase();
    return pattern.test(normalized) &&
      normalized.includes(program.toLowerCase()) &&
      normalized.includes(buffer.toLowerCase()) &&
      (normalized.includes(normalizedStatePath) || normalized.includes(normalizedStateArgument));
  };
  if (process.platform === "win32") {
    const parsed = result.stdout.trim() ? JSON.parse(result.stdout) : [];
    return (Array.isArray(parsed) ? parsed : [parsed]).filter((entry) =>
      entry?.ProcessId !== process.pid && isOwnedUpload(entry?.CommandLine)).length;
  }
  return result.stdout.split(/\r?\n/).filter((line) => {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    return match && Number(match[1]) !== process.pid && isOwnedUpload(match[2]);
  }).length;
}

async function verifyFinalizedBufferProduction({ requestTimeoutMs } = {}) {
  const scheduler = createRpcRequestScheduler({ requestTimeoutMs });
  const connection = new Connection(DEVNET_RPC_URL, {
    commitment: "finalized",
    disableRetryOnRateLimit: true,
  });
  const schedule = (methodClass, operation) => scheduler.schedule({
    methodClass,
    mutationCapability: "read",
    signaturePersisted: false,
  }, operation);
  try {
    const genesis = await schedule("GET_GENESIS_HASH", () => connection.getGenesisHash());
    if (genesis !== DEVNET_GENESIS_HASH) throw new Error("devnet genesis mismatch");
    const account = await schedule("GET_ACCOUNT_INFO", () =>
      connection.getAccountInfo(new PublicKey(PLAN_UPLOAD_IDENTITIES.buffer), "finalized"));
    if (!account) throw new Error("canonical buffer is absent");
    return {
      sha256: sha256(account.data),
      data: Buffer.from(account.data),
      owner: account.owner.toBase58(),
      rpcSummary: scheduler.ledger.summary(),
    };
  } finally {
    await scheduler.close();
  }
}

export async function verifyAuthorizationManifest(parsed, adapters = {}) {
  const repoRoot = resolve(adapters.repoRoot ?? REPO_ROOT);
  const collectRepositorySnapshot = adapters.collectRepositorySnapshot ?? collectRepositorySnapshotProduction;
  const snapshot = await collectRepositorySnapshot(repoRoot, parsed.resolvedResultRoot);
  if (resolve(snapshot.root) !== repoRoot) throw new Error("repository root mismatch");
  if (snapshot.branch !== "main") throw new Error("repository branch mismatch");
  if (snapshot.head !== parsed.manifest.expectedRepositorySha) throw new Error("repository SHA mismatch");
  if (snapshot.originMain !== parsed.manifest.expectedRepositorySha) throw new Error("origin/main SHA mismatch");
  if (snapshot.ahead !== 0 || snapshot.behind !== 0) throw new Error("repository ahead/behind mismatch");
  if (!snapshot.clean) throw new Error("worktree is dirty");
  if (snapshot.gitOperationActive) throw new Error("Git operation state is active");
  if (snapshot.resultRootIgnored !== true) throw new Error("result root must be ignored by Git");

  const statePath = resolve(repoRoot, parsed.supervisorRequest.statePath);
  const binaryPath = resolve(repoRoot, "target/sbf-solana-solana/release/oss_bounty_escrow.so");
  const pathExists = adapters.pathExists ?? existsSync;
  if (pathExists(`${statePath}.upload-lease`)) throw new Error("upload lease already exists");
  if (pathExists(`${statePath}.upload-lease-operation-lock`)) throw new Error("upload operation lock already exists");
  const retainedProcessCount = adapters.retainedProcessCount ?? retainedProcessCountProduction;
  if (await retainedProcessCount({
    repoRoot,
    statePath,
    stateArgument: parsed.supervisorRequest.statePath,
    program: PLAN_UPLOAD_IDENTITIES.program,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
  }) !== 0) throw new Error("retained uploader process exists");

  const readStateBytes = adapters.readStateBytes ?? ((path) => readFileSync(path));
  const readBinaryBytes = adapters.readBinaryBytes ?? ((path) => readFileSync(path));
  const hash = adapters.sha256 ?? sha256;
  const stateBytes = readStateBytes(statePath);
  const binaryBytes = readBinaryBytes(binaryPath);
  if (hash(stateBytes) !== parsed.manifest.expectedStateSha) throw new Error("state SHA mismatch");
  if (hash(binaryBytes) !== parsed.manifest.expectedBinarySha) throw new Error("binary SHA mismatch");
  let state;
  try {
    state = JSON.parse(Buffer.from(stateBytes).toString("utf8"));
  } catch {
    throw new Error("state JSON is invalid");
  }
  if (state?.schemaVersion !== 3) throw new Error("state schema mismatch");
  const buffer = state.deployment?.buffer;
  if (buffer?.planFingerprint !== parsed.manifest.expectedPlanFingerprint) {
    throw new Error("plan fingerprint mismatch");
  }
  const records = buffer?.chunks;
  if (!Array.isArray(records)) throw new Error("candidate plan is absent");
  const expected = parsed.manifest.expectedCandidates;
  const firstEligible = records.findIndex((record) => record?.status === "PLANNED" && record?.signature === null);
  if (firstEligible !== expected[0]) throw new Error("candidate range is not the first eligible range");
  for (let position = 0; position < expected.length; position += 1) {
    const index = expected[position];
    const record = records[index];
    if (!record || record.index !== index || record.status !== "PLANNED" || record.signature !== null) {
      throw new Error("candidate mismatch");
    }
    if (
      !Number.isSafeInteger(record.offset) || record.offset < 0 ||
      !Number.isSafeInteger(record.length) || record.length < 1 ||
      record.offset + record.length > binaryBytes.length ||
      hash(Buffer.from(binaryBytes).subarray(record.offset, record.offset + record.length)) !== record.sha256
    ) {
      throw new Error("candidate payload mismatch");
    }
    if (position > 0) {
      const previous = records[expected[position - 1]];
      if (record.offset !== previous.offset + previous.length) throw new Error("candidate contiguity mismatch");
    }
  }

  const buildCandidateDigest = adapters.buildCandidateEvidenceDigest ??
    ((input) => {
      const evidence = buildCandidateEvidenceFromUploadInputs(input);
      return {
        schema: CANDIDATE_EVIDENCE_SCHEMA,
        sha256: candidateEvidenceSha256(evidence),
      };
    });
  const candidateEvidence = buildCandidateDigest({
    stateBytes,
    binaryBytes,
    candidateIndexes: expected,
    buffer: PLAN_UPLOAD_IDENTITIES.buffer,
    authority: PLAN_UPLOAD_IDENTITIES.authority,
  });
  if (
    candidateEvidence?.schema !== CANDIDATE_EVIDENCE_SCHEMA ||
    candidateEvidence?.sha256 !== parsed.manifest.expectedCandidateEvidenceSha
  ) {
    throw new Error("candidate evidence digest mismatch");
  }

  const verifyFinalizedBuffer = adapters.verifyFinalizedBuffer ?? verifyFinalizedBufferProduction;
  const finalized = await verifyFinalizedBuffer({
    requestTimeoutMs: parsed.supervisorRequest.requestTimeoutMs,
  });
  if (finalized.sha256 !== parsed.manifest.expectedBufferSha) throw new Error("buffer SHA mismatch");
  if (finalized.data) {
    if (finalized.owner !== PLAN_UPLOAD_IDENTITIES.loader) throw new Error("buffer owner mismatch");
    const onchainPayload = Buffer.from(finalized.data).subarray(BUFFER_METADATA_LENGTH);
    const plan = planBufferUpload({
      localBytes: Buffer.from(binaryBytes),
      bufferBytes: onchainPayload,
      buffer: new PublicKey(PLAN_UPLOAD_IDENTITIES.buffer),
      authority: new PublicKey(PLAN_UPLOAD_IDENTITIES.authority),
    });
    const fingerprint = createPlanFingerprint({
      program: PLAN_UPLOAD_IDENTITIES.program,
      buffer: PLAN_UPLOAD_IDENTITIES.buffer,
      authority: PLAN_UPLOAD_IDENTITIES.authority,
      allocation: finalized.data.length,
      binarySha256: hash(binaryBytes),
      maxPayload: plan.maxPayload,
      chunks: plan.chunks,
    });
    if (fingerprint !== parsed.manifest.expectedPlanFingerprint) throw new Error("finalized plan fingerprint mismatch");
    for (const index of expected) {
      const record = records[index];
      const chunk = plan.chunks[index];
      if (!chunk || chunk.offset !== record.offset || chunk.length !== record.length || chunk.sha256 !== record.sha256) {
        throw new Error("finalized candidate plan mismatch");
      }
    }
  }

  return Object.freeze({
    ...parsed.manifest,
    repositoryRoot: repoRoot,
    branch: snapshot.branch,
    head: snapshot.head,
    originMain: snapshot.originMain,
    ahead: snapshot.ahead,
    behind: snapshot.behind,
    statePath: relative(repoRoot, statePath).replaceAll("\\", "/"),
    binaryPath: relative(repoRoot, binaryPath).replaceAll("\\", "/"),
    candidateIndexes: Object.freeze([...expected]),
    candidateEvidence: Object.freeze({ ...candidateEvidence }),
    finalizedBufferRpcSummary: finalized.rpcSummary ?? null,
    verifiedAt: new Date().toISOString(),
  });
}

export function writeJsonAtomic(path, value, adapters = {}) {
  const open = adapters.openSync ?? openSync;
  const write = adapters.writeFileSync ?? writeFileSync;
  const fsync = adapters.fsyncSync ?? fsyncSync;
  const close = adapters.closeSync ?? closeSync;
  const rename = adapters.renameSync ?? renameSync;
  const unlink = adapters.unlinkSync ?? unlinkSync;
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}.tmp`);
  let descriptor = null;
  try {
    descriptor = open(temporary, "wx");
    write(descriptor, `${JSON.stringify(value, null, 2)}\n`);
    fsync(descriptor);
    close(descriptor);
    descriptor = null;
    rename(temporary, path);
    try {
      const directoryDescriptor = open(dirname(path), "r");
      try {
        fsync(directoryDescriptor);
      } finally {
        close(directoryDescriptor);
      }
    } catch (error) {
      if (!["EISDIR", "EPERM", "EACCES", "EINVAL"].includes(error?.code)) throw error;
    }
  } catch (error) {
    if (descriptor !== null) {
      try { close(descriptor); } catch {}
    }
    try {
      if (existsSync(temporary)) unlink(temporary);
    } catch {}
    throw error;
  }
}

function fsyncDirectory(path) {
  try {
    const descriptor = openSync(path, "r");
    try {
      fsyncSync(descriptor);
    } finally {
      closeSync(descriptor);
    }
  } catch (error) {
    if (!["EISDIR", "EPERM", "EACCES", "EINVAL"].includes(error?.code)) throw error;
  }
}

function fsyncFile(path) {
  const descriptor = openSync(path, "r+");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function defaultTerminateOwnedTree({ pid, force, timeoutMs }) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error("owned child PID is invalid");
  if (process.platform === "win32") {
    const args = ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
    return new Promise((resolvePromise, rejectPromise) => {
      let completed = false;
      const killer = spawn("taskkill", args, {
        stdio: "ignore",
        windowsHide: true,
        shell: false,
      });
      killer.unref();
      const helperTimer = setTimeout(() => {
        if (completed) return;
        completed = true;
        try { killer.kill(); } catch {}
        rejectPromise(new Error("owned Windows process-tree cleanup helper timed out"));
      }, timeoutMs);
      helperTimer.unref?.();
      killer.once("error", (error) => {
        if (completed) return;
        completed = true;
        clearTimeout(helperTimer);
        rejectPromise(error);
      });
      killer.once("close", (exitCode) => {
        if (completed) return;
        completed = true;
        clearTimeout(helperTimer);
        if (exitCode === 0 || exitCode === 128) resolvePromise();
        else rejectPromise(new Error("owned Windows process-tree cleanup failed"));
      });
    });
  }
  try {
    process.kill(-pid, force ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
  return Promise.resolve();
}

function waitForWritableClose(stream) {
  if (stream.closed) return Promise.resolve();
  return new Promise((resolvePromise, rejectPromise) => {
    stream.once("close", resolvePromise);
    stream.once("error", rejectPromise);
  });
}

export function runOwnedHostChild({
  command,
  args,
  cwd,
  stdoutPath,
  stderrPath,
  outerTimeoutMs,
  cleanupAllowanceMs,
  finalizationTimeoutMs = outerTimeoutMs,
  shell = false,
  onSpawn = () => {},
  terminateOwnedTree = defaultTerminateOwnedTree,
  spawnProcess = spawn,
  createLogWriteStream = createWriteStream,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  monotonicNow = () => performance.now(),
}) {
  return new Promise((resolvePromise, rejectPromise) => {
    let stdoutDescriptor = null;
    let stderrDescriptor = null;
    try {
      stdoutDescriptor = openSync(stdoutPath, "wx");
      stderrDescriptor = openSync(stderrPath, "wx");
    } catch (error) {
      if (stdoutDescriptor !== null) closeSync(stdoutDescriptor);
      if (stderrDescriptor !== null) closeSync(stderrDescriptor);
      try { if (existsSync(stdoutPath)) unlinkSync(stdoutPath); } catch {}
      try { if (existsSync(stderrPath)) unlinkSync(stderrPath); } catch {}
      rejectPromise(error);
      return;
    }
    const stdoutFile = createLogWriteStream(stdoutPath, { fd: stdoutDescriptor, autoClose: true });
    const stderrFile = createLogWriteStream(stderrPath, { fd: stderrDescriptor, autoClose: true });
    const childLifecycleStartedMonotonicMs = monotonicNow();
    let child;
    try {
      child = spawnProcess(command, args, {
        cwd,
        shell,
        windowsHide: true,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      stdoutFile.end();
      stderrFile.end();
      void Promise.allSettled([
        waitForWritableClose(stdoutFile),
        waitForWritableClose(stderrFile),
      ]).then(() => resolvePromise({
        pid: null,
        spawnObserved: false,
        spawnFailed: true,
        exitCode: null,
        signal: null,
        outerTimedOut: false,
        interrupted: false,
        cleanupCompleted: true,
        logPersistenceFailed: false,
        invocationEvidenceFailed: false,
        errorSummary: safeErrorSummary(error),
      }));
      return;
    }
    let outerTimedOut = false;
    let interrupted = false;
    let spawned = false;
    let spawnFailed = false;
    let childClosed = false;
    let childExitCode = null;
    let childSignal = null;
    let childClosedMonotonicMs = null;
    let terminationStarted = false;
    let logPersistenceFailed = false;
    let invocationEvidenceFailed = false;
    let childError = null;
    let forceTimer = null;
    let cleanupDeadlineTimer = null;
    let settled = false;
    let finishing = false;
    let cleanupDeadlineExpired = false;
    let cleanupStartedMonotonicMs = null;
    let logClosureElapsedMs = 0;
    let finalizationTimedOut = false;

    child.stdout.pipe(stdoutFile);
    child.stderr.pipe(stderrFile);

    const clearLifecycle = () => {
      clearTimer(outerTimer);
      if (forceTimer) clearTimer(forceTimer);
      if (cleanupDeadlineTimer) clearTimer(cleanupDeadlineTimer);
      process.off("SIGINT", onSigint);
      process.off("SIGTERM", onSigterm);
    };

    const closeLogStreams = ({ force = false } = {}) => {
      if (force) {
        child.stdout.unpipe(stdoutFile);
        child.stderr.unpipe(stderrFile);
        child.stdout.destroy();
        child.stderr.destroy();
        stdoutFile.destroy();
        stderrFile.destroy();
      } else {
        if (!stdoutFile.closed && !stdoutFile.writableEnded) stdoutFile.end();
        if (!stderrFile.closed && !stderrFile.writableEnded) stderrFile.end();
      }
    };

    const finish = async ({ cleanupCompleted, forceCloseLogs = false } = {}) => {
      if (settled) return;
      if (childClosed) clearLifecycle();
      closeLogStreams({ force: forceCloseLogs });
      if (finishing) return;
      finishing = true;
      const logClosureStartedMonotonicMs = monotonicNow();
      const closure = Promise.allSettled([
        waitForWritableClose(stdoutFile),
        waitForWritableClose(stderrFile),
      ]);
      let logDeadlineTimer;
      const logDeadline = new Promise((resolveDeadline) => {
        logDeadlineTimer = setTimer(
          () => resolveDeadline("TIMEOUT"),
          finalizationTimeoutMs,
        );
        logDeadlineTimer.unref?.();
      });
      if (await Promise.race([closure.then(() => "CLOSED"), logDeadline]) === "TIMEOUT") {
        finalizationTimedOut = true;
        closeLogStreams({ force: true });
        await closure;
      }
      clearTimer(logDeadlineTimer);
      logClosureElapsedMs = Math.max(
        0,
        monotonicNow() - logClosureStartedMonotonicMs,
      );
      if (settled) return;
      settled = true;
      clearLifecycle();
      resolvePromise({
        pid: spawned ? child.pid : null,
        spawnObserved: spawned,
        spawnFailed,
        exitCode: childExitCode,
        signal: childSignal,
        outerTimedOut,
        interrupted,
        cleanupCompleted: cleanupCompleted && !cleanupDeadlineExpired,
        logPersistenceFailed,
        invocationEvidenceFailed,
        finalizationTimedOut,
        errorSummary: childError ? safeErrorSummary(childError) : null,
        stageElapsedMs: Object.freeze({
          childLifecycleMs: Math.max(
            0,
            (cleanupStartedMonotonicMs ?? childClosedMonotonicMs ?? monotonicNow()) -
              childLifecycleStartedMonotonicMs,
          ),
          outerCleanupMs: cleanupStartedMonotonicMs === null
            ? 0
            : Math.max(0, monotonicNow() - cleanupStartedMonotonicMs),
          stdoutStderrClosureMs: logClosureElapsedMs,
        }),
      });
    };

    const beginTermination = (reason) => {
      if (settled || terminationStarted) return;
      terminationStarted = true;
      cleanupStartedMonotonicMs = monotonicNow();
      if (reason === "timeout") outerTimedOut = true;
      else if (reason === "interrupt") interrupted = true;
      const escalationDelayMs = Math.floor(cleanupAllowanceMs / 2);
      forceTimer = setTimer(() => {
        if (settled || childClosed || !spawned) return;
        void Promise.resolve(terminateOwnedTree({
          pid: child.pid,
          force: true,
          timeoutMs: Math.max(1, cleanupAllowanceMs - escalationDelayMs),
        }))
          .catch((error) => { childError ??= error; });
      }, escalationDelayMs);
      forceTimer.unref?.();
      cleanupDeadlineTimer = setTimer(() => {
        if (settled) return;
        cleanupDeadlineExpired = true;
        if (!childClosed) child.unref?.();
        void finish({ cleanupCompleted: childClosed, forceCloseLogs: true });
      }, cleanupAllowanceMs);
      cleanupDeadlineTimer.unref?.();
      if (spawned && !childClosed) {
        void Promise.resolve(terminateOwnedTree({
          pid: child.pid,
          force: false,
          timeoutMs: Math.max(1, escalationDelayMs),
        }))
          .catch((error) => { childError ??= error; });
      }
    };

    const outerTimer = setTimer(() => beginTermination("timeout"), outerTimeoutMs);
    outerTimer.unref?.();
    const onSigint = () => beginTermination("interrupt");
    const onSigterm = () => beginTermination("interrupt");
    process.once("SIGINT", onSigint);
    process.once("SIGTERM", onSigterm);

    const onLogError = (error) => {
      logPersistenceFailed = true;
      childError ??= error;
      beginTermination("persistence");
    };
    stdoutFile.once("error", onLogError);
    stderrFile.once("error", onLogError);

    child.once("spawn", () => {
      if (settled) return;
      spawned = true;
      try {
        onSpawn({ pid: child.pid });
      } catch (error) {
        invocationEvidenceFailed = true;
        childError ??= error;
        beginTermination("persistence");
      }
    });

    child.once("error", (error) => {
      if (settled) return;
      childError ??= error;
      if (!spawned) {
        spawnFailed = true;
        child.stdout.unpipe(stdoutFile);
        child.stderr.unpipe(stderrFile);
        child.stdout.destroy();
        child.stderr.destroy();
        void finish({ cleanupCompleted: true, forceCloseLogs: true });
      } else {
        beginTermination("persistence");
      }
    });
    child.once("close", (exitCode, signal) => {
      if (settled) return;
      childClosed = true;
      childClosedMonotonicMs = monotonicNow();
      childExitCode = exitCode;
      childSignal = signal;
      void finish({ cleanupCompleted: true });
    });
  });
}

function readBoundedTail(path, maximumBytes = MAX_TERMINAL_TAIL_BYTES) {
  const size = statSync(path).size;
  if (size === 0) return "";
  const length = Math.min(size, maximumBytes);
  const buffer = Buffer.alloc(length);
  const descriptor = openSync(path, "r");
  try {
    readSync(descriptor, buffer, 0, length, size - length);
  } finally {
    closeSync(descriptor);
  }
  return buffer.toString("utf8");
}

function hasExactKeys(value, keys) {
  return Object.keys(value).sort().join("\0") === [...keys].sort().join("\0");
}

function isValidSupervisorTerminal(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  if (value.classification === "UPLOAD_PROCESS_EXITED") {
    return hasExactKeys(value, [
      "classification", "uploaderInvocationCount", "childExitCode", "childSignal",
      "innerRuntimeTimeoutMs", "innerCleanupTimeoutMs", "timerOrigin",
      "runtimeElapsedMs", "cleanupElapsedMs", "cleanupCompleted",
    ]) &&
      value.uploaderInvocationCount === 1 &&
      (value.childExitCode === null || Number.isSafeInteger(value.childExitCode)) &&
      (value.childSignal === null || typeof value.childSignal === "string") &&
      Number.isSafeInteger(value.innerRuntimeTimeoutMs) &&
      Number.isSafeInteger(value.innerCleanupTimeoutMs) &&
      value.timerOrigin === "IMMEDIATELY_BEFORE_CHILD_SPAWN" &&
      (value.runtimeElapsedMs === null || Number.isFinite(value.runtimeElapsedMs)) &&
      (value.cleanupElapsedMs === null || Number.isFinite(value.cleanupElapsedMs)) &&
      typeof value.cleanupCompleted === "boolean";
  }
  if (
    value.classification === "UPLOAD_TIMEOUT_ACTIVE_LEASE_BLOCKED" ||
    value.classification === "UPLOAD_TIMEOUT_PRE_LEASE_NOOP_BLOCKED"
  ) {
    return hasExactKeys(value, [
      "classification", "terminal", "retryable", "replayAllowed",
      "uploaderInvocationCount", "executionId", "lease", "telemetry",
      "perChunkResults", "childExitCode", "childSignal",
      "innerRuntimeTimeoutMs", "innerCleanupTimeoutMs", "timerOrigin",
      "runtimeElapsedMs", "cleanupElapsedMs", "cleanupCompleted",
    ]) &&
      value.terminal === true &&
      value.retryable === false &&
      value.replayAllowed === false &&
      value.uploaderInvocationCount === 1 &&
      value.executionId === null &&
      (value.lease === "ACTIVE" || value.lease === "ABSENT") &&
      (value.telemetry === "PRESERVE_EXISTING" || value.telemetry === "UNAVAILABLE") &&
      Array.isArray(value.perChunkResults) &&
      value.perChunkResults.length === 0 &&
      (value.childExitCode === null || Number.isSafeInteger(value.childExitCode)) &&
      (value.childSignal === null || typeof value.childSignal === "string") &&
      Number.isSafeInteger(value.innerRuntimeTimeoutMs) &&
      Number.isSafeInteger(value.innerCleanupTimeoutMs) &&
      value.timerOrigin === "IMMEDIATELY_BEFORE_CHILD_SPAWN" &&
      (value.runtimeElapsedMs === null || Number.isFinite(value.runtimeElapsedMs)) &&
      (value.cleanupElapsedMs === null || Number.isFinite(value.cleanupElapsedMs)) &&
      typeof value.cleanupCompleted === "boolean";
  }
  return false;
}

function parseInnerTerminal(path) {
  const tail = readBoundedTail(path).trim();
  if (tail === "") return { status: "MISSING", value: null };
  let sawJsonShape = false;
  for (let index = tail.lastIndexOf("{"); index >= 0;) {
    sawJsonShape = true;
    try {
      const value = JSON.parse(tail.slice(index));
      if (isValidSupervisorTerminal(value)) {
        return { status: "VALID", value };
      }
    } catch {}
    if (index === 0) break;
    index = tail.lastIndexOf("{", index - 1);
  }
  return { status: sawJsonShape ? "MALFORMED" : "MISSING", value: null };
}

async function logEvidence(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return Object.freeze({
    path: resolve(path),
    bytes: statSync(path).size,
    sha256: hash.digest("hex"),
  });
}

function safeErrorSummary(error) {
  const message = String(error?.message ?? error ?? "host operation failed");
  if (/repository|worktree|state|buffer|binary|candidate|plan|lease|lock|process|result root|Git operation/i.test(message)) {
    return message.replace(/https?:\/\/\S+/gi, "<redacted-url>");
  }
  return "host operation failed";
}

function preSpawnEnvelope(verdict, exitCode, errorSummary) {
  return Object.freeze({
    schemaVersion: HOST_SCHEMA_VERSION,
    verdict,
    exitCode,
    childSpawnCount: 0,
    durableResultPersisted: false,
    retryOccurred: false,
    errorSummary,
  });
}

function classifyHostResult(child, terminal) {
  if (child.logPersistenceFailed || child.invocationEvidenceFailed) {
    return ["HOST_RESULT_PERSISTENCE_FAILED", HOST_EXIT_CODES.PERSISTENCE_FAILURE];
  }
  if (child.finalizationTimedOut) {
    return ["HOST_FINALIZATION_TIMEOUT", HOST_EXIT_CODES.FINALIZATION_TIMEOUT];
  }
  if (!child.cleanupCompleted) return ["HOST_CLEANUP_FAILED", HOST_EXIT_CODES.CLEANUP_FAILURE];
  if (child.interrupted) return ["HOST_INTERRUPTED", HOST_EXIT_CODES.INTERRUPTED];
  if (child.outerTimedOut) return ["HOST_OUTER_TIMEOUT", HOST_EXIT_CODES.OUTER_TIMEOUT];
  if (child.spawnFailed) return ["HOST_CHILD_SPAWN_FAILED", HOST_EXIT_CODES.CHILD_NONZERO];
  if (terminal.status === "MISSING") return ["HOST_INNER_TERMINAL_MISSING", HOST_EXIT_CODES.INNER_TERMINAL_MISSING];
  if (terminal.status === "MALFORMED") return ["HOST_INNER_TERMINAL_MALFORMED", HOST_EXIT_CODES.INNER_TERMINAL_MALFORMED];
  if (child.exitCode !== 0) return ["HOST_CHILD_NONZERO", HOST_EXIT_CODES.CHILD_NONZERO];
  return ["HOST_CHILD_SUCCEEDED", HOST_EXIT_CODES.SUCCESS];
}

export async function runUploadWindowHost(argv, adapters = {}) {
  const repoRoot = resolve(adapters.repoRoot ?? REPO_ROOT);
  const emitNonDurable = (value) => adapters.emitEmergency?.(value);
  let parsed;
  try {
    parsed = parseUploadWindowHostArgs(argv, { repoRoot });
  } catch (error) {
    const result = preSpawnEnvelope("HOST_MANIFEST_REJECTED", HOST_EXIT_CODES.MANIFEST_FAILURE, safeErrorSummary(error));
    emitNonDurable(result);
    return result;
  }

  const verifyManifest = adapters.verifyManifest ?? verifyAuthorizationManifest;
  let verified;
  try {
    verified = await verifyManifest(parsed, { repoRoot });
  } catch (error) {
    const result = preSpawnEnvelope("HOST_MANIFEST_REJECTED", HOST_EXIT_CODES.MANIFEST_FAILURE, safeErrorSummary(error));
    emitNonDurable(result);
    return result;
  }

  const executionDirectory = join(parsed.resolvedResultRoot, parsed.executionId);
  mkdirSync(parsed.resolvedResultRoot, { recursive: true });
  try {
    mkdirSync(executionDirectory);
    const flushExecutionParent = adapters.fsyncDirectory ?? fsyncDirectory;
    flushExecutionParent(parsed.resolvedResultRoot);
  } catch (error) {
    if (error?.code === "EEXIST") {
      const result = preSpawnEnvelope("HOST_EXECUTION_ID_CONSUMED", HOST_EXIT_CODES.EXECUTION_ID_CONSUMED, "execution ID is already consumed");
      emitNonDurable(result);
      return result;
    }
    const result = preSpawnEnvelope("HOST_RESULT_PERSISTENCE_FAILED", HOST_EXIT_CODES.PERSISTENCE_FAILURE, "execution intent persistence failed");
    emitNonDurable(result);
    return result;
  }

  const now = adapters.now ?? (() => new Date().toISOString());
  const monotonicNow = adapters.monotonicNow ?? (() => performance.now());
  const hostPid = adapters.hostPid ?? process.pid;
  const startedAt = now();
  const startedMonotonicMs = monotonicNow();
  const sanitizedArgs = sanitizeHostArguments(parsed.innerArgs);
  const authorizationPath = join(executionDirectory, "authorization.json");
  const invocationPath = join(executionDirectory, "invocation.json");
  const stdoutPath = join(executionDirectory, "supervisor-stdout.log");
  const stderrPath = join(executionDirectory, "supervisor-stderr.log");
  const resultPath = join(executionDirectory, "host-result.json");
  const atomicWrite = adapters.writeJsonAtomic ?? writeJsonAtomic;
  const authorization = {
    schemaVersion: AUTHORIZATION_SCHEMA_VERSION,
    executionId: parsed.executionId,
    consumedAt: startedAt,
    hostPid,
    expectedManifest: verified,
    childLifecycleTimeoutMs: parsed.childLifecycleTimeoutMs,
    outerCleanupAllowanceMs: parsed.outerCleanupAllowanceMs,
    finalizationTimeoutMs: parsed.finalizationTimeoutMs,
    hostTotalTimeoutMs: parsed.hostTotalTimeoutMs,
    innerRuntimeTimeoutMs: parsed.innerRuntimeTimeoutMs,
    innerCleanupTimeoutMs: parsed.innerCleanupTimeoutMs,
    innerCommand: process.execPath,
    sanitizedArguments: sanitizedArgs,
    expectedInvocations: 1,
    retryAllowed: false,
  };
  try {
    atomicWrite(authorizationPath, authorization);
  } catch {
    const result = preSpawnEnvelope("HOST_RESULT_PERSISTENCE_FAILED", HOST_EXIT_CODES.PERSISTENCE_FAILURE, "authorization persistence failed");
    emitNonDurable(result);
    return result;
  }

  const revalidateManifest = adapters.revalidateManifest ??
    (adapters.verifyManifest
      ? async () => verified
      : async () => verifyAuthorizationManifest(parsed, {
        repoRoot,
        verifyFinalizedBuffer: async () => ({
          sha256: parsed.manifest.expectedBufferSha,
        }),
      }));
  try {
    await revalidateManifest(parsed, verified, { repoRoot });
  } catch (error) {
    let stdout;
    let stderr;
    try {
      writeFileSync(stdoutPath, "", { flag: "wx" });
      writeFileSync(stderrPath, "", { flag: "wx" });
      const flushLogFile = adapters.fsyncFile ?? fsyncFile;
      flushLogFile(stdoutPath);
      flushLogFile(stderrPath);
      [stdout, stderr] = await Promise.all([
        logEvidence(stdoutPath),
        logEvidence(stderrPath),
      ]);
    } catch {
      const failed = preSpawnEnvelope(
        "HOST_RESULT_PERSISTENCE_FAILED",
        HOST_EXIT_CODES.PERSISTENCE_FAILURE,
        "pre-spawn evidence persistence failed",
      );
      emitNonDurable(failed);
      return failed;
    }
    const finishedAt = now();
    const durableFailure = {
      schemaVersion: HOST_SCHEMA_VERSION,
      executionId: parsed.executionId,
      expectedManifest: verified,
      hostPid,
      childPid: null,
      childSpawnCount: 0,
      startedAt,
      finishedAt,
      monotonicDurationMs: Math.ceil(monotonicNow() - startedMonotonicMs),
      executionOriginMonotonicMs: null,
      timeoutContract: {
        innerRuntimeTimeoutMs: parsed.innerRuntimeTimeoutMs,
        innerCleanupTimeoutMs: parsed.innerCleanupTimeoutMs,
        childLifecycleTimeoutMs: parsed.childLifecycleTimeoutMs,
        outerCleanupAllowanceMs: parsed.outerCleanupAllowanceMs,
        finalizationTimeoutMs: parsed.finalizationTimeoutMs,
        hostTotalTimeoutMs: parsed.hostTotalTimeoutMs,
      },
      stageElapsedMs: {
        childLifecycleMs: 0,
        outerCleanupMs: 0,
        stdoutStderrClosureMs: 0,
        terminalParsingMs: 0,
        logHashingMs: 0,
        resultPersistenceMs: 0,
        directoryFlushMs: 0,
        finalizationMs: 0,
        totalHostMs: 0,
      },
      childLifecycleTimeoutMs: parsed.childLifecycleTimeoutMs,
      outerCleanupAllowanceMs: parsed.outerCleanupAllowanceMs,
      finalizationTimeoutMs: parsed.finalizationTimeoutMs,
      hostTotalTimeoutMs: parsed.hostTotalTimeoutMs,
      innerRuntimeTimeoutMs: parsed.innerRuntimeTimeoutMs,
      innerCleanupTimeoutMs: parsed.innerCleanupTimeoutMs,
      innerCommand: parsed.innerCommand,
      sanitizedArguments: sanitizedArgs,
      childExitCode: null,
      childSignal: null,
      outerTimedOut: false,
      interrupted: false,
      cleanupCompleted: true,
      innerTerminalStatus: "MISSING",
      innerTerminalResult: null,
      stdout,
      stderr,
      resultPath: resolve(resultPath),
      verdict: "HOST_MANIFEST_REJECTED",
      exitCode: HOST_EXIT_CODES.MANIFEST_FAILURE,
      errorSummary: safeErrorSummary(error),
      durableResultPersisted: true,
      retryOccurred: false,
    };
    try {
      atomicWrite(resultPath, durableFailure);
    } catch {
      const failed = {
        ...durableFailure,
        verdict: "HOST_RESULT_PERSISTENCE_FAILED",
        exitCode: HOST_EXIT_CODES.PERSISTENCE_FAILURE,
        errorSummary: "durable host-result persistence failed",
        durableResultPersisted: false,
      };
      emitNonDurable(failed);
      return Object.freeze(failed);
    }
    adapters.emitFinal?.(durableFailure);
    return Object.freeze(durableFailure);
  }

  let childSpawnCount = 0;
  let childPid = null;
  let child;
  const runChild = adapters.runChild ?? runOwnedHostChild;
  // Authorization persistence and final local revalidation are deliberately
  // pre-spawn. The absolute host timeline begins at the last boundary before
  // the sole authorized child creation.
  const executionOriginMonotonicMs = monotonicNow();
  try {
    child = await runChild({
      command: parsed.innerCommand,
      args: parsed.innerArgs,
      cwd: repoRoot,
      stdoutPath,
      stderrPath,
      outerTimeoutMs: parsed.childLifecycleTimeoutMs,
      cleanupAllowanceMs: parsed.outerCleanupAllowanceMs,
      finalizationTimeoutMs: parsed.finalizationTimeoutMs,
      monotonicNow,
      shell: false,
      onSpawn({ pid }) {
        childSpawnCount += 1;
        childPid = pid;
        if (childSpawnCount !== 1) throw new Error("more than one child spawn is forbidden");
        atomicWrite(invocationPath, {
          schemaVersion: INVOCATION_SCHEMA_VERSION,
          executionId: parsed.executionId,
          hostPid,
          childPid: pid,
          childSpawnCount,
          spawnedAt: now(),
          retryOccurred: false,
        });
      },
    });
  } catch (error) {
    child = {
      pid: childPid,
      exitCode: null,
      signal: null,
      outerTimedOut: false,
      interrupted: false,
      cleanupCompleted: true,
      spawnFailed: true,
      logPersistenceFailed: false,
      invocationEvidenceFailed: childSpawnCount > 0 && !existsSync(invocationPath),
      errorSummary: safeErrorSummary(error),
    };
  }
  if (!existsSync(stdoutPath)) writeFileSync(stdoutPath, "", { flag: "wx" });
  if (!existsSync(stderrPath)) writeFileSync(stderrPath, "", { flag: "wx" });
  if (childSpawnCount === 0 && child.spawnObserved === true && Number.isSafeInteger(child.pid)) {
    childSpawnCount = 1;
    childPid = child.pid;
  }

  const childFinishedMonotonicMs = monotonicNow();
  const observedLogClosureMs = child.stageElapsedMs?.stdoutStderrClosureMs ?? 0;
  const finalizationStartedMonotonicMs = Math.max(
    executionOriginMonotonicMs,
    childFinishedMonotonicMs - observedLogClosureMs,
  );
  const timeoutContract = Object.freeze({
    innerRuntimeTimeoutMs: parsed.innerRuntimeTimeoutMs,
    innerCleanupTimeoutMs: parsed.innerCleanupTimeoutMs,
    childLifecycleTimeoutMs: parsed.childLifecycleTimeoutMs,
    outerCleanupAllowanceMs: parsed.outerCleanupAllowanceMs,
    finalizationTimeoutMs: parsed.finalizationTimeoutMs,
    hostTotalTimeoutMs: parsed.hostTotalTimeoutMs,
  });
  const stageElapsedMs = {
    childLifecycleMs: child.stageElapsedMs?.childLifecycleMs ??
      Math.max(0, childFinishedMonotonicMs - executionOriginMonotonicMs),
    outerCleanupMs: child.stageElapsedMs?.outerCleanupMs ?? 0,
    stdoutStderrClosureMs: observedLogClosureMs,
    terminalParsingMs: 0,
    logHashingMs: 0,
    resultPersistenceMs: 0,
    directoryFlushMs: 0,
    finalizationMs: 0,
    totalHostMs: 0,
  };
  const finalizationExpired = () => {
    const current = monotonicNow();
    return current - finalizationStartedMonotonicMs >= parsed.finalizationTimeoutMs ||
      current - executionOriginMonotonicMs >= parsed.hostTotalTimeoutMs;
  };
  let terminal = { status: "MISSING", value: null };
  let stdout;
  let stderr;
  try {
    const flushLogFile = adapters.fsyncFile ?? fsyncFile;
    flushLogFile(stdoutPath);
    flushLogFile(stderrPath);
    const parseTerminal = adapters.parseInnerTerminal ?? parseInnerTerminal;
    const parseStarted = monotonicNow();
    terminal = await parseTerminal(stdoutPath);
    stageElapsedMs.terminalParsingMs = Math.max(0, monotonicNow() - parseStarted);
    const collectLogEvidence = adapters.logEvidence ?? logEvidence;
    const hashStarted = monotonicNow();
    [stdout, stderr] = await Promise.all([
      collectLogEvidence(stdoutPath),
      collectLogEvidence(stderrPath),
    ]);
    stageElapsedMs.logHashingMs = Math.max(0, monotonicNow() - hashStarted);
  } catch (error) {
    child.logPersistenceFailed = true;
    child.errorSummary ??= safeErrorSummary(error);
    const unavailableLog = (path) => ({
      path: resolve(path),
      bytes: existsSync(path) ? statSync(path).size : null,
      sha256: null,
    });
    stdout = unavailableLog(stdoutPath);
    stderr = unavailableLog(stderrPath);
  }
  let [verdict, exitCode] = classifyHostResult(child, terminal);
  if (finalizationExpired()) {
    verdict = "HOST_FINALIZATION_TIMEOUT";
    exitCode = HOST_EXIT_CODES.FINALIZATION_TIMEOUT;
  }
  const finishedAt = now();
  const durationMs = Math.ceil(monotonicNow() - startedMonotonicMs);
  const durableResult = {
    schemaVersion: HOST_SCHEMA_VERSION,
    executionId: parsed.executionId,
    expectedManifest: verified,
    hostPid,
    childPid,
    childSpawnCount,
    startedAt,
    finishedAt,
    monotonicDurationMs: durationMs,
    executionOriginMonotonicMs,
    timeoutContract,
    stageElapsedMs,
    childLifecycleTimeoutMs: parsed.childLifecycleTimeoutMs,
    outerCleanupAllowanceMs: parsed.outerCleanupAllowanceMs,
    finalizationTimeoutMs: parsed.finalizationTimeoutMs,
    hostTotalTimeoutMs: parsed.hostTotalTimeoutMs,
    innerRuntimeTimeoutMs: parsed.innerRuntimeTimeoutMs,
    innerCleanupTimeoutMs: parsed.innerCleanupTimeoutMs,
    innerCommand: parsed.innerCommand,
    sanitizedArguments: sanitizedArgs,
    childExitCode: child.exitCode,
    childSignal: child.signal,
    outerTimedOut: child.outerTimedOut,
    interrupted: child.interrupted,
    cleanupCompleted: child.cleanupCompleted,
    innerTerminalStatus: terminal.status,
    innerTerminalResult: terminal.value,
    stdout,
    stderr,
    resultPath: resolve(resultPath),
    verdict,
    exitCode,
    errorSummary: child.errorSummary ?? null,
    durableResultPersisted: true,
    retryOccurred: false,
  };
  const applyFinalizationTimeout = () => {
    durableResult.verdict = "HOST_FINALIZATION_TIMEOUT";
    durableResult.exitCode = HOST_EXIT_CODES.FINALIZATION_TIMEOUT;
    durableResult.errorSummary = "durable finalization exceeded its authorized allowance";
  };
  try {
    const persistStarted = monotonicNow();
    atomicWrite(resultPath, durableResult);
    stageElapsedMs.resultPersistenceMs += Math.max(0, monotonicNow() - persistStarted);
    const flushResultDirectory = adapters.fsyncDirectory ?? fsyncDirectory;
    const flushStarted = monotonicNow();
    flushResultDirectory(executionDirectory);
    stageElapsedMs.directoryFlushMs += Math.max(0, monotonicNow() - flushStarted);
    if (finalizationExpired()) applyFinalizationTimeout();
    stageElapsedMs.finalizationMs = Math.max(
      0,
      monotonicNow() - finalizationStartedMonotonicMs,
    );
    stageElapsedMs.totalHostMs = Math.max(
      0,
      monotonicNow() - executionOriginMonotonicMs,
    );
    const finalPersistStarted = monotonicNow();
    atomicWrite(resultPath, durableResult);
    stageElapsedMs.resultPersistenceMs += Math.max(
      0,
      monotonicNow() - finalPersistStarted,
    );
    if (finalizationExpired()) {
      applyFinalizationTimeout();
      stageElapsedMs.finalizationMs = Math.max(
        0,
        monotonicNow() - finalizationStartedMonotonicMs,
      );
      stageElapsedMs.totalHostMs = Math.max(
        0,
        monotonicNow() - executionOriginMonotonicMs,
      );
      atomicWrite(resultPath, durableResult);
    }
  } catch {
    const failed = {
      ...durableResult,
      verdict: "HOST_RESULT_PERSISTENCE_FAILED",
      exitCode: HOST_EXIT_CODES.PERSISTENCE_FAILURE,
      errorSummary: "durable host-result persistence failed",
      durableResultPersisted: false,
    };
    emitNonDurable(failed);
    return Object.freeze(failed);
  }
  adapters.emitFinal?.(durableResult);
  return Object.freeze(durableResult);
}

async function main() {
  const result = await runUploadWindowHost(process.argv.slice(2), {
    emitFinal(value) {
      process.stdout.write(`${JSON.stringify({
        schemaVersion: value.schemaVersion,
        executionId: value.executionId ?? null,
        verdict: value.verdict,
        exitCode: value.exitCode,
        childSpawnCount: value.childSpawnCount,
        resultPath: value.resultPath ?? null,
        durableResultPersisted: value.durableResultPersisted ?? false,
        retryOccurred: false,
      })}\n`);
    },
    emitEmergency(value) {
      process.stderr.write(`${JSON.stringify({
        schemaVersion: value.schemaVersion,
        executionId: value.executionId ?? null,
        verdict: value.verdict,
        exitCode: value.exitCode,
        childSpawnCount: value.childSpawnCount,
        invocationStatus: value.childSpawnCount === 0
          ? "NO_CHILD_SPAWN_OBSERVED"
          : "SEE_CONSUMED_EXECUTION_EVIDENCE",
        durableResultPersisted: false,
        retryOccurred: false,
      })}\n`);
    },
  });
  process.exitCode = result.exitCode;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    process.stderr.write(`${JSON.stringify({
      schemaVersion: HOST_SCHEMA_VERSION,
      verdict: "HOST_RESULT_PERSISTENCE_FAILED",
      exitCode: HOST_EXIT_CODES.PERSISTENCE_FAILURE,
      childSpawnCount: null,
      invocationStatus: "UNKNOWN_DUE_TO_UNHANDLED_HOST_FAILURE",
      durableResultPersisted: false,
      retryOccurred: false,
    })}\n`);
    process.exitCode = HOST_EXIT_CODES.PERSISTENCE_FAILURE;
  }
}
