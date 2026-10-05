/** Observe only names from the actual request. Reset on a native session change. */
export function createToolGuard() {
  let requested: Set<string> | undefined;
  let warned = false;
  return {
    reset() {
      requested = undefined;
      warned = false;
    },
    request(payload: unknown) {
      if (!payload || typeof payload !== 'object') {
        requested = undefined;
        return;
      }
      const tools = (payload as { tools?: { name?: unknown }[] } | undefined)?.tools;
      requested =
        tools === undefined
          ? new Set()
          : Array.isArray(tools)
            ? new Set(tools.flatMap((tool) => (typeof tool?.name === 'string' ? [tool.name] : [])))
            : undefined;
    },
    observe(name: string): boolean {
      if (!requested || requested.has(name) || warned) return false;
      warned = true;
      return true;
    },
  };
}
