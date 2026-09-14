/**
 * The operator's bearer secret (ADR-0010, ADR-0018). Shared by the room and the
 * moderation ledger so both compare it the same way. Access credentials a
 * visitor presents — PIN sessions, read-only tokens — stay RoomSecurity's
 * (ADR-0016).
 *
 * Fails closed: no deployed secret, no bearer, and an empty bearer all refuse.
 */
export async function isAdminRequest(
  request: Request,
  secret: string | undefined,
): Promise<boolean> {
  if (!secret) return false;
  const auth = request.headers.get("authorization") ?? "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  return provided.length > 0 && (await digestEqual(provided, secret));
}

/**
 * Constant-time compare for secrets of unknown length. SHA-256 first so both
 * operands are always 32 bytes — comparing the strings themselves would let a
 * caller probe the length of ADMIN_SECRET.
 */
async function digestEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  const leftBytes = new Uint8Array(left);
  const rightBytes = new Uint8Array(right);
  let diff = 0;
  for (let index = 0; index < leftBytes.length; index++) {
    diff |= leftBytes[index] ^ rightBytes[index];
  }
  return diff === 0;
}
