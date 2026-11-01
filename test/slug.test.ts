import { describe, expect, it } from "vitest";
import { checkSlug, isValidSlug, normalizeSlug, randomSlug, RESERVED_SLUGS } from "../shared/slug";

describe("normalizeSlug", () => {
  it("folds accents, spaces and case", () => {
    expect(normalizeSlug("Reunião de Sexta")).toBe("reuniao-de-sexta");
  });

  it("turns underscores into hyphens and drops other symbols", () => {
    expect(normalizeSlug("my_pad!?#1")).toBe("my-pad1");
  });

  it("collapses and trims hyphens", () => {
    expect(normalizeSlug("--a---b--")).toBe("a-b");
  });

  it("caps the length at 64 without leaving a trailing hyphen", () => {
    const slug = normalizeSlug(`${"a".repeat(63)} b`);
    expect(slug.length).toBeLessThanOrEqual(64);
    expect(slug.endsWith("-")).toBe(false);
  });

  it("can return an empty string", () => {
    expect(normalizeSlug("!!!")).toBe("");
  });
});

describe("checkSlug", () => {
  it("accepts ordinary slugs", () => {
    expect(checkSlug("paraty-weekend")).toBe("ok");
    expect(checkSlug("a")).toBe("ok");
    expect(checkSlug("2026")).toBe("ok");
  });

  it("rejects empty, over-long and malformed slugs", () => {
    expect(checkSlug("")).toBe("invalid");
    expect(checkSlug("a".repeat(65))).toBe("invalid");
    expect(checkSlug("-a")).toBe("invalid");
    expect(checkSlug("a-")).toBe("invalid");
    expect(checkSlug("A")).toBe("invalid");
    expect(checkSlug("a/b")).toBe("invalid");
  });

  it("refuses every reserved slug", () => {
    for (const slug of RESERVED_SLUGS) expect(checkSlug(slug)).toBe("reserved");
    expect(isValidSlug("admin")).toBe(false);
  });
});

describe("randomSlug", () => {
  it("always produces an openable address", () => {
    for (let i = 0; i < 200; i++) expect(checkSlug(randomSlug())).toBe("ok");
  });
});
