// Test-only: a throwaway RSA key standing in for the Access team's signing key.

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = "";
  for (const b of view) bin += String.fromCharCode(b);
  return btoa(bin).replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
};

export type AccessKey = {
  kid: string;
  privateKey: CryptoKey;
  jwks: { keys: (JsonWebKey & { kid: string })[] };
};

export async function makeAccessKey(): Promise<AccessKey> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const kid = crypto.randomUUID();
  const publicJwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return {
    kid,
    privateKey: pair.privateKey,
    jwks: { keys: [{ ...publicJwk, kid, alg: "RS256", use: "sig" }] },
  };
}

export async function signJwt(
  key: AccessKey,
  claims: Record<string, unknown>,
): Promise<string> {
  const enc = new TextEncoder();
  const header = b64url(enc.encode(JSON.stringify({ alg: "RS256", kid: key.kid, typ: "JWT" })));
  const payload = b64url(enc.encode(JSON.stringify(claims)));
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    key.privateKey,
    enc.encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${b64url(signature)}`;
}
