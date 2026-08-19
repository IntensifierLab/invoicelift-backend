import { createHash, randomBytes } from "node:crypto";

/**
 * Privacy-preserving invoice uniqueness attestation.
 *
 * Scope note (read before extending): this is the commitment + nullifier
 * construction that real ZK-privacy systems (Zcash, Tornado Cash,
 * Semaphore) use for "prove uniqueness / prevent double-spend without
 * revealing the underlying secret." It is NOT a zk-SNARK circuit — there
 * is no arbitrary-predicate proof of knowledge, no trusted setup, and
 * nothing here proves the nullifier was honestly derived from the same
 * data as the commitment (that would require a real circuit, e.g. circom
 * + a SNARK-friendly hash like Poseidon, which needs a toolchain this
 * repo doesn't have and that can't be verified in this CI). What IS real:
 *
 *  - `commitment` is a hiding+binding commitment to the invoice's
 *    identifying fields (SHA-256 of the fields plus a random secret salt
 *    — computationally hiding because the salt has enough entropy to make
 *    the commitment unlinkable to the fields without it, and binding
 *    because SHA-256 is preimage- and collision-resistant).
 *  - `nullifier` is a SEPARATE deterministic hash of the SAME fields
 *    *without* the random salt, so the same invoice always produces the
 *    same nullifier no matter who computes it or when. The backend's
 *    uniqueness check (@@unique([nullifier]) on InvoiceZkAttestation) is
 *    what delivers "prove this invoice hasn't been submitted before
 *    without seeing its raw fields" — it sees only the nullifier, never
 *    the fields that produced it.
 *
 * Both functions are pure and side-effect-free specifically so they can
 * be ported to run client-side (a browser/SME client computes these
 * locally and sends only {commitment, nullifier} to the backend — never
 * the raw fields or the salt). The backend never imports or calls these
 * with real invoice data; see routes/v1/invoiceZkProofs.ts.
 */

export interface InvoiceIdentityFields {
  invoiceReference: string;
  smeAddress: string;
  buyerAddress: string;
  amount: number;
  dueDate: string; // ISO 8601
}

function canonicalize(fields: InvoiceIdentityFields): string {
  // Fixed key order so the same logical invoice always serializes
  // identically regardless of how the caller constructed the object.
  return JSON.stringify({
    invoiceReference: fields.invoiceReference,
    smeAddress: fields.smeAddress,
    buyerAddress: fields.buyerAddress,
    amount: fields.amount,
    dueDate: fields.dueDate,
  });
}

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Generates a fresh random salt for a new commitment. Client-side callers should call this once per invoice submission. */
export function generateCommitmentSalt(): string {
  return randomBytes(32).toString("hex");
}

export function computeInvoiceCommitment(fields: InvoiceIdentityFields, salt: string): string {
  return sha256Hex(`${canonicalize(fields)}:${salt}`);
}

export function computeInvoiceNullifier(fields: InvoiceIdentityFields): string {
  return sha256Hex(`nullifier:${canonicalize(fields)}`);
}

export interface InvoiceUniquenessProof {
  commitment: string;
  nullifier: string;
}

/** Convenience wrapper for a client computing both values from the same fields + a fresh salt. */
export function generateInvoiceUniquenessProof(
  fields: InvoiceIdentityFields,
): InvoiceUniquenessProof {
  const salt = generateCommitmentSalt();
  return {
    commitment: computeInvoiceCommitment(fields, salt),
    nullifier: computeInvoiceNullifier(fields),
  };
}

const HEX_64 = /^[0-9a-f]{64}$/;

/** Structural validation only (correct shape/length) — the backend cannot verify these were honestly derived; see the module-level scope note. */
export function isWellFormedProof(proof: unknown): proof is InvoiceUniquenessProof {
  if (typeof proof !== "object" || proof === null) return false;
  const p = proof as Record<string, unknown>;
  return typeof p.commitment === "string" && typeof p.nullifier === "string" && HEX_64.test(p.commitment) && HEX_64.test(p.nullifier);
}
