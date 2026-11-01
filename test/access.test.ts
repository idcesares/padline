import { describe, expect, it } from "vitest";
import { verifyAccessJwt } from "../worker/access";
import { makeAccessKey, signJwt } from "./access-helpers";

const TEAM = "team.test.cloudflareaccess.com";
const config = { teamDomain: TEAM, aud: "test-aud" };
const NOW = 1_800_000_000;

const claims = (over: Record<string, unknown> = {}) => ({
  iss: `https://${TEAM}`,
  aud: ["test-aud"],
  exp: NOW + 600,
  email: "op@example.com",
  ...over,
});

describe("verifyAccessJwt", () => {
  it("accepts a valid assertion", async () => {
    const key = await makeAccessKey();
    const token = await signJwt(key, claims());
    expect(await verifyAccessJwt(token, config, key.jwks, NOW)).toEqual({
      email: "op@example.com",
    });
  });

  it("rejects the wrong audience", async () => {
    const key = await makeAccessKey();
    const token = await signJwt(key, claims({ aud: ["someone-else"] }));
    expect(await verifyAccessJwt(token, config, key.jwks, NOW)).toBeNull();
  });

  it("rejects the wrong issuer", async () => {
    const key = await makeAccessKey();
    const token = await signJwt(key, claims({ iss: "https://evil.example.com" }));
    expect(await verifyAccessJwt(token, config, key.jwks, NOW)).toBeNull();
  });

  it("rejects an expired assertion", async () => {
    const key = await makeAccessKey();
    const token = await signJwt(key, claims({ exp: NOW - 1 }));
    expect(await verifyAccessJwt(token, config, key.jwks, NOW)).toBeNull();
  });

  it("rejects a signature from another key", async () => {
    const signer = await makeAccessKey();
    const other = await makeAccessKey();
    const token = await signJwt(signer, claims());
    // Same kid, different key material.
    const jwks = { keys: [{ ...other.jwks.keys[0], kid: signer.kid }] };
    expect(await verifyAccessJwt(token, config, jwks, NOW)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const key = await makeAccessKey();
    const token = await signJwt(key, claims());
    const [h, , s] = token.split(".");
    const forged = btoa(JSON.stringify(claims({ email: "root@example.com" })))
      .replace(/=+$/, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    expect(await verifyAccessJwt(`${h}.${forged}.${s}`, config, key.jwks, NOW)).toBeNull();
  });

  it("rejects alg none and garbage without throwing", async () => {
    const key = await makeAccessKey();
    const none = `${btoa('{"alg":"none","kid":"x"}')}.${btoa("{}")}.`;
    expect(await verifyAccessJwt(none, config, key.jwks, NOW)).toBeNull();
    expect(await verifyAccessJwt("not-a-token", config, key.jwks, NOW)).toBeNull();
  });
});
