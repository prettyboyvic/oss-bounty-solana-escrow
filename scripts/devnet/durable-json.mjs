import { randomUUID as nodeRandomUUID } from "node:crypto";
import {
  closeSync as nodeCloseSync,
  existsSync as nodeExistsSync,
  fsyncSync as nodeFsyncSync,
  openSync as nodeOpenSync,
  renameSync as nodeRenameSync,
  unlinkSync as nodeUnlinkSync,
  writeFileSync as nodeWriteFileSync,
} from "node:fs";
import {
  basename as nodeBasename,
  dirname as nodeDirname,
  join,
} from "node:path";

const UNSUPPORTED_DIRECTORY_FSYNC = new Set(["EISDIR", "EPERM", "EACCES", "EINVAL"]);

export function sortedJsonValue(value) {
  if (Array.isArray(value)) return value.map(sortedJsonValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value).sort().map((key) => [key, sortedJsonValue(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(sortedJsonValue(value));
}

export function flushDirectory(path, adapters = {}) {
  const open = adapters.openSync ?? nodeOpenSync;
  const fsync = adapters.fsyncSync ?? nodeFsyncSync;
  const close = adapters.closeSync ?? nodeCloseSync;
  try {
    const descriptor = open(path, "r");
    try {
      fsync(descriptor);
    } finally {
      close(descriptor);
    }
  } catch (error) {
    if (!UNSUPPORTED_DIRECTORY_FSYNC.has(error?.code)) throw error;
  }
}

export function writeCanonicalJsonAtomic(path, value, adapters = {}) {
  const open = adapters.openSync ?? nodeOpenSync;
  const write = adapters.writeFileSync ?? nodeWriteFileSync;
  const fsync = adapters.fsyncSync ?? nodeFsyncSync;
  const close = adapters.closeSync ?? nodeCloseSync;
  const rename = adapters.renameSync ?? nodeRenameSync;
  const exists = adapters.existsSync ?? nodeExistsSync;
  const unlink = adapters.unlinkSync ?? nodeUnlinkSync;
  const dirname = adapters.dirname ?? nodeDirname;
  const basename = adapters.basename ?? nodeBasename;
  const randomUUID = adapters.randomUUID ?? nodeRandomUUID;
  const directory = dirname(path);
  const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
  const bytes = `${JSON.stringify(sortedJsonValue(value), null, 2)}\n`;
  let descriptor = null;
  try {
    descriptor = open(temporary, "wx");
    write(descriptor, bytes);
    fsync(descriptor);
    close(descriptor);
    descriptor = null;
    rename(temporary, path);
    flushDirectory(directory, adapters);
  } catch (error) {
    if (descriptor !== null) {
      try { close(descriptor); } catch {}
    }
    try {
      if (exists(temporary)) unlink(temporary);
    } catch {}
    throw error;
  }
}
