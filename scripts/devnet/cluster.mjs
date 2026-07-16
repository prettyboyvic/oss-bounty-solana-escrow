import { setTimeout as sleepTimer } from "node:timers/promises";

import { PublicKey } from "@solana/web3.js";

import {
  assertAllowedRpcUrl,
  assertClassicTokenProgram,
  assertDevnetGenesis,
  validatePublicConfig,
} from "./safety.mjs";

const LAMPORTS_PER_SOL = 1_000_000_000n;

export async function attestDevnet(connection, publicConfig) {
  const config = validatePublicConfig(publicConfig);
  const expectedUrl = assertAllowedRpcUrl(
    config.cluster.rpcUrl,
    "devnet",
  );
  const observedUrl = assertAllowedRpcUrl(connection.rpcEndpoint, "devnet");
  if (observedUrl.href !== expectedUrl.href) {
    throw new Error(
      `RPC endpoint mismatch: ${observedUrl.href} != ${expectedUrl.href}`,
    );
  }

  const genesisHash = await connection.getGenesisHash();
  assertDevnetGenesis(genesisHash, config.cluster.genesisHash);
  assertClassicTokenProgram(config.token.programId);

  const [version, epochInfo, slot, tokenProgramAccount] = await Promise.all([
    connection.getVersion(),
    connection.getEpochInfo(),
    connection.getSlot("confirmed"),
    connection.getAccountInfo(
      new PublicKey(config.token.programId),
      "confirmed",
    ),
  ]);
  if (!tokenProgramAccount?.executable) {
    throw new Error("classic SPL Token Program is not executable");
  }
  const blockTime = await connection.getBlockTime(slot);
  if (blockTime === null) {
    throw new Error(`devnet did not return block time for slot ${slot}`);
  }

  return {
    rpcUrl: expectedUrl.origin,
    genesisHash,
    version,
    epochInfo,
    slot,
    blockTime,
    tokenProgram: {
      id: config.token.programId,
      executable: tokenProgramAccount.executable,
      owner: tokenProgramAccount.owner.toBase58(),
    },
  };
}

export async function pollOnchainTime(
  connection,
  target,
  {
    intervalMs = 3_000,
    timeoutMs = 210_000,
    progressIntervalMs = 12_000,
    sleep = (duration) => sleepTimer(duration),
    now = Date.now,
    onProgress = () => {},
  } = {},
) {
  const started = now();
  let lastProgress = started - progressIntervalMs;
  let polls = 0;

  for (;;) {
    const slot = await connection.getSlot("confirmed");
    const blockTime = await connection.getBlockTime(slot);
    polls += 1;
    if (blockTime !== null && blockTime >= target) {
      return { slot, blockTime, polls };
    }

    const current = now();
    if (current - started >= timeoutMs) {
      throw new Error(
        `onchain clock polling timed out before ${target} after ${polls} polls`,
      );
    }
    if (current - lastProgress >= progressIntervalMs) {
      onProgress({ slot, blockTime, target, polls });
      lastProgress = current;
    }
    await sleep(intervalMs);
  }
}

export function planFaucetAttempts(
  balanceLamports,
  requiredLamports,
  {
    maxAttempts = 3,
    maxSolPerAttempt = 2,
    maxTotalSol = 6,
  } = {},
) {
  const balance = BigInt(balanceLamports);
  const required = BigInt(requiredLamports);
  if (balance >= required) {
    return [];
  }

  let remaining = required - balance;
  const maxPerAttempt =
    BigInt(Math.round(maxSolPerAttempt * 1_000_000_000));
  const maxTotal = BigInt(Math.round(maxTotalSol * 1_000_000_000));
  if (remaining > maxTotal) {
    throw new Error("required balance exceeds bounded faucet policy");
  }

  const attempts = [];
  let total = 0n;
  while (remaining > 0n && attempts.length < maxAttempts) {
    const amount =
      remaining > maxPerAttempt ? maxPerAttempt : remaining;
    attempts.push(Number(amount) / Number(LAMPORTS_PER_SOL));
    remaining -= amount;
    total += amount;
  }
  if (remaining > 0n || total > maxTotal) {
    throw new Error("required balance exceeds bounded faucet policy");
  }
  return attempts;
}

export function classifyFaucetProgress({
  attempts,
  balanceLamports,
  requiredLamports,
  maxAttempts = 3,
  maxSolPerAttempt = 2,
  maxTotalSol = 6,
}) {
  if (!Array.isArray(attempts)) {
    throw new Error("faucet attempts must be an array");
  }

  let totalRequested = 0;
  for (const attempt of attempts) {
    if (
      !Number.isFinite(attempt?.requestedSol) ||
      attempt.requestedSol <= 0 ||
      attempt.requestedSol > maxSolPerAttempt
    ) {
      throw new Error("faucet attempt exceeds the per-request policy");
    }
    totalRequested += attempt.requestedSol;
  }
  if (attempts.length > maxAttempts || totalRequested > maxTotalSol) {
    throw new Error("faucet attempt history exceeds bounded policy");
  }

  const balance = BigInt(balanceLamports);
  const required = BigInt(requiredLamports);
  if (balance >= required) {
    return { status: "FUNDED", mayRequest: false };
  }
  if (attempts.length >= maxAttempts) {
    return {
      status: "BLOCKED",
      reason: "faucet attempts exhausted",
      mayRequest: false,
    };
  }
  return {
    status: "READY",
    mayRequest: true,
    attemptsRemaining: maxAttempts - attempts.length,
  };
}
