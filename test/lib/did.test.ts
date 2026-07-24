import { describe, expect, it } from "vitest";
import { generateDidKeypair, publicKeyFromDid, signWithDidKey, verifyWithDid } from "../../src/lib/did.js";

describe("did:key", () => {
  it("generates a did:key identifier that round-trips to a usable public key", () => {
    const { did, publicKey } = generateDidKeypair();
    expect(did.startsWith("did:key:z")).toBe(true);

    const resolved = publicKeyFromDid(did);
    expect(resolved.export({ format: "jwk" })).toEqual(publicKey.export({ format: "jwk" }));
  });

  it("signs and verifies data with the same keypair", () => {
    const { did, privateKey } = generateDidKeypair();
    const data = Buffer.from("hello kyc");
    const signature = signWithDidKey(privateKey, data);

    expect(verifyWithDid(did, data, signature)).toBe(true);
  });

  it("fails verification for tampered data", () => {
    const { did, privateKey } = generateDidKeypair();
    const signature = signWithDidKey(privateKey, Buffer.from("original"));

    expect(verifyWithDid(did, Buffer.from("tampered"), signature)).toBe(false);
  });

  it("fails verification against a different keypair's did", () => {
    const a = generateDidKeypair();
    const b = generateDidKeypair();
    const signature = signWithDidKey(a.privateKey, Buffer.from("data"));

    expect(verifyWithDid(b.did, Buffer.from("data"), signature)).toBe(false);
  });

  it("rejects a malformed did:key identifier instead of throwing", () => {
    expect(verifyWithDid("did:key:znotvalidbase58!!!", Buffer.from("x"), "sig")).toBe(false);
    expect(() => publicKeyFromDid("did:web:example.com")).toThrow();
  });
});
