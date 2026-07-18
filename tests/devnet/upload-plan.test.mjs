import assert from "node:assert/strict";
import test from "node:test";
import { PublicKey } from "@solana/web3.js";

import {
  PACKET_DATA_SIZE,
  deriveMaxWritePayload,
  planBufferUpload,
  serializedWriteTransactionSize,
} from "../../scripts/devnet/upload-plan.mjs";

const BUFFER = new PublicKey("CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW");
const AUTHORITY = new PublicKey("Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk");

test("derives packet-safe payloads by serializing actual write transactions", () => {
  const size = deriveMaxWritePayload({ buffer: BUFFER, authority: AUTHORITY });
  assert.equal(size, 1011);
  assert.equal(
    serializedWriteTransactionSize({
      buffer: BUFFER,
      authority: AUTHORITY,
      offset: 0,
      bytes: Buffer.alloc(size),
    }),
    1231,
  );
  assert.equal(
    serializedWriteTransactionSize({
      buffer: BUFFER,
      authority: AUTHORITY,
      offset: 0,
      bytes: Buffer.alloc(size + 1),
    }),
    1232,
  );
  assert.throws(
    () => planBufferUpload({
      localBytes: Buffer.alloc(size + 1),
      bufferBytes: Buffer.alloc(size + 1),
      buffer: BUFFER,
      authority: AUTHORITY,
      maxPayload: size + 1,
    }),
    /packet safety ceiling/,
  );
  const plan = planBufferUpload({ localBytes: Buffer.alloc(size + 1, 7), bufferBytes: Buffer.alloc(size + 1), buffer: BUFFER, authority: AUTHORITY });
  assert.equal(plan.chunks.length, 2);
  assert.ok(plan.chunks.every((chunk) => chunk.transactionBytes <= PACKET_DATA_SIZE - 1));
  assert.ok(plan.chunks[0].transactionBytes < PACKET_DATA_SIZE);
  assert.equal(plan.chunks[1].length, 1);
});

test("plans deterministic non-overlapping chunks and only skips full exact chunks", () => {
  const local = Buffer.from([1, 2, 0, 0, 5]);
  const first = planBufferUpload({ localBytes: local, bufferBytes: Buffer.from([1, 2, 9, 0, 5]), buffer: BUFFER, authority: AUTHORITY, maxPayload: 2 });
  assert.deepEqual(first.chunks.map(({ index, offset, length, exactMatch }) => ({ index, offset, length, exactMatch })), [
    { index: 0, offset: 0, length: 2, exactMatch: true },
    { index: 1, offset: 2, length: 2, exactMatch: false },
    { index: 2, offset: 4, length: 1, exactMatch: true },
  ]);
  assert.equal(first.remainingChunks, 1);
  assert.equal(first.equalBytePositions, undefined);
});

test("equal byte count is diagnostic only and never becomes offset or progress", () => {
  const plan = planBufferUpload({ localBytes: Buffer.from([1, 2, 3, 4]), bufferBytes: Buffer.from([1, 9, 3, 0]), buffer: BUFFER, authority: AUTHORITY, maxPayload: 2 });
  assert.equal(plan.exactChunks, 0);
  assert.equal(plan.remainingChunks, 2);
  assert.equal(plan.uploadOffset, undefined);
  assert.equal(plan.progress, undefined);
});
