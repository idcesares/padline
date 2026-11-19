export function createRouteLoader() {
  let generation = 0;
  return {
    cancel() { generation++; },
    async load<T>(fetch: () => Promise<T>, mount: (value: T) => void, fail: () => void): Promise<void> {
      const current = ++generation;
      let value: T;
      try { value = await fetch(); } catch {
        if (current === generation) fail();
        return;
      }
      if (current === generation) mount(value);
    },
  };
}
