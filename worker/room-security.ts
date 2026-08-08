type PinRecord = { salt: string; hash: string };

type PinFails = { count: number; lastAt: number };
type SecurityEnv = { ADMIN_SECRET?: string };

// ADR-0009: brute-force backoff and token lifetimes.
const MAX_SESSIONS = 200;
const PIN_FREE_ATTEMPTS = 5;
const PIN_BACKOFF_MAX_MS = 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const PIN_MIN_LENGTH = 4;
const PIN_MAX_LENGTH = 64;

const PIN_KEY = "pin";
const SESSIONS_KEY = "sessions";
const PIN_FAILS_KEY = "pinFails";
const RO_TOKEN_KEY = "roToken";

/**
 * Supplied lazily because the guards ahead of it run first: a pad with no PIN,
 * or one inside its backoff window, is answered without the candidate ever
 * being read. `null` means the caller could not produce one.
 */
export type PinCandidate = () => Promise<string | null>;

export type VerifyPinOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: "no-pin" }
  | { ok: false; reason: "throttled"; retryInMs: number }
  | { ok: false; reason: "unreadable" }
  | { ok: false; reason: "wrong-pin" };

export type SetPinOutcome =
  | { ok: true; token: string }
  | { ok: false; reason: "invalid-pin" };

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

async function hashPin(pin: string, existingSalt?: string): Promise<PinRecord> {
  const salt = existingSalt
    ? fromBase64(existingSalt)
    : crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: salt as BufferSource,
      iterations: 100_000,
    },
    key,
    256,
  );
  return { salt: toBase64(salt), hash: toBase64(new Uint8Array(bits)) };
}

/**
 * Constant-time compare for values that are already fixed-length — base64
 * hashes and UUIDs. The length check short-circuits, so this must not be
 * used directly on a secret whose length is not already public: see
 * digestEqual.
 */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

/**
 * Constant-time compare for secrets of unknown length. SHA-256 first so both
 * operands are always 44 base64 chars — otherwise safeEqual's length
 * short-circuit lets a caller probe the length of ADMIN_SECRET.
 */
async function digestEqual(a: string, b: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [left, right] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(a)),
    crypto.subtle.digest("SHA-256", encoder.encode(b)),
  ]);
  return safeEqual(
    toBase64(new Uint8Array(left)),
    toBase64(new Uint8Array(right)),
  );
}

/**
 * Every access credential a pad holds: the PIN, the edit sessions it grants,
 * the failure backoff protecting it, and the read-only link token. The keys,
 * the hashing, both comparison primitives, and the rules about what counts as
 * a valid PIN are private — callers ask for outcomes (ADR-0005, ADR-0009).
 *
 * It owns the write side as well as the read side deliberately. Both
 * transports consume it: PadRoom.onConnect admits a WebSocket through
 * `canEdit` or `verifyReadOnlyToken`, and the HTTP capability paths authorize
 * and drive transitions through it. A credential whose validation lived here
 * while its invalidation lived in the caller could not keep the two agreeing.
 *
 * This module has no outbound calls, so WebSocket admission never reaches its
 * authorization decision through the HTTP capability module (ADR-0015).
 */
