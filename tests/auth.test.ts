import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MacKeychain, KEY_ACCOUNT, validKey, type SecurityRunner } from "../keychain";
import { SecretInput } from "../secret-input";
import { gatewayUrl, messagesUrl, saveGateway, validateKey, type GatewayModel } from "../gateway-config";
import { registerGateway } from "../auth";

const key = "synthetic-secret-123456";
const model = { id: "synthetic", provider: "pipellm", api: "anthropic-messages", baseUrl: "https://example.invalid/anthropic" };
const declaration: GatewayModel = { id: model.id, name: model.id, reasoning: true, input: ["text"],
 cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 4096, maxTokens: 128,
 compat: { forceAdaptiveThinking: true } };

function memoryKeychain(initial: string | null = key) {
 let value: string | undefined = initial ?? undefined;
 const calls: { args: string[]; input?: string }[] = [];
 const run: SecurityRunner = async (args, input) => {
  calls.push({ args, input });
  if (args[0] === "-i") { value = input?.match(/-w "([^"]+)"/)?.[1]; return { code: 0, stdout: "", stderr: "" }; }
  if (!value) return { code: 44, stdout: "", stderr: "" };
  return { code: 0, stdout: args.includes("-w") ? value + "\n" : '"svce"<blob>="pipellm-pi-provider"\n', stderr: "" };
 };
 return { store: new MacKeychain(run, true), calls, value: () => value };
}
function fake(keychain = memoryKeychain()) {
 const commands = new Map<string, any>(); const notices: string[] = []; let registered: any;
 registerGateway({ on: () => {}, registerProvider: (p: any) => { registered = p; }, registerCommand: (n: string, c: any) => commands.set(n, c) } as any,
  keychain.store, async () => {});
 const ctx: any = { hasUI: true, model,
  modelRegistry: { getAll: () => [model], refresh: async () => {} },
  ui: { confirm: async () => true, custom: async () => key, notify: (message: string) => notices.push(message) } };
 return { commands, notices, provider: registered, ctx, keychain };
}

