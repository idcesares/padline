// ADR-0002: the admin surface sits behind Cloudflare Access, and the Worker
// checks the assertion itself. Access in front is not enough: a request that
// reaches the Worker some other way (workers.dev, a misrouted rule) must still
// fail. WebCrypto only; no JWT library.

export type AccessConfig = { teamDomain: string; aud: string };

type Jwk = JsonWebKey & { kid?: string };
type Jwks = { keys: Jwk[] };

const b64urlToBytes = (s: string): Uint8Array<ArrayBuffer> => {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
};

const decodeJson = (s: string): unknown =>
  JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

/**
 * Verifies a `Cf-Access-Jwt-Assertion`: RS256 signature against the team's
 * keys, then issuer, audience and expiry. Returns the caller's email, or null
 * for anything wrong. Never throws.
 */
export async function verifyAccessJwt(
  token: string,
  config: AccessConfig,
  jwks: Jwks,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ email: string } | null> {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const [h, p, s] = parts;
    const header = decodeJson(h) as { alg?: string; kid?: string };
    if (header.alg !== "RS256" || !header.kid) return null;
    const jwk = jwks.keys.find((k) => k.kid === header.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const ok = await crypto.subtle.verify(
      "RSASSA-PKCS1-v1_5",
      key,
      b64urlToBytes(s),
      new TextEncoder().encode(`${h}.${p}`),
    );
    if (!ok) return null;

    const claims = decodeJson(p) as {
      iss?: string;
      aud?: string | string[];
      exp?: number;
      nbf?: number;
      email?: string;
    };
    if (claims.iss !== `https://${config.teamDomain}`) return null;
    const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
    if (!audiences.includes(config.aud)) return null;
    if (typeof claims.exp !== "number" || claims.exp <= nowSeconds) return null;
    if (typeof claims.nbf === "number" && claims.nbf > nowSeconds + 60) return null;
    return { email: claims.email ?? "" };
  } catch {
    return null;
  }
}

const JWKS_TTL_MS = 60 * 60 * 1000;
const JWKS_MIN_REFETCH_MS = 60 * 1000;
let cached: { teamDomain: string; at: number; jwks: Jwks } | null = null;

/** The team's signing keys, cached for an hour; a key id miss forces one refetch. */
async function loadJwks(teamDomain: string, force: boolean): Promise<Jwks> {
  if (cached && cached.teamDomain === teamDomain) {
    const age = Date.now() - cached.at;
    // A forced refetch is itself limited to one a minute, so a stream of bad
    // tokens cannot turn into a stream of requests to the team domain.
    if (age < (force ? JWKS_MIN_REFETCH_MS : JWKS_TTL_MS)) return cached.jwks;
  }
  const response = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!response.ok) throw new Error(`jwks ${response.status}`);
  const jwks = (await response.json()) as Jwks;
  cached = { teamDomain, at: Date.now(), jwks };
  return jwks;
}

/** Test hook: forget the cached keys. */
export function resetJwksCache(): void {
  cached = null;
}

export type AccessEnv = {
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  ADMIN_DEV_BYPASS?: string;
};

const isLocalHost = (hostname: string) =>
  hostname === "localhost" || hostname === "127.0.0.1";

/**
 * Decides whether this request may touch the admin surface. Fails closed: with
 * no Access settings it denies everyone. The one bypass needs both a local
 * hostname and ADMIN_DEV_BYPASS in .dev.vars, which production never has.
 */
export async function authorizeAdmin(
  request: Request,
  env: AccessEnv,
): Promise<{ ok: true; email: string } | { ok: false; status: 401 | 403 }> {
  const hostname = new URL(request.url).hostname;
  if (env.ADMIN_DEV_BYPASS === "1" && isLocalHost(hostname)) {
    return { ok: true, email: "dev@localhost" };
  }
  const teamDomain = env.ACCESS_TEAM_DOMAIN?.trim();
  const aud = env.ACCESS_AUD?.trim();
  if (!teamDomain || !aud) return { ok: false, status: 403 };

  const token = request.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, status: 401 };

  const config = { teamDomain, aud };
  try {
    let result = await verifyAccessJwt(token, config, await loadJwks(teamDomain, false));
    if (!result) {
      // A rotated key looks like a bad signature. Refetch once before denying.
      result = await verifyAccessJwt(token, config, await loadJwks(teamDomain, true));
    }
    return result ? { ok: true, email: result.email } : { ok: false, status: 401 };
  } catch {
    return { ok: false, status: 403 };
  }
}
