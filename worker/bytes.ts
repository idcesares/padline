/**
 * Byte helpers for evidence (ADR-0018), which moves documents up to the 2 MB
 * cap between the room and the ledger. Base64 is built in slices: spreading a
 * whole document into String.fromCharCode would overflow the stack.
 */
const BASE64_SLICE = 0x8000;

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_SLICE) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + BASE64_SLICE));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes as BufferSource);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
