import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const mode = args[args.indexOf("--mode") + 1];

if (mode === "host-deadline-probe") {
  const { runOwnedHostChild } = await import("../../../scripts/devnet/upload-window-host.mjs");
  const stdoutPath = args[args.indexOf("--stdout-path") + 1];
  const stderrPath = args[args.indexOf("--stderr-path") + 1];
  const result = await runOwnedHostChild({
    command: process.execPath,
    args: [fileURLToPath(import.meta.url), "--mode", "hang"],
    cwd: process.cwd(),
    stdoutPath,
    stderrPath,
    outerTimeoutMs: 100,
    cleanupAllowanceMs: 200,
    terminateOwnedTree: async () => {},
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
} else if (mode === "success") {
  process.stderr.write("fake supervisor diagnostic\n");
  process.stdout.write(`${JSON.stringify({
    classification: "UPLOAD_PROCESS_EXITED",
    uploaderInvocationCount: 1,
    childExitCode: 0,
    childSignal: null,
  }, null, 2)}\n`);
} else if (mode === "hang") {
  setInterval(() => {}, 1_000);
} else if (mode === "malformed") {
  process.stdout.write("{not-json}\n");
} else {
  process.stderr.write("fake supervisor failure\n");
  process.exitCode = 7;
}
