// Fail-closed guarantees for the business-flow CLI execute path. These assertions
// never reach a network connection: every guard throws before a Connection is
// constructed or any keypair/plan file is read.

import assert from "node:assert/strict";
import test from "node:test";

import { main } from "../../scripts/devnet/business-flow-cli.mjs";

test("execute without --plan/--authorization refuses before any live action", async () => {
  await assert.rejects(main(["execute"]), /requires --plan .* and --authorization/);
  await assert.rejects(main(["execute", "--plan", "p.json"]), /requires --plan .* and --authorization/);
});

test("execute without the explicit live acknowledgement refuses", async () => {
  await assert.rejects(
    main(["execute", "--plan", "p.json", "--authorization", "a.json"]),
    /EXECUTE_REQUIRES_LIVE_ACK/,
  );
});

test("an unknown subcommand is rejected (only read-only plan is default)", async () => {
  await assert.rejects(main(["frobnicate"]), /unknown command/);
});
