import assert from "node:assert/strict";
import test from "node:test";

import {
  attestDevnet,
  classifyFaucetProgress,
  planFaucetAttempts,
  pollOnchainTime,
} from "../../scripts/devnet/cluster.mjs";

const CONFIG = {
  schemaVersion: 1,
  cluster: {
    name: "devnet",
    rpcUrl: "https://api.devnet.solana.com",
    genesisHash: "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG",
  },
  programId: "11111111111111111111111111111111",
  token: {
    programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
    displayLabel: "DEVTEST",
    decimals: 6,
  },
};

function attestationConnection(genesis = CONFIG.cluster.genesisHash) {
  return {
    rpcEndpoint: CONFIG.cluster.rpcUrl,
    async getGenesisHash() {
      return genesis;
    },
    async getVersion() {
      return { "solana-core": "4.2.0-beta.1" };
    },
    async getEpochInfo() {
      return { epoch: 1103, absoluteSlot: 123 };
    },
    async getSlot() {
      return 123;
    },
    async getBlockTime() {
      return 1_700_000_000;
    },
    async getAccountInfo() {
      return {
        executable: true,
        owner: { toBase58: () => "BPFLoaderUpgradeab1e11111111111111111111111" },
      };
    },
  };
}

test("attests the exact devnet cluster without global config", async () => {
  const result = await attestDevnet(attestationConnection(), CONFIG);
  assert.equal(result.rpcUrl, CONFIG.cluster.rpcUrl);
  assert.equal(result.genesisHash, CONFIG.cluster.genesisHash);
  assert.equal(result.slot, 123);
  assert.equal(result.tokenProgram.executable, true);
});

test("attestation rejects the wrong genesis", async () => {
  await assert.rejects(
    attestDevnet(attestationConnection("wrong"), CONFIG),
    /genesis hash mismatch/,
  );
});

test("clock polling resolves only at or after target", async () => {
  const times = [99, 100];
  let index = 0;
  const connection = {
    async getSlot() {
      return index + 1;
    },
    async getBlockTime() {
      return times[index++];
    },
  };

  const result = await pollOnchainTime(connection, 100, {
    intervalMs: 0,
    timeoutMs: 100,
    sleep: async () => {},
    now: (() => {
      let value = 0;
      return () => value++;
    })(),
  });

  assert.equal(result.blockTime, 100);
  assert.equal(result.slot, 2);
  assert.equal(result.polls, 2);
});

test("clock polling returns BLOCKED at timeout", async () => {
  const connection = {
    async getSlot() {
      return 1;
    },
    async getBlockTime() {
      return 99;
    },
  };
  let tick = 0;

  await assert.rejects(
    pollOnchainTime(connection, 100, {
      intervalMs: 0,
      timeoutMs: 2,
      sleep: async () => {},
      now: () => tick++,
    }),
    /onchain clock polling timed out/,
  );
});

test("faucet plan is bounded to three attempts and six devnet SOL", () => {
  assert.deepEqual(
    planFaucetAttempts(0, 5_250_000_000n, {
      maxAttempts: 3,
      maxSolPerAttempt: 2,
      maxTotalSol: 6,
    }),
    [2, 2, 1.25],
  );
});

test("faucet plan stops when required reserve is reached", () => {
  assert.deepEqual(
    planFaucetAttempts(2_000_000_000n, 1_500_000_000n),
    [],
  );
});

test("faucet plan rejects requirements beyond policy", () => {
  assert.throws(
    () => planFaucetAttempts(0n, 6_000_000_001n),
    /exceeds bounded faucet policy/,
  );
});

test("rate-limit exhaustion returns BLOCKED without another request", () => {
  assert.deepEqual(
    classifyFaucetProgress({
      attempts: [
        { requestedSol: 2, outcome: "rate_limited" },
        { requestedSol: 1, outcome: "rate_limited" },
        { requestedSol: 0.5, outcome: "rate_limited" },
      ],
      balanceLamports: 0n,
      requiredLamports: 5_754_000_000n,
    }),
    {
      status: "BLOCKED",
      reason: "faucet attempts exhausted",
      mayRequest: false,
    },
  );
});

test("faucet progress stops immediately when the balance is sufficient", () => {
  assert.deepEqual(
    classifyFaucetProgress({
      attempts: [{ requestedSol: 2, outcome: "confirmed" }],
      balanceLamports: 2_000_000_000n,
      requiredLamports: 1_500_000_000n,
    }),
    { status: "FUNDED", mayRequest: false },
  );
});
