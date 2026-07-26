import { spawnSync } from "node:child_process";
import { posix, win32 } from "node:path";

const ROLE_ENTRYPOINTS = Object.freeze({
  OUTER_HOST: "scripts/devnet/upload-window-host.mjs",
  INNER_SUPERVISOR: "scripts/devnet/upload-process-supervisor.mjs",
  UPLOADER: "scripts/devnet/upload-buffer-cli.mjs",
});

const NODE_EXECUTABLES = new Set(["node", "node.exe"]);
const MAX_DIAGNOSTICS = 16;

function asPositivePid(value) {
  const pid = Number(value);
  return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
}

function executableBasename(value) {
  const normalized = String(value ?? "").replaceAll("\\", "/");
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase();
}

function isNodeExecutable(record, argv) {
  return [
    record.executablePath,
    record.name,
    argv?.[0],
  ].some((value) => NODE_EXECUTABLES.has(executableBasename(value)));
}

function pathApi(platform) {
  return platform === "win32" ? win32 : posix;
}

function normalizePath(value, repoRoot, platform) {
  if (typeof value !== "string" || value.length === 0) return null;
  const paths = pathApi(platform);
  const normalized = paths.normalize(
    paths.isAbsolute(value) ? value : paths.resolve(repoRoot, value),
  );
  return platform === "win32" ? normalized.toLowerCase() : normalized;
}

function exactOptionValue(argv, option) {
  const index = argv.indexOf(option);
  return index >= 0 && index + 1 < argv.length ? argv[index + 1] : null;
}

function matchesWorkflowIdentity(argv, context) {
  const program = exactOptionValue(argv, "--program");
  const buffer = exactOptionValue(argv, "--buffer");
  const state = exactOptionValue(argv, "--state");
  if (program !== context.program || buffer !== context.buffer || state === null) return false;
  const normalizedState = normalizePath(state, context.repoRoot, context.platform);
  const expectedPaths = [context.statePath, context.stateArgument]
    .map((value) => normalizePath(value, context.repoRoot, context.platform))
    .filter(Boolean);
  return expectedPaths.includes(normalizedState);
}

function roleForArgv(argv, context) {
  if (!Array.isArray(argv) || argv.length < 2) return null;
  const actual = normalizePath(argv[1], context.repoRoot, context.platform);
  for (const [role, relativePath] of Object.entries(ROLE_ENTRYPOINTS)) {
    if (actual === normalizePath(relativePath, context.repoRoot, context.platform)) return role;
  }
  return null;
}

function hasProductionRoleShape(role, argv, context) {
  if (!matchesWorkflowIdentity(argv, context)) return false;
  if (role === "UPLOADER") return argv[2] === "upload-buffer-throttled";

  const separator = argv.indexOf("--");
  if (separator < 0) return false;
  if (role === "INNER_SUPERVISOR") {
    return argv[separator + 1] === "upload-buffer-throttled";
  }
  if (role === "OUTER_HOST") {
    const nestedExecutable = argv[separator + 1];
    const nestedEntrypoint = argv[separator + 2];
    return NODE_EXECUTABLES.has(executableBasename(nestedExecutable)) &&
      normalizePath(nestedEntrypoint, context.repoRoot, context.platform) ===
        normalizePath(ROLE_ENTRYPOINTS.INNER_SUPERVISOR, context.repoRoot, context.platform);
  }
  return false;
}

function metadataDiagnostic(record, argv, context) {
  const pid = asPositivePid(record.pid ?? record.ProcessId);
  const nodeIdentity = isNodeExecutable(record, argv);
  if (!argv) return null;
  const role = roleForArgv(argv, context);
  if (role && !nodeIdentity) {
    return {
      code: "EXECUTABLE_IDENTITY_UNAVAILABLE",
      pid,
      missing: ["executablePath", "name", "argv[0]"],
    };
  }
  return null;
}

function normalizedRecord(record) {
  return {
    pid: asPositivePid(record.pid ?? record.ProcessId),
    parentPid: asPositivePid(record.parentPid ?? record.ParentProcessId),
    name: record.name ?? record.Name ?? null,
    executablePath: record.executablePath ?? record.ExecutablePath ?? null,
    commandLine: record.commandLine ?? record.CommandLine ?? null,
    argv: Array.isArray(record.argv) ? record.argv.map(String) : null,
    creationTime: record.creationTime ?? record.CreationDate ?? null,
  };
}

function argvForRecord(record, platform) {
  if (record.argv) return record.argv;
  if (typeof record.commandLine !== "string" || record.commandLine.trim() === "") return null;
  return platform === "win32"
    ? parseWindowsCommandLine(record.commandLine)
    : parsePosixCommandLine(record.commandLine);
}

function stableRecordKey(record) {
  return JSON.stringify([
    record.pid,
    record.parentPid,
    record.creationTime,
    record.name,
    record.executablePath,
    record.commandLine,
    record.argv,
  ]);
}

function metadataScore(record) {
  return [
    record.parentPid,
    record.name,
    record.executablePath,
    record.commandLine,
    record.argv,
    record.creationTime,
  ].filter((value) => value !== null).length;
}

