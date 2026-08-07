export type PinRecord = { salt: string; hash: string };

type PinFails = { count: number; lastAt: number };
type SecurityEnv = { ADMIN_SECRET?: string };

const MAX_SESSIONS = 200;
const PIN_FREE_ATTEMPTS = 5;
const PIN_BACKOFF_MAX_MS = 60_000;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

export async function hashPin(
  pin: string,
  existingSalt?: string,
): Promise<PinRecord> {
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
export function safeEqual(a: string, b: string): boolean {
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

export class RoomSecurity {
  constructor(
    private readonly storage: DurableObjectStorage,
    private readonly env: SecurityEnv,
  ) {}

  async createSession(): Promise<string> {
    const token = crypto.randomUUID();
    const sessions =
      (await this.storage.get<Record<string, number>>("sessions")) ?? {};
    sessions[token] = Date.now();
    const entries = Object.entries(sessions);
    if (entries.length > MAX_SESSIONS) {
      entries.sort((a, b) => a[1] - b[1]);
      for (const [old] of entries.slice(0, entries.length - MAX_SESSIONS)) {
        delete sessions[old];
      }
    }
    await this.storage.put("sessions", sessions);
    return token;
  }

  /**
   * ADR-0010: a purge wipes every access secret the room holds. `roToken` is
   * minted by the read-only-link capability rather than here, but it is a
   * capability secret and a purge that left it behind would keep old
   * read-only links alive against the emptied pad.
   */
  async clearSecrets(): Promise<void> {
    await this.storage.delete(["pin", "sessions", "roToken", "pinFails"]);
  }

  async canEdit(token: string | null): Promise<boolean> {
    const pin = await this.storage.get<PinRecord>("pin");
    if (!pin) return true;
    return !!token && (await this.isValidSession(token));
  }

  async pinRetryDelay(): Promise<number> {
    const fails = await this.storage.get<PinFails>("pinFails");
    if (!fails || fails.count < PIN_FREE_ATTEMPTS) return 0;
    const wait = Math.min(
      1000 * 2 ** (fails.count - PIN_FREE_ATTEMPTS),
      PIN_BACKOFF_MAX_MS,
    );
    return Math.max(0, fails.lastAt + wait - Date.now());
  }

  async recordPinFailure(): Promise<void> {
    const fails = (await this.storage.get<PinFails>("pinFails")) ?? {
      count: 0,
      lastAt: 0,
    };
    await this.storage.put("pinFails", {
      count: fails.count + 1,
      lastAt: Date.now(),
    });
  }

  async isAdmin(request: Request): Promise<boolean> {
    const secret = this.env.ADMIN_SECRET;
    if (!secret) return false;
    const auth = request.headers.get("authorization") ?? "";
    const provided = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    return provided.length > 0 && (await digestEqual(provided, secret));
  }

  private async isValidSession(token: string): Promise<boolean> {
    const sessions = await this.storage.get<Record<string, number>>("sessions");
    const grantedAt = sessions?.[token];
    if (grantedAt === undefined) return false;
    if (Date.now() - grantedAt > SESSION_TTL_MS) {
      delete sessions![token];
      await this.storage.put("sessions", sessions);
      return false;
    }
    return true;
  }
}
