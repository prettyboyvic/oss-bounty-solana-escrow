import { createHash } from "node:crypto";
import { PublicKey, Transaction } from "@solana/web3.js";

import { makeLoaderV3WriteInstruction } from "./loader-v3-codec.mjs";

export const PACKET_DATA_SIZE = 1_232;
const SAFETY_MARGIN = 1;
const BLOCKHASH = "11111111111111111111111111111111";

export function serializedWriteTransactionSize({ buffer, authority, offset, bytes }) {
  const authorityKey = new PublicKey(authority);
  const transaction = new Transaction({
    feePayer: authorityKey,
    recentBlockhash: BLOCKHASH,
  }).add(makeLoaderV3WriteInstruction({ buffer, authority: authorityKey, offset, bytes }));
  transaction.setSigners(authorityKey);
  return transaction.serialize({ requireAllSignatures: false, verifySignatures: false }).length;
}

export function deriveMaxWritePayload({ buffer, authority }) {
  let low = 0;
  let high = PACKET_DATA_SIZE;
  while (low < high) {
    const candidate = Math.ceil((low + high) / 2);
    let fits = false;
    try {
      fits = serializedWriteTransactionSize({ buffer, authority, offset: 0, bytes: Buffer.alloc(candidate) }) <= PACKET_DATA_SIZE - SAFETY_MARGIN;
    } catch (error) {
      if (!/Transaction too large/.test(String(error?.message))) throw error;
    }
    if (fits) low = candidate;
    else high = candidate - 1;
  }
  return low;
}

export function planBufferUpload({ localBytes, bufferBytes, buffer, authority, maxPayload = deriveMaxWritePayload({ buffer, authority }) }) {
  const local = Buffer.from(localBytes);
  const current = Buffer.from(bufferBytes);
  if (local.length !== current.length || !Number.isInteger(maxPayload) || maxPayload < 1) throw new Error("valid equal-length buffer bytes and max payload are required");
  const chunks = [];
  for (let offset = 0, index = 0; offset < local.length; offset += maxPayload, index += 1) {
    const bytes = local.subarray(offset, Math.min(offset + maxPayload, local.length));
    const transactionBytes = serializedWriteTransactionSize({ buffer, authority, offset, bytes });
    if (transactionBytes > PACKET_DATA_SIZE - SAFETY_MARGIN) {
      throw new Error("write transaction exceeds packet safety ceiling");
    }
    chunks.push({ index, offset, length: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), exactMatch: bytes.equals(current.subarray(offset, offset + bytes.length)), transactionBytes });
  }
  return { maxPayload, chunks, totalChunks: chunks.length, exactChunks: chunks.filter((chunk) => chunk.exactMatch).length, remainingChunks: chunks.filter((chunk) => !chunk.exactMatch).length, exactBinaryMatch: local.equals(current) };
}
