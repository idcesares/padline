import { describe, expect, it, vi } from "vitest";
import { createRouteLoader } from "../src/route-loader";

describe("route loading", () => {
  it("does not mount a view after navigation has moved on", async () => {
    let resolve!: (value: string) => void;
    const pending = new Promise<string>((done) => { resolve = done; });
    const loader = createRouteLoader();
    const mount = vi.fn();
    const fail = vi.fn();
    const result = loader.load(() => pending, mount, fail);
    loader.cancel();
    resolve("old pad");
    await result;
    expect(mount).not.toHaveBeenCalled();
    expect(fail).not.toHaveBeenCalled();
  });

  it("reports a current route load failure, but ignores a stale one", async () => {
    const loader = createRouteLoader();
    const mount = vi.fn();
    const fail = vi.fn();
    await loader.load(() => Promise.reject(new Error("offline")), mount, fail);
    expect(fail).toHaveBeenCalledOnce();
    let reject!: (reason: Error) => void;
    const pending = new Promise<string>((_, failPromise) => { reject = failPromise; });
    const result = loader.load(() => pending, mount, fail);
    loader.cancel();
    reject(new Error("offline"));
    await result;
    expect(fail).toHaveBeenCalledOnce();
  });
});
