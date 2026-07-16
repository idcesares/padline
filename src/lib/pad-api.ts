export type PadInfo = { pinProtected: boolean };
export type SnapshotMeta = { id: number; createdAt: number; size: number };

const base = (slug: string) => `/parties/pad-room/${slug}`;

export const tokenStorageKey = (slug: string) => `padline:token:${slug}`;

function withParams(
  slug: string,
  params: Record<string, string | undefined>,
): string {
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) search.set(k, v);
  }
  return `${base(slug)}?${search.toString()}`;
}

export async function fetchPadInfo(slug: string): Promise<PadInfo> {
  const res = await fetch(withParams(slug, { op: "info" }));
  if (!res.ok) throw new Error("info-failed");
  return res.json();
}

/** Returns a session token, or null when the PIN is wrong. */
export async function verifyPin(
  slug: string,
  pin: string,
): Promise<string | null> {
  const res = await fetch(withParams(slug, { op: "verify-pin" }), {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
  if (res.status === 403) return null;
  if (!res.ok) throw new Error("verify-failed");
  const data = (await res.json()) as { token: string };
  return data.token;
}

/** Sets a new PIN; returns the setter's session token. */
export async function setPin(
  slug: string,
  pin: string,
  token?: string,
): Promise<string> {
  const res = await fetch(withParams(slug, { op: "set-pin", token }), {
    method: "POST",
    body: JSON.stringify({ pin }),
  });
  if (!res.ok) throw new Error("set-pin-failed");
  const data = (await res.json()) as { token: string };
  return data.token;
}

export async function removePin(slug: string, token?: string): Promise<void> {
  const res = await fetch(withParams(slug, { op: "set-pin", token }), {
    method: "POST",
    body: JSON.stringify({ remove: true }),
  });
  if (!res.ok) throw new Error("remove-pin-failed");
}

export async function fetchRoToken(
  slug: string,
  token?: string,
): Promise<string> {
  const res = await fetch(withParams(slug, { op: "ro-token", token }));
  if (!res.ok) throw new Error("ro-token-failed");
  const data = (await res.json()) as { token: string };
  return data.token;
}

/** Mints a new read-only token; previously shared links stop working. */
export async function rotateRoToken(
  slug: string,
  token?: string,
): Promise<string> {
  const res = await fetch(withParams(slug, { op: "ro-token", token }), {
    method: "POST",
  });
  if (!res.ok) throw new Error("ro-token-rotate-failed");
  const data = (await res.json()) as { token: string };
  return data.token;
}

export async function fetchSnapshots(
  slug: string,
  token?: string,
): Promise<SnapshotMeta[]> {
  const res = await fetch(withParams(slug, { op: "snapshots", token }));
  if (!res.ok) throw new Error("snapshots-failed");
  return res.json();
}

export async function restoreSnapshot(
  slug: string,
  id: number,
  token?: string,
): Promise<void> {
  const res = await fetch(withParams(slug, { op: "restore", token }), {
    method: "POST",
    body: JSON.stringify({ id }),
  });
  if (!res.ok) throw new Error("restore-failed");
}
