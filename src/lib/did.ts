import { createPublicKey, generateKeyPairSync, sign, verify, type KeyObject } from "node:crypto";
import { base58Decode, base58Encode } from "./base58.js";

// Multicodec varint prefix for an Ed25519 public key, per the did:key spec
// (https://w3c-ccg.github.io/did-method-key/) — used by every did:key:z6Mk...
// identifier regardless of implementation.
const ED25519_MULTICODEC_PREFIX = new Uint8Array([0xed, 0x01]);
const DID_KEY_PREFIX = "did:key:z";

export interface DidKeypair {
  did: string;
  publicKey: KeyObject;
  privateKey: KeyObject;
}

function base64UrlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function rawPublicKeyFromKeyObject(publicKey: KeyObject): Uint8Array {
  const jwk = publicKey.export({ format: "jwk" }) as { x: string };
  return base64UrlToBytes(jwk.x);
}

export function didFromRawPublicKey(rawPublicKey: Uint8Array): string {
  const prefixed = new Uint8Array([...ED25519_MULTICODEC_PREFIX, ...rawPublicKey]);
  return `${DID_KEY_PREFIX}${base58Encode(prefixed)}`;
}

/**
 * Resolves a did:key identifier to its Ed25519 public key entirely locally —
 * did:key is self-certifying (the key material is embedded in the
 * identifier itself), so no network lookup or registry is ever needed.
 */
export function publicKeyFromDid(did: string): KeyObject {
  if (!did.startsWith(DID_KEY_PREFIX)) {
    throw new Error(`Not a did:key identifier: "${did}"`);
  }

  const decoded = base58Decode(did.slice(DID_KEY_PREFIX.length));
  if (decoded.length !== 34 || decoded[0] !== 0xed || decoded[1] !== 0x01) {
    throw new Error(`Unsupported did:key encoding (expected Ed25519 multicodec): "${did}"`);
  }

  const rawPublicKey = decoded.slice(2);
  return createPublicKey({
    key: { kty: "OKP", crv: "Ed25519", x: bytesToBase64Url(rawPublicKey) },
    format: "jwk",
  });
}

export function generateDidKeypair(): DidKeypair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const did = didFromRawPublicKey(rawPublicKeyFromKeyObject(publicKey));
  return { did, publicKey, privateKey };
}

export function signWithDidKey(privateKey: KeyObject, data: Buffer): string {
  const signature = sign(null, data, privateKey);
  return bytesToBase64Url(signature);
}

export function verifyWithDid(did: string, data: Buffer, signatureBase64Url: string): boolean {
  try {
    const publicKey = publicKeyFromDid(did);
    return verify(null, data, publicKey, base64UrlToBytes(signatureBase64Url));
  } catch {
    return false;
  }
}
