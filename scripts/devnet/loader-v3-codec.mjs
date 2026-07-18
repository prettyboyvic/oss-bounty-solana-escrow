import { PublicKey, TransactionInstruction } from "@solana/web3.js";

// This is the upgradeable loader's public program address, not a signer.
export const BPF_LOADER_UPGRADEABLE_PROGRAM_ID =
  "BPFLoaderUpgradeab1e11111111111111111111111";

// A codec-level guard only. The planner derives the smaller transaction-safe
// payload from a serialized transaction before any upload is considered.
export const MAX_WRITE_PAYLOAD_BYTES = 1_232;

function assertOffset(offset) {
  if (!Number.isInteger(offset) || offset < 0 || offset > 0xffff_ffff) {
    throw new Error("loader write offset must be an unsigned 32-bit integer");
  }
}

function assertBytes(bytes) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw new Error("loader write payload must be bytes");
  }
  if (bytes.length > MAX_WRITE_PAYLOAD_BYTES) {
    throw new Error("loader write payload exceeds codec safety limit");
  }
}

/**
 * bincode serialization for UpgradeableLoaderInstruction::Write { offset,
 * bytes }. The fixture generator pins solana-loader-v3-interface 5.0.0, the
 * interface selected by Agave v2.2.20's workspace lockfile.
 */
export function encodeLoaderV3Write({ offset, bytes }) {
  assertOffset(offset);
  assertBytes(bytes);
  const payload = Buffer.from(bytes);
  const data = Buffer.alloc(16 + payload.length);
  data.writeUInt32LE(1, 0); // enum variant: Write
  data.writeUInt32LE(offset, 4);
  data.writeBigUInt64LE(BigInt(payload.length), 8); // bincode Vec length
  payload.copy(data, 16);
  return data;
}

export function makeLoaderV3WriteInstruction({
  buffer,
  authority,
  offset,
  bytes,
}) {
  const bufferKey = new PublicKey(buffer);
  const authorityKey = new PublicKey(authority);
  return new TransactionInstruction({
    programId: new PublicKey(BPF_LOADER_UPGRADEABLE_PROGRAM_ID),
    keys: [
      { pubkey: bufferKey, isSigner: false, isWritable: true },
      { pubkey: authorityKey, isSigner: true, isWritable: false },
    ],
    data: encodeLoaderV3Write({ offset, bytes }),
  });
}