export class RoomSecurity {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: SecurityEnv,
  ) {}

  /** ADR-0005: a PIN gates view and edit, so this is the whole pad's state. */
  async isPinProtected(): Promise<boolean> {
    return !!(await this.storage.get<PinRecord>(PIN_KEY));
  }

  async canEdit(token: string | null): Promise<boolean> {
    const pin = await this.storage.get<PinRecord>(PIN_KEY);
    if (!pin) return true;
    return !!token && (await this.isValidSession(token));
  }

  /** Fails closed: an unknown token, and a pad that never minted one, refuse. */
  async verifyReadOnlyToken(candidate: string): Promise<boolean> {
    if (!candidate) return false;
    const stored = await this.storage.get<string>(RO_TOKEN_KEY);
    return !!stored && safeEqual(candidate, stored);
  }

  async isAdmin(request: Request): Promise<boolean> {
    const secret = this.env.ADMIN_SECRET;
    if (!secret) return false;
    const auth = request.headers.get("authorization") ?? "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    return provided.length > 0 && (await digestEqual(provided, secret));
  }

  /**
   * ADR-0009: five free attempts, then an exponential window. The counter is
   * cleared by success, not aged out, so a legitimate visitor who eventually
   * remembers the PIN starts from a clean slate.
   */
  async verifyPin(candidate: PinCandidate): Promise<VerifyPinOutcome> {
    const pin = await this.storage.get<PinRecord>(PIN_KEY);
    if (!pin) return { ok: false, reason: "no-pin" };

    const retryInMs = await this.pinRetryDelay();
    if (retryInMs > 0) return { ok: false, reason: "throttled", retryInMs };

    const presented = await candidate();
    if (presented === null) return { ok: false, reason: "unreadable" };

    const hashed = await hashPin(presented, pin.salt);
    if (!safeEqual(hashed.hash, pin.hash)) {
      await this.recordPinFailure();
      return { ok: false, reason: "wrong-pin" };
    }
    await this.storage.delete(PIN_FAILS_KEY);
    return { ok: true, token: await this.createSession() };
  }

  /**
   * Claiming or changing a PIN invalidates every session granted under the
   * old one, so the new holder is not sharing edit rights with whoever was
   * already inside. The setter is handed a fresh session in exchange.
   */
  async setPin(candidate: string): Promise<SetPinOutcome> {
    const pin = candidate.trim();
    if (pin.length < PIN_MIN_LENGTH || pin.length > PIN_MAX_LENGTH) {
      return { ok: false, reason: "invalid-pin" };
    }
    await this.storage.put(PIN_KEY, await hashPin(pin));
    await this.storage.delete(SESSIONS_KEY);
    return { ok: true, token: await this.createSession() };
  }

  /** Unprotecting a pad retires the sessions the PIN existed to grant. */
  async removePin(): Promise<void> {
    await this.storage.delete([PIN_KEY, SESSIONS_KEY]);
  }

  /** The pad's read-only link token, minted on first request (ADR-0005). */
  async readOnlyToken(): Promise<string> {
    // Truthiness, not nullishness: an empty stored token is one that
    // verifyReadOnlyToken would refuse, so handing it out would be a link
    // that cannot connect.
    const existing = await this.storage.get<string>(RO_TOKEN_KEY);
    return existing || (await this.mintReadOnlyToken());
  }

  /**
   * ADR-0009: rotating mints a replacement, so shared links stop working when
   * they next connect. Sockets already reading through the old token keep
   * their connection — the token is checked at admission, not per message.
   */
  async rotateReadOnlyToken(): Promise<string> {
    return this.mintReadOnlyToken();
  }

  /** ADR-0010: a purge wipes every access secret the room holds. */
  async clearSecrets(): Promise<void> {
    await this.storage.delete([
      PIN_KEY,
      SESSIONS_KEY,
      RO_TOKEN_KEY,
      PIN_FAILS_KEY,
    ]);
  }

  private async mintReadOnlyToken(): Promise<string> {
    const token = crypto.randomUUID();
    await this.storage.put(RO_TOKEN_KEY, token);
    return token;
  }

  private async createSession(): Promise<string> {
    const token = crypto.randomUUID();
    const sessions =
      (await this.storage.get<Record<string, number>>(SESSIONS_KEY)) ?? {};
    sessions[token] = Date.now();
    const entries = Object.entries(sessions);
    if (entries.length > MAX_SESSIONS) {
      entries.sort((a, b) => a[1] - b[1]);
      for (const [old] of entries.slice(0, entries.length - MAX_SESSIONS)) {
        delete sessions[old];
      }
    }
    await this.storage.put(SESSIONS_KEY, sessions);
    return token;
  }

  private async pinRetryDelay(): Promise<number> {
    const fails = await this.storage.get<PinFails>(PIN_FAILS_KEY);
    if (!fails || fails.count < PIN_FREE_ATTEMPTS) return 0;
    const wait = Math.min(
      1000 * 2 ** (fails.count - PIN_FREE_ATTEMPTS),
      PIN_BACKOFF_MAX_MS,
    );
    return Math.max(0, fails.lastAt + wait - Date.now());
  }

  private async recordPinFailure(): Promise<void> {
    const fails = (await this.storage.get<PinFails>(PIN_FAILS_KEY)) ?? {
      count: 0,
      lastAt: 0,
    };
    await this.storage.put(PIN_FAILS_KEY, {
      count: fails.count + 1,
      lastAt: Date.now(),
    });
  }

  private async isValidSession(token: string): Promise<boolean> {
    const sessions =
      await this.storage.get<Record<string, number>>(SESSIONS_KEY);
    const grantedAt = sessions?.[token];
    if (grantedAt === undefined) return false;
    if (Date.now() - grantedAt > SESSION_TTL_MS) {
      delete sessions![token];
      await this.storage.put(SESSIONS_KEY, sessions);
      return false;
    }
    return true;
  }
}
