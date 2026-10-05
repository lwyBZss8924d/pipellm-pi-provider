import { CodexSecurity } from "@openai/codex-security";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { releaseGate } from "./security-gate";

const repository = resolve(process.argv[2] || ".");
const outputDir = process.env.CODEX_SECURITY_OUTPUT_DIR || await mkdtemp(join(tmpdir(), "pipellm-security-"));
await mkdir(outputDir, { recursive: true, mode: 0o700 });
const security = new CodexSecurity({ codexOverrides: {
 model: process.env.CODEX_SECURITY_MODEL || "gpt-6.1-sol", model_reasoning_effort: "high",
} });
try {
 const options = { auth: "chatgpt" as const, mode: "standard" as const, outputDir,
  knowledgeBasePaths: [join(repository, "SECURITY.md")], failureSeverity: "high" as const };
 if (process.argv.includes("--preflight")) {
  const preview = await security.preflight(repository, options);
  console.log(JSON.stringify({ preflight: true, authentication: preview.authentication.method, model: preview.model }));
 } else {
  const result = await security.run(repository, options);
  const gate = releaseGate(result);
  // Publish only aggregate gate metadata; detailed reports remain on the runner.
  console.log(JSON.stringify(gate));
  await writeFile(join(outputDir, "release-gate.json"), JSON.stringify(gate, null, 2) + "\n", { mode: 0o600 });
  if (!gate.passed) process.exitCode = 1;
 }
} finally { await security.close(); }
