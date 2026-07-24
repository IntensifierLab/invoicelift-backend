import { Keypair, StrKey } from "@stellar/stellar-sdk";

/**
 * Signature verification is pure local ed25519 math (SEP-53 message signing),
 * so unlike onChainClient.ts there is no stub/live mode to switch between —
 * it never touches the network.
 */

export function isValidStellarAddress(address: string): boolean {
  return StrKey.isValidEd25519PublicKey(address);
}

export function verifyInvoiceSignature(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const signature = Buffer.from(signatureBase64, "base64");
    return Keypair.fromPublicKey(address).verifyMessage(message, signature);
  } catch {
    return false;
  }
}