function deduplicateRecords(records) {
  const sorted = records.map(normalizedRecord).sort((left, right) => {
    const pidOrder = (left.pid ?? Number.MAX_SAFE_INTEGER) - (right.pid ?? Number.MAX_SAFE_INTEGER);
    return pidOrder ||
      metadataScore(right) - metadataScore(left) ||
      stableRecordKey(left).localeCompare(stableRecordKey(right));
  });
  const result = [];
  const seenPids = new Set();
  for (const record of sorted) {
    const key = record.pid === null ? `metadata:${stableRecordKey(record)}` : `pid:${record.pid}`;
    if (seenPids.has(key)) continue;
    seenPids.add(key);
    result.push(record);
  }
  return result;
}

export function parseWindowsCommandLine(commandLine) {
  const input = String(commandLine ?? "");
  const argv = [];
  let index = 0;

  while (index < input.length) {
    while (index < input.length && /\s/.test(input[index])) index += 1;
    if (index >= input.length) break;
    let argument = "";
    let quoted = false;

    while (index < input.length) {
      if (!quoted && /\s/.test(input[index])) break;
      if (input[index] === "\\") {
        let slashCount = 0;
        while (input[index + slashCount] === "\\") slashCount += 1;
        if (input[index + slashCount] === '"') {
          argument += "\\".repeat(Math.floor(slashCount / 2));
          if (slashCount % 2 === 1) {
            argument += '"';
          } else {
            quoted = !quoted;
          }
          index += slashCount + 1;
          continue;
        }
        argument += "\\".repeat(slashCount);
        index += slashCount;
        continue;
      }
      if (input[index] === '"') {
        if (quoted && input[index + 1] === '"') {
          argument += '"';
          index += 2;
        } else {
          quoted = !quoted;
          index += 1;
        }
        continue;
      }
      argument += input[index];
      index += 1;
    }
    argv.push(argument);
    while (index < input.length && /\s/.test(input[index])) index += 1;
  }
  return argv;
}

function parsePosixCommandLine(commandLine) {
  const argv = [];
  let current = "";
  let quote = null;
  let escaped = false;
  for (const character of String(commandLine ?? "").trim()) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (character === "\\" && quote !== "'") {
      escaped = true;
    } else if (quote && character === quote) {
      quote = null;
    } else if (!quote && (character === "'" || character === '"')) {
      quote = character;
    } else if (!quote && /\s/.test(character)) {
      if (current) {
        argv.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  if (escaped) current += "\\";
  if (current) argv.push(current);
  return argv;
}

export function classifyRetainedUploadProcess(inputRecord, inputContext) {
  const context = {
    ...inputContext,
    platform: inputContext.platform ?? process.platform,
  };
  const record = normalizedRecord(inputRecord);
  const argv = argvForRecord(record, context.platform);
  const diagnostic = metadataDiagnostic(record, argv, context);
  if (diagnostic) {
    return { pid: record.pid, role: null, conflicts: false, diagnostic };
  }
  if (!argv || !isNodeExecutable(record, argv)) {
    return { pid: record.pid, role: null, conflicts: false, diagnostic: null };
  }
  const role = roleForArgv(argv, context);
  const conflicts = record.pid !== asPositivePid(context.currentPid) &&
    role !== null &&
    hasProductionRoleShape(role, argv, context);
  return {
    pid: record.pid,
    role,
    conflicts,
    diagnostic: null,
  };
}

export function inspectRetainedUploadProcesses(records, inputContext) {
  const conflicts = [];
  const diagnostics = [];
  for (const record of deduplicateRecords(Array.isArray(records) ? records : [])) {
    const result = classifyRetainedUploadProcess(record, inputContext);
    if (result.conflicts) {
      const argv = argvForRecord(record, inputContext.platform ?? process.platform);
      conflicts.push({
        pid: result.pid,
        parentPid: record.parentPid,
        role: result.role,
        executableName: executableBasename(
          record.executablePath ?? record.name ?? argv?.[0],
        ),
        entrypoint: ROLE_ENTRYPOINTS[result.role],
        creationTime: record.creationTime,
      });
    }
    if (result.diagnostic && diagnostics.length < MAX_DIAGNOSTICS) {
      diagnostics.push(result.diagnostic);
    }
  }
  return { conflicts, diagnostics };
}

function parseWindowsProcessRecords(stdout) {
  const parsed = String(stdout).trim() ? JSON.parse(stdout) : [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parsePosixProcessRecords(stdout) {
  return String(stdout).split(/\r?\n/).flatMap((line) => {
    const match = /^\s*(\d+)\s+(\d+)\s+(\S+)\s+(.*)$/.exec(line);
    if (!match) return [];
    return [{
      pid: Number(match[1]),
      parentPid: Number(match[2]),
      name: match[3],
      commandLine: match[4],
    }];
  });
}

export function inspectRetainedUploadProcessesProduction(inputContext, adapters = {}) {
  const platform = adapters.platform ?? process.platform;
  const run = adapters.spawnSync ?? spawnSync;
  const command = platform === "win32"
    ? [
        "powershell",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine,CreationDate | ConvertTo-Json -Compress",
        ],
      ]
    : ["ps", ["-eo", "pid=,ppid=,comm=,args="]];
  const result = run(command[0], command[1], {
    encoding: "utf8",
    windowsHide: true,
    shell: false,
  });
  if (result.status !== 0) throw new Error("retained uploader process inspection failed");
  const records = platform === "win32"
    ? parseWindowsProcessRecords(result.stdout)
    : parsePosixProcessRecords(result.stdout);
  return inspectRetainedUploadProcesses(records, { ...inputContext, platform });
}
