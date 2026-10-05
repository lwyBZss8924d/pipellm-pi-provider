import { spawn } from "node:child_process";

export const KEY_ACCOUNT = "PIPELLM_API_KEY";
export const KEY_SERVICE = "pipellm-pi-provider";
const KEY_PATTERN = /^[A-Za-z0-9._~+/=-]{8,512}$/;
export const validKey = (key: string) => KEY_PATTERN.test(key);
export type CommandResult = { code: number; stdout: string; stderr: string };
export type SecurityRunner = (args: string[], stdin?: string) => Promise<CommandResult>;

// Secrets are passed only on stdin, never in argv, logs, or temporary files.
const runSecurity: SecurityRunner = (args, input) => new Promise((resolve, reject) => {
 const child = spawn("/usr/bin/security", args, { stdio: ["pipe", "pipe", "pipe"] });
 let stdout = "", stderr = "";
 const timer = setTimeout(() => child.kill(), 10000);
 child.stdout.on("data", data => { stdout += data; });
 child.stderr.on("data", data => { stderr += data; });
 child.on("error", () => { clearTimeout(timer); reject(new Error("Cannot access macOS Keychain")); });
 child.on("close", code => { clearTimeout(timer); resolve({ code: code ?? -1, stdout, stderr }); });
 child.stdin.on("error", () => {});
 child.stdin.end(input);
});

export class MacKeychain {
 constructor(private run: SecurityRunner = runSecurity, readonly supported = process.platform === "darwin") {}
 private async find(password: boolean): Promise<CommandResult> {
  if (!this.supported) return { code: 44, stdout: "", stderr: "" };
  const suffix = password ? ["-w"] : [];
  let result = await this.run(["find-generic-password", "-a", KEY_ACCOUNT, "-s", KEY_SERVICE, ...suffix]);
  // Discover existing caches by account name, even with another service label.
  if (result.code === 44) result = await this.run(["find-generic-password", "-a", KEY_ACCOUNT, ...suffix]);
  return result;
 }
 async available(): Promise<boolean> { return (await this.find(false)).code === 0; }
 async read(): Promise<string | undefined> {
  const result = await this.find(true);
  if (result.code === 44) return undefined;
  if (result.code !== 0) throw new Error("macOS Keychain access failed or was denied");
  const key = result.stdout.replace(/\r?\n$/, "");
  if (!validKey(key)) throw new Error("Keychain item is not a valid PipeLLM API key");
  return key;
 }
 async store(key: string): Promise<void> {
  if (!this.supported) throw new Error("Secure Keychain storage requires macOS");
  if (!validKey(key)) throw new Error("Invalid API key format");
  // Keep the service of an existing account item rather than create an ambiguous duplicate.
  const existing = await this.find(false);
  if (existing.code !== 0 && existing.code !== 44) throw new Error("macOS Keychain access failed or was denied");
  const service = existing.code === 0 ? existing.stdout.match(/"svce"<blob>="([^"]*)"/)?.[1] : KEY_SERVICE;
  if (!service || /[\r\n\u0000]/.test(service)) throw new Error("Cannot identify Keychain service safely");
  const quotedService = service.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
  const input = `add-generic-password -U -a "${KEY_ACCOUNT}" -s "${quotedService}" -w "${key}"\n`;
  const result = await this.run(["-i"], input);
  if (result.code !== 0 || /security:/.test(result.stdout + result.stderr)) throw new Error("Could not save API key to macOS Keychain");
  if (await this.read() !== key) throw new Error("Keychain save could not be verified");
 }
}
