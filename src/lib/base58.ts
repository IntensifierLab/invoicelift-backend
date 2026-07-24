// Base58 (Bitcoin/IPFS alphabet — base58btc) encode/decode. Hand-rolled
// rather than pulling in a dependency: it's ~30 lines of big-integer-free
// byte math, needed only to render/parse did:key identifiers.
const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const ALPHABET_MAP = new Map(Array.from(ALPHABET).map((c, i) => [c, i]));

export function base58Encode(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  // Convert the byte array to a big number represented in base 58, using
  // plain arrays of digits instead of BigInt for portability/clarity.
  const digits = [0];
  for (const byte of bytes) {
    let carry = byte;
    for (let i = 0; i < digits.length; i++) {
      carry += digits[i] << 8;
      digits[i] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }

  // Leading zero bytes become leading '1's (the zero symbol in base58).
  let leadingZeros = 0;
  for (const byte of bytes) {
    if (byte !== 0) break;
    leadingZeros++;
  }

  const leading = ALPHABET[0].repeat(leadingZeros);
  const body = digits
    .reverse()
    .map((d) => ALPHABET[d])
    .join("");

  return leading + body;
}

export function base58Decode(value: string): Uint8Array {
  if (value.length === 0) return new Uint8Array();

  const bytes = [0];
  for (const char of value) {
    const digit = ALPHABET_MAP.get(char);
    if (digit === undefined) {
      throw new Error(`Invalid base58 character: "${char}"`);
    }
    let carry = digit;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  let leadingZeros = 0;
  for (const char of value) {
    if (char !== ALPHABET[0]) break;
    leadingZeros++;
  }

  return new Uint8Array([...new Array(leadingZeros).fill(0), ...bytes.reverse()]);
}
