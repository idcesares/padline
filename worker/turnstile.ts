const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX = 2048;

export type TurnstileOutcome =
  | { ok: true }
  | { ok: false; reason: "not-configured" | "missing-token" | "rejected" | "unavailable" };

/**
 * Server-side Turnstile verification for public reports (ADR-0018). Nothing a
 * report carries is stored before this passes. The visitor's IP is forwarded
 * to Cloudflare for the check and kept nowhere.
 *
 * Fails closed: an instance with no secret deployed refuses every report, and
 * so does a verification Cloudflare could not complete.
 */
export async function verifyTurnstile(
  token: unknown,
  secret: string | undefined,
  remoteIp: string | null,
): Promise<TurnstileOutcome> {
  if (!secret) return { ok: false, reason: "not-configured" };
  if (typeof token !== "string" || !token || token.length > TOKEN_MAX) {
    return { ok: false, reason: "missing-token" };
  }
  try {
    const response = await fetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        secret,
        response: token,
        ...(remoteIp ? { remoteip: remoteIp } : {}),
      }),
    });
    if (!response.ok) return { ok: false, reason: "unavailable" };
    const result = (await response.json()) as { success?: unknown };
    return result.success === true ? { ok: true } : { ok: false, reason: "rejected" };
  } catch {
    return { ok: false, reason: "unavailable" };
  }
}
