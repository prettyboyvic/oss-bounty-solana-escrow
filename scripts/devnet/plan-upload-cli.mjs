import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runPlanUploadCommand } from "./plan-upload-command.mjs";

export async function main(argv = process.argv.slice(2)) {
  const repoRoot = resolve(fileURLToPath(new URL("../..", import.meta.url)));
  return runPlanUploadCommand({
    argv,
    paths: {
      configPath: join(repoRoot, "config", "devnet.json"),
      statePath: join(repoRoot, ".devnet", "state.json"),
      binaryPath: join(repoRoot, "target", "sbf-solana-solana", "release", "oss_bounty_escrow.so"),
    },
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const report = await main();
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
