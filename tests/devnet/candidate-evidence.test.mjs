import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import {
  CANDIDATE_EVIDENCE_DOMAIN,
  CANDIDATE_EVIDENCE_SCHEMA,
  LEGACY_CANDIDATE_DIGEST,
  buildCandidateEvidence,
  buildCandidateEvidenceFromUploadInputs,
  canonicalCandidateEvidenceBytes,
  candidateEvidenceSha256,
  verifyCandidateEvidenceDigest,
} from "../../scripts/devnet/candidate-evidence.mjs";

const BUFFER = "CT1DGjkt9t926L6SoFxiYJmzc18nMowpdw1WcZgWwbbW";
const AUTHORITY = "Avfvs1k6ttrBtqh83tFw5g3dhWncrjP5hj4D52kGNZGk";

const HASH = {
  state: "11".repeat(32),
  binary: "22".repeat(32),
  plan: "33".repeat(32),
  payloadA: "44".repeat(32),
  payloadB: "55".repeat(32),
};

const CANDIDATES = [
  {
    index: 7,
    offset: 1011,
    length: 1011,
    payloadSha256: HASH.payloadA,
    serializedTransactionBytes: 1231,
    expectedState: "PLANNED",
    expectedSignature: null,
  },
  {
    index: 8,
    offset: 2022,
    length: 9,
    payloadSha256: HASH.payloadB,
    serializedTransactionBytes: 229,
    expectedState: "PLANNED",
    expectedSignature: null,
  },
];

function input(overrides = {}) {
  return {
    stateSha256: HASH.state,
    binarySha256: HASH.binary,
    planFingerprint: HASH.plan,
    candidates: CANDIDATES,
    ...overrides,
  };
}

const GOLDEN_JSON = `{"schema":"R4_CANDIDATE_EVIDENCE_V1","stateSha256":"${HASH.state}","binarySha256":"${HASH.binary}","planFingerprint":"${HASH.plan}","candidateCount":2,"candidates":[{"index":7,"offset":1011,"length":1011,"payloadSha256":"${HASH.payloadA}","serializedTransactionBytes":1231,"expectedState":"PLANNED","expectedSignature":null},{"index":8,"offset":2022,"length":9,"payloadSha256":"${HASH.payloadB}","serializedTransactionBytes":229,"expectedState":"PLANNED","expectedSignature":null}]}`;
const GOLDEN_BYTES = Buffer.from(`${CANDIDATE_EVIDENCE_DOMAIN}\0${GOLDEN_JSON}`, "utf8");
const GOLDEN_DIGEST = createHash("sha256").update(GOLDEN_BYTES).digest("hex");

test("candidate evidence has fixed canonical bytes and golden digest", () => {
  const evidence = buildCandidateEvidence(input());
  assert.equal(CANDIDATE_EVIDENCE_SCHEMA, "R4_CANDIDATE_EVIDENCE_V1");
  assert.deepEqual(canonicalCandidateEvidenceBytes(evidence), GOLDEN_BYTES);
  assert.equal(candidateEvidenceSha256(evidence), GOLDEN_DIGEST);
  assert.equal(verifyCandidateEvidenceDigest(evidence, GOLDEN_DIGEST), true);
});

test("canonical evidence ignores caller object insertion order and sorts candidates", () => {
  const reordered = {
    candidates: [
      Object.fromEntries(Object.entries(CANDIDATES[1]).reverse()),
      Object.fromEntries(Object.entries(CANDIDATES[0]).reverse()),
    ],
    planFingerprint: HASH.plan,
    binarySha256: HASH.binary,
    stateSha256: HASH.state,
  };
  assert.deepEqual(
    canonicalCandidateEvidenceBytes(buildCandidateEvidence(reordered)),
    GOLDEN_BYTES,
  );
});

test("every authorization-relevant candidate field changes the digest", () => {
  const mutations = [
    (candidate) => { candidate.index = 9; },
    (candidate) => { candidate.offset += 1; },
    (candidate) => { candidate.payloadSha256 = "66".repeat(32); },
    (candidate) => { candidate.serializedTransactionBytes -= 1; },
    (candidate) => { candidate.expectedState = "CONFIRMED"; },
    (candidate) => { candidate.expectedSignature = "3KMfWvWb"; },
  ];
  for (const mutate of mutations) {
    const candidates = structuredClone(CANDIDATES);
    mutate(candidates[0]);
    assert.notEqual(candidateEvidenceSha256(buildCandidateEvidence(input({ candidates }))), GOLDEN_DIGEST);
  }
});

test("duplicate, missing, extra, malformed and noncanonical evidence candidates are rejected", () => {
  assert.throws(() => buildCandidateEvidence(input({ candidates: [CANDIDATES[0], CANDIDATES[0]] })), /duplicate/i);
  for (const candidate of [
    Object.fromEntries(Object.entries(CANDIDATES[0]).filter(([key]) => key !== "offset")),
    { ...CANDIDATES[0], extra: true },
    { ...CANDIDATES[0], length: -1 },
  ]) {
    assert.throws(() => buildCandidateEvidence(input({ candidates: [candidate] })), /candidate/i);
  }
  const evidence = buildCandidateEvidence(input());
  assert.throws(
    () => canonicalCandidateEvidenceBytes({ ...evidence, candidates: [...evidence.candidates].reverse() }),
    /ascending|sorted/i,
  );
});

test("historical digest is explicitly legacy and is never claimed reproducible", () => {
  assert.equal(
    LEGACY_CANDIDATE_DIGEST,
    "6554cbe1ad09b9e621a709dde9c4fb2f59404a8d2a8551a133552fe2ef345180",
  );
  assert.notEqual(GOLDEN_DIGEST, LEGACY_CANDIDATE_DIGEST);
  assert.equal(verifyCandidateEvidenceDigest(buildCandidateEvidence(input()), LEGACY_CANDIDATE_DIGEST), false);
});

test("canonical state, plan and binary inputs build evidence without signer material", () => {
  const binaryBytes = Buffer.from([1, 2, 3]);
  const payloadSha256 = createHash("sha256").update(binaryBytes).digest("hex");
  const stateBytes = Buffer.from(JSON.stringify({
    schemaVersion: 3,
    deployment: {
      buffer: {
        planFingerprint: HASH.plan,
        chunks: [{
          index: 0,
          offset: 0,
          length: 3,
          sha256: payloadSha256,
          status: "PLANNED",
          signature: null,
        }],
      },
    },
  }));
  const evidence = buildCandidateEvidenceFromUploadInputs({
    stateBytes,
    binaryBytes,
    candidateIndexes: [0],
    buffer: BUFFER,
    authority: AUTHORITY,
  });
  assert.equal(
    evidence.stateSha256,
    createHash("sha256").update(stateBytes).digest("hex"),
  );
  assert.equal(evidence.candidates[0].payloadSha256, payloadSha256);
  assert.equal(evidence.candidates[0].expectedSignature, null);
  assert.ok(evidence.candidates[0].serializedTransactionBytes > 0);
});