test("Keychain secret travels on stdin only; save is verified and metadata checks never request passwords", async () => {
 const backend = memoryKeychain(null);
 expect(await backend.store.available()).toBe(false);
 expect(backend.calls.every(c => !c.args.includes("-w"))).toBe(true);
 await backend.store.store(key);
 expect(await backend.store.read()).toBe(key);
 expect(backend.calls.find(c => c.args[0] === "-i")?.input).toContain(key);
 expect(backend.calls.every(c => !c.args.some(arg => arg.includes(key)))).toBe(true);
 expect(backend.calls.every(c => !c.args.includes("-A"))).toBe(true);
 expect(validKey('bad"\nadd-generic-password')).toBe(false);
 expect(validKey("short")).toBe(false);
});
test("legacy account-only discovery works; denied access does not masquerade as a missing item", async () => {
 const calls: string[][] = [];
 const legacy = new MacKeychain(async args => {
  calls.push(args);
  return args.includes("-s") ? { code: 44, stdout: "", stderr: "" } :
   { code: 0, stdout: args.includes("-w") ? key + "\n" : '"svce"<blob>="legacy-cache"\n', stderr: "" };
 }, true);
 expect(await legacy.read()).toBe(key);
 expect(calls[1]).toEqual(["find-generic-password", "-a", KEY_ACCOUNT, "-w"]);
 const denied = new MacKeychain(async () => ({ code: -1, stdout: "", stderr: key }), true);
 await expect(denied.read()).rejects.toThrow("access failed");
 await expect(denied.store(key)).rejects.toThrow("access failed");
});
test("masked TUI input never renders a secret, handles bracketed paste and clears on escape", () => {
 const values: (string | undefined)[] = [];
 const input = new SecretInput(value => values.push(value), () => {});
 input.handleInput("\x1b[200~" + key + "\n\x1b[201~");
 expect(values).toEqual([]);
 expect(input.render(80).join("\n")).not.toContain(key);
 expect(input.render(80)[1]).toBe("*".repeat(key.length));
 input.handleInput("\r"); expect(values).toEqual([key]);
 expect(input.render(80)[1]).toBe("");
 const cancelled = new SecretInput(value => values.push(value), () => {});
 cancelled.handleInput(key); cancelled.handleInput("\x1b");
 expect(values.at(-1)).toBeUndefined(); expect(cancelled.render(80)[1]).toBe("");
});
test("validation uses one HTTPS request, refuses redirects, and redacts server error bodies", async () => {
 expect(messagesUrl("https://example.invalid/anthropic")).toBe("https://example.invalid/anthropic/v1/messages");
 expect(messagesUrl("https://example.invalid/v1/")).toBe("https://example.invalid/v1/messages");
 for (const url of ["http://example.invalid", "https://user:password@example.invalid", "https://example.invalid?key=x"]) expect(() => gatewayUrl(url)).toThrow();
 let requests = 0;
 await validateKey(key, model, (async (url: any, init: RequestInit) => {
  requests++; expect(url).toBe(messagesUrl(model.baseUrl)); expect(init.redirect).toBe("error");
  expect((init.headers as any)["x-api-key"]).toBe(key);
  expect(JSON.parse(init.body as string).max_tokens).toBe(1);
  return new Response(JSON.stringify({ type: "message", model: model.id, content: [] }));
 }) as any);
 expect(requests).toBe(1);
 await expect(validateKey(key, model, (async () => new Response(key, { status: 401 })) as any)).rejects.toThrow("HTTP 401");
 await expect(validateKey(key, model, (async () => new Response(JSON.stringify({ error: key }))) as any)).rejects.toThrow("unexpected validation response");
});
test("gateway configuration merges other providers/models, backs up exact bytes, and stores no entered secret", async () => {
 const dir = await mkdtemp(join(tmpdir(), "pipellm-config-"));
 try {
  const path = join(dir, "models.json");
  const before = JSON.stringify({ providers: { other: { baseUrl: "https://other.invalid" }, pipellm: {
   apiKey: "legacy-synthetic-key", models: [{ id: "keep" }],
  } }, custom: "keep" });
  await writeFile(path, before);
  const saved = await saveGateway(model.baseUrl, declaration, path);
  expect(await readFile(saved.backup!, "utf8")).toBe(before);
  const next = JSON.parse(await readFile(path, "utf8"));
  expect(next.providers.other.baseUrl).toBe("https://other.invalid"); expect(next.custom).toBe("keep");
  expect(next.providers.pipellm.models.map((m: any) => m.id)).toEqual(["keep", model.id]);
  expect(next.providers.pipellm.apiKey).not.toContain("legacy-synthetic-key");
  expect(next.providers.pipellm.apiKey).toContain("PIPELLM_API_KEY");
  expect((await stat(path)).mode & 0o777).toBe(0o600);
  expect((await stat(saved.backup!)).mode & 0o777).toBe(0o600);
  expect((await saveGateway(model.baseUrl, declaration, path)).backup).toBeUndefined();
  await expect(saveGateway(model.baseUrl, { ...declaration, maxTokens: 999999 }, path)).rejects.toThrow("token limits");
  const savedBytes = await readFile(path, "utf8");
  await writeFile(path, "invalid JSON");
  await expect(saveGateway(model.baseUrl, declaration, path)).rejects.toThrow();
  expect(await readFile(path, "utf8")).toBe("invalid JSON");
  expect(savedBytes).not.toContain(key);
  expect((await readdir(dir)).some(name => name.endsWith(".tmp"))).toBe(false);
 } finally { await rm(dir, { recursive: true }); }
});
test("native provider ignores legacy plaintext credentials, resolves env or Keychain, and disables unsafe /login fallback", async () => {
 const f = fake();
 const auth = f.provider.auth.apiKey;
 const ctx = { env: async () => undefined };
 expect((await auth.resolve({ ctx, credential: { type: "api_key", key: "legacy-plaintext" } })).auth.apiKey).toBe(key);
 expect((await auth.resolve({ ctx: { env: async () => "synthetic-env-key" } })).auth.apiKey).toBe("synthetic-env-key");
 await expect(auth.login()).rejects.toThrow("/pipellm-login");
 expect(f.commands.size).toBe(3);
});
test("TUI saves only after successful validation, ignores key arguments, and cancellation writes nothing", async () => {
 const backend = memoryKeychain(null); const f = fake(backend);
 await f.commands.get("pipellm-login").handler(key, f.ctx);
 expect(backend.calls).toEqual([]); expect(f.notices.join("\n")).not.toContain(key);
 await f.commands.get("pipellm-login").handler("", { ...f.ctx, ui: { ...f.ctx.ui, custom: async () => undefined } });
 expect(backend.calls).toEqual([]);
 await f.commands.get("pipellm-login").handler("", f.ctx);
 expect(backend.value()).toBe(key); expect(f.notices.join("\n")).not.toContain(key);
 const failedBackend = memoryKeychain(null); const commands = new Map<string, any>(); const notices: string[] = [];
 registerGateway({ on: () => {}, registerProvider: () => {}, registerCommand: (n: string, c: any) => commands.set(n, c) } as any,
  failedBackend.store, async () => { throw new Error(key); });
 await commands.get("pipellm-login").handler("", { ...f.ctx, ui: { ...f.ctx.ui, notify: (s: string) => notices.push(s) } });
 expect(failedBackend.calls).toEqual([]); expect(notices.join("\n")).not.toContain(key);
});
