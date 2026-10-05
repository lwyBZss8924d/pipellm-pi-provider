import type { Provider } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { MacKeychain, validKey } from "./keychain";
import { gatewayUrl, messagesUrl, saveGateway, validateKey } from "./gateway-config";
import { SecretInput } from "./secret-input";

export function registerGateway(pi: ExtensionAPI, keychain = new MacKeychain(), validate = validateKey) {
 let sessionKey: string | undefined;
 const provider: Provider = {
  id: "pipellm", name: "PipeLLM (Keychain)", getModels: () => [],
  // models.json owns models and Pi composes their native API streams above this auth provider.
  stream: () => { throw new Error("Configure PipeLLM models in models.json"); },
  streamSimple: () => { throw new Error("Configure PipeLLM models in models.json"); },
  auth: { apiKey: {
   name: "PipeLLM API key (macOS Keychain)",
   login: async () => { throw new Error("Use /pipellm-login to validate and save securely to Keychain"); },
   check: async ({ ctx }) => (sessionKey || await ctx.env("PIPELLM_API_KEY") || await keychain.available())
    ? { type: "api_key", source: "PIPELLM_API_KEY / macOS Keychain" } : undefined,
   resolve: async ({ ctx }) => {
    // Ignore legacy stored credentials: this extension never receives/saves a key through auth.json.
    const key = sessionKey || await ctx.env("PIPELLM_API_KEY") || await keychain.read();
    return key ? { auth: { apiKey: key }, source: "PIPELLM_API_KEY / macOS Keychain" } : undefined;
   },
  } },
 };
 pi.registerProvider(provider);
 // Native provider registration refreshes availability asynchronously in Pi 1.0.2.
 // Await a fresh snapshot before startup model listing/selection completes.
 pi.on("session_start", async (_event, ctx) => { await ctx.modelRegistry.refresh({ allowNetwork: false }); });
 const interactive = (args: string, ctx: ExtensionCommandContext) => {
  if (args.trim()) { ctx.ui.notify("Use this command without arguments; enter keys only in the hidden input.", "error"); return false; }
  if (!ctx.hasUI) { ctx.ui.notify("This command requires Pi's interactive TUI.", "error"); return false; }
  return true;
 };
 pi.registerCommand("pipellm-config", {
  description: "Configure PipeLLM gateway and model in models.json (no stored API key)",
  handler: async (args, ctx) => {
   if (!interactive(args, ctx)) return;
   try {
    const current = ctx.modelRegistry.getAll().find(m => m.provider === "pipellm");
    const base = await ctx.ui.input("PipeLLM HTTPS gateway URL", current?.baseUrl || "https://cc-api.pipellm.ai/anthropic");
    if (base === undefined) return;
    const baseUrl = gatewayUrl(base);
    const id = await ctx.ui.input("PipeLLM model ID", current?.id || "claude-sonnet-5-5");
    if (id === undefined) return;
    const template = ctx.modelRegistry.getAll().find(m => m.id === id && m.api === "anthropic-messages");
    const context = await ctx.ui.input("Context window (tokens)", String(template?.contextWindow || 1048576));
    if (context === undefined) return;
    const output = await ctx.ui.input("Maximum output (tokens)", String(template?.maxTokens || 128000));
    if (output === undefined) return;
    const thinking = await ctx.ui.select("Thinking policy", ["Adaptive only", "Native/default"]);
    if (thinking === undefined) return;
    if (!await ctx.ui.confirm("Save PipeLLM configuration", `${baseUrl}\nModel: ${id}\nExisting models.json will be backed up. API keys will use Keychain or PIPELLM_API_KEY.`)) return;
    const saved = await saveGateway(baseUrl, { id, name: id, reasoning: template?.reasoning ?? true,
     input: template?.input || ["text", "image"], cost: template?.cost || { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
     contextWindow: Number(context), maxTokens: Number(output), compat: { forceAdaptiveThinking: thinking === "Adaptive only" } });
    await ctx.modelRegistry.refresh({ allowNetwork: false });
    ctx.ui.notify(`Saved ${saved.path}${saved.backup ? "; previous file backed up" : ""}. Use /pipellm-login, then /model pipellm/${id}.`, "info");
   } catch { ctx.ui.notify("Could not save PipeLLM configuration. Check HTTPS URL, model ID, token limits, and models.json permissions.", "error"); }
  },
 });
 pi.registerCommand("pipellm-login", {
  description: "Validate an API key in hidden input, then save to macOS Keychain",
  handler: async (args, ctx) => {
   if (!interactive(args, ctx)) return;
   if (!keychain.supported) { ctx.ui.notify("Keychain storage requires macOS. On other systems supply PIPELLM_API_KEY in the environment.", "error"); return; }
   if (typeof ctx.ui.custom !== "function") { ctx.ui.notify("This client lacks the hidden TUI input required for secure login.", "error"); return; }
   try {
    const models = ctx.modelRegistry.getAll().filter(m => m.provider === "pipellm" && m.api === "anthropic-messages");
    let model = ctx.model?.provider === "pipellm" ? models.find(m => m.id === ctx.model!.id) : undefined;
    if (!model && models.length === 1) model = models[0];
    if (!model && models.length > 1) {
     const selected = await ctx.ui.select("PipeLLM validation model", models.map(m => m.id));
     if (selected === undefined) return;
     model = models.find(m => m.id === selected);
    }
    if (!model) { ctx.ui.notify("Configure a PipeLLM model first with /pipellm-config.", "warning"); return; }
    if (!await ctx.ui.confirm("Validate and save API key", `Send one small request to ${messagesUrl(model.baseUrl)} using ${model.id}, then save a successful key to macOS Keychain?`)) return;
    let key = await ctx.ui.custom<string | undefined>((tui, _theme, _keys, done) => new SecretInput(done, () => tui.requestRender()));
    if (key === undefined) return;
    try {
     if (!validKey(key)) throw new Error("Invalid key format");
     await validate(key, model);
     await keychain.store(key);
     sessionKey = key;
    } finally { key = undefined; }
    await ctx.modelRegistry.refresh({ allowNetwork: false });
    ctx.ui.notify("API key validated and saved to macOS Keychain. No API key was written to auth.json or models.json.", "info");
   } catch { ctx.ui.notify("PipeLLM login failed. Check gateway/model, API key, connectivity, and Keychain access. No unvalidated key was saved.", "error"); }
  },
 });
 pi.registerCommand("pipellm-status", {
  description: "Show configured PipeLLM models and credential availability without revealing keys",
  handler: async (_args, ctx) => {
   try {
    const env = !!process.env.PIPELLM_API_KEY;
    const available = !!sessionKey || env || await keychain.available();
    const count = ctx.modelRegistry.getAll().filter(m => m.provider === "pipellm").length;
    ctx.ui.notify(`PipeLLM models: ${count}; credential available: ${available ? "yes" : "no"}; Keychain: ${keychain.supported ? "macOS" : "unsupported"}.`, "info");
   } catch { ctx.ui.notify("Could not check macOS Keychain availability.", "warning"); }
  },
 });
 return provider;
}
