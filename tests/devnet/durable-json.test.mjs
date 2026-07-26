import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  canonicalJson,
  writeCanonicalJsonAtomic,
} from "../../scripts/devnet/durable-json.mjs";

test("durable canonical JSON flushes the file before rename and the directory after", () => {
  const events = [];
  const descriptors = new Map();
  let nextDescriptor = 10;
  let temporaryPath;
  writeCanonicalJsonAtomic("C:\\test\\terminal.json", { z: 1, a: { y: 2, x: 3 } }, {
    randomUUID: () => "fixture",
    dirname: () => "C:\\test",
    basename: () => "terminal.json",
    openSync(path, flag) {
      events.push(`open:${path}:${flag}`);
      if (flag === "wx") temporaryPath = path;
      const descriptor = nextDescriptor++;
      descriptors.set(descriptor, path);
      return descriptor;
    },
    writeFileSync(descriptor, bytes) {
      events.push(`write:${descriptors.get(descriptor)}:${bytes}`);
    },
    fsyncSync(descriptor) {
      events.push(`fsync:${descriptors.get(descriptor)}`);
    },
    closeSync(descriptor) {
      events.push(`close:${descriptors.get(descriptor)}`);
    },
    renameSync(source, destination) {
      events.push(`rename:${source}:${destination}`);
    },
    existsSync: () => false,
    unlinkSync() {
      throw new Error("unexpected cleanup");
    },
  });

  const fileFlush = events.indexOf(`fsync:${temporaryPath}`);
  const rename = events.indexOf(`rename:${temporaryPath}:C:\\test\\terminal.json`);
  const directoryFlush = events.indexOf("fsync:C:\\test");
  assert.ok(fileFlush >= 0 && fileFlush < rename);
  assert.ok(directoryFlush > rename);
  assert.ok(events.some((event) => event.includes(`write:${temporaryPath}:{\n  "a"`)));
});

test("rename interruption leaves no falsely complete durable JSON record", () => {
  const root = mkdtempSync(join(tmpdir(), "durable-json-"));
  const path = join(root, "terminal.json");
  assert.throws(() => writeCanonicalJsonAtomic(path, { terminal: true }, {
    renameSync() {
      const error = new Error("injected rename interruption");
      error.code = "EIO";
      throw error;
    },
  }), /rename interruption/);
  assert.equal(existsSync(path), false);
});

test("canonical JSON serialization is stable across object insertion order", () => {
  const left = { z: 1, a: { y: 2, x: 3 } };
  const right = { a: { x: 3, y: 2 }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));

  const root = mkdtempSync(join(tmpdir(), "durable-json-"));
  const path = join(root, "record.json");
  writeCanonicalJsonAtomic(path, left);
  assert.equal(readFileSync(path, "utf8"), `${JSON.stringify({
    a: { x: 3, y: 2 },
    z: 1,
  }, null, 2)}\n`);
});
