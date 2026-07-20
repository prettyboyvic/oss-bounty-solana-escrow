import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  VALIDATION_SNAPSHOT_TTL_MS,
  createConfirmedValidationSnapshot,
  validateConfirmedValidationSnapshot,
} from "../../scripts/devnet/upload-validation-snapshot.mjs";

const BUFFER = "buffer-public-identity";
const OWNER = "loader-public-identity";
const AUTHORITY = "authority-public-identity";
const STATE_SHA256 = "a".repeat(64);
const PLAN_FINGERPRINT = "b".repeat(64);
const METADATA_LENGTH = 37;

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function fixture() {
  const localBytes = Buffer.from(Array.from({ length: 12 }, (_, index) => index + 1));
  const accountData = Buffer.alloc(METADATA_LENGTH + localBytes.length);
  localBytes.copy(accountData, METADATA_LENGTH, 0, 8);
  const chunks = [0, 1, 2].map((index) => {
    const offset = index * 4;
    const bytes = localBytes.subarray(offset, offset + 4);
    return { index, offset, length: bytes.length, sha256: sha256(bytes), bytes };
  });
  const records = chunks.map((chunk) => ({
    index: chunk.index,
    offset: chunk.offset,
    length: chunk.length,
    sha256: chunk.sha256,
    status: chunk.index < 2 ? "CONFIRMED" : "PLANNED",
  }));
  const snapshot = createConfirmedValidationSnapshot({
    bufferAddress: BUFFER,
    owner: OWNER,
    authority: AUTHORITY,
    allocation: accountData.length,
    lamports: 1234,
    accountData,
    finalizedSlot: 55,
    capturedAtMonotonicMs: 1000,
    stateSha256: STATE_SHA256,
    binarySha256: sha256(localBytes),
    planFingerprint: PLAN_FINGERPRINT,
  });
  const expected = {
    bufferAddress: BUFFER,
    owner: OWNER,
    authority: AUTHORITY,
    allocation: accountData.length,
    stateSha256: STATE_SHA256,
    binarySha256: sha256(localBytes),
    planFingerprint: PLAN_FINGERPRINT,
  };
  return { accountData, chunks, expected, localBytes, records, snapshot };
}

test("immutable finalized snapshot validates every exact confirmed byte range", () => {
  const input = fixture();
  const result = validateConfirmedValidationSnapshot({
    snapshot: input.snapshot,
    expected: input.expected,
    chunks: input.chunks,
    records: input.records,
    localBytes: input.localBytes,
    nowMonotonicMs: 1100,
  });

  assert.deepEqual(result, { confirmedIndexes: [0, 1], confirmedCount: 2 });
  assert.equal(Object.isFrozen(input.snapshot), true);
  assert.equal(Buffer.isBuffer(input.snapshot.accountDataBase64), false);
  assert.equal(input.snapshot.accountDataSha256, sha256(input.accountData));
  assert.equal(input.snapshot.finalizedSlot, 55);
});

test("confirmed validation rejects gaps, overlaps and out-of-bounds records", () => {
  const cases = [
    {
      name: "gap",
      mutate({ records }) { records[1].status = "PLANNED"; records[2].status = "CONFIRMED"; },
      error: /confirmed chunk gap/,
    },
    {
      name: "overlap",
      mutate({ chunks, records }) { chunks[1].offset = 3; records[1].offset = 3; },
      error: /gap or overlap/,
    },
    {
      name: "out-of-bounds",
      mutate({ chunks, records }) { chunks[2].length = 5; records[2].length = 5; },
      error: /out of bounds/,
    },
  ];

  for (const scenario of cases) {
    const input = fixture();
    scenario.mutate(input);
    assert.throws(() => validateConfirmedValidationSnapshot({
      snapshot: input.snapshot,
      expected: input.expected,
      chunks: input.chunks,
      records: input.records,
      localBytes: input.localBytes,
      nowMonotonicMs: 1100,
    }), scenario.error, scenario.name);
  }
});

test("confirmed validation rejects exact byte mismatch instead of using equal-position progress", () => {
  const input = fixture();
  const changed = Buffer.from(input.accountData);
  changed[METADATA_LENGTH + 2] ^= 0xff;
  input.snapshot = createConfirmedValidationSnapshot({
    ...input.snapshot,
    accountData: changed,
  });

  assert.throws(() => validateConfirmedValidationSnapshot({
    snapshot: input.snapshot,
    expected: input.expected,
    chunks: input.chunks,
    records: input.records,
    localBytes: input.localBytes,
    nowMonotonicMs: 1100,
  }), /confirmed chunk bytes mismatch/);
});

test("snapshot expiry and clock regression force revalidation", () => {
  for (const nowMonotonicMs of [999, 1000 + VALIDATION_SNAPSHOT_TTL_MS + 1]) {
    const input = fixture();
    assert.throws(() => validateConfirmedValidationSnapshot({
      snapshot: input.snapshot,
      expected: input.expected,
      chunks: input.chunks,
      records: input.records,
      localBytes: input.localBytes,
      nowMonotonicMs,
    }), /snapshot (clock|expired)/);
  }
});

test("state, identity, allocation, binary and plan drift invalidate the snapshot", () => {
  const mutations = [
    ["bufferAddress", "other-buffer"],
    ["owner", "other-owner"],
    ["authority", "other-authority"],
    ["allocation", METADATA_LENGTH + 13],
    ["stateSha256", "c".repeat(64)],
    ["binarySha256", "d".repeat(64)],
    ["planFingerprint", "e".repeat(64)],
  ];

  for (const [property, value] of mutations) {
    const input = fixture();
    input.expected[property] = value;
    assert.throws(() => validateConfirmedValidationSnapshot({
      snapshot: input.snapshot,
      expected: input.expected,
      chunks: input.chunks,
      records: input.records,
      localBytes: input.localBytes,
      nowMonotonicMs: 1100,
    }), /snapshot .* mismatch/);
  }
});
