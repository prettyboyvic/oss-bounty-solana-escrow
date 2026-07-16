import assert from "node:assert/strict";
import test from "node:test";

import {
  compareProgramBytes,
  hashBytes,
} from "../../scripts/devnet/binary.mjs";

test("accepts byte-for-byte equal local and dump bytes", () => {
  const local = Buffer.from([1, 2, 3]);
  const result = compareProgramBytes(local, Buffer.from(local), 3);

  assert.equal(result.exactExecutableMatch, true);
  assert.equal(result.paddingLength, 0);
  assert.equal(result.localRawSha256, hashBytes(local));
  assert.equal(result.onchainCanonicalSha256, hashBytes(local));
});

test("accepts proven all-zero allocation padding", () => {
  const local = Buffer.from([1, 2, 3]);
  const dump = Buffer.from([1, 2, 3, 0, 0]);
  const result = compareProgramBytes(local, dump, 5, {
    dumpSemantics: "upgradeable-programdata-allocation",
  });

  assert.equal(result.exactExecutableMatch, true);
  assert.equal(result.paddingLength, 2);
  assert.equal(result.paddingAllZero, true);
  assert.equal(result.onchainCanonicalLength, 3);
  assert.notEqual(result.onchainRawSha256, result.onchainCanonicalSha256);
});

test("rejects zero padding without proven upgradeable-loader dump semantics", () => {
  assert.throws(
    () =>
      compareProgramBytes(
        Buffer.from([1, 2, 3]),
        Buffer.from([1, 2, 3, 0]),
        4,
      ),
    /padding semantics are not proven/,
  );
});

test("rejects a ProgramData length that differs from raw dump length", () => {
  assert.throws(
    () =>
      compareProgramBytes(
        Buffer.from([1, 2, 3]),
        Buffer.from([1, 2, 3]),
        4,
      ),
    /reported ProgramData length/,
  );
});

test("rejects executable mismatch, nonzero tail and shorter dump", () => {
  assert.throws(
    () =>
      compareProgramBytes(
        Buffer.from([1, 2, 3]),
        Buffer.from([1, 9, 3]),
        3,
      ),
    /executable bytes differ/,
  );
  assert.throws(
    () =>
      compareProgramBytes(
        Buffer.from([1, 2, 3]),
        Buffer.from([1, 2, 3, 7]),
        4,
      ),
    /nonzero allocation padding/,
  );
  assert.throws(
    () =>
      compareProgramBytes(
        Buffer.from([1, 2, 3]),
        Buffer.from([1, 2]),
        2,
      ),
    /shorter than local artifact/,
  );
});

test("does not trim zeros inside the known local artifact", () => {
  const local = Buffer.from([1, 2, 0, 0]);
  const result = compareProgramBytes(local, Buffer.from(local), 4);
  assert.equal(result.onchainCanonicalLength, 4);
  assert.equal(result.paddingLength, 0);
});
