import { expect, test } from "bun:test";
import { releaseGate } from "../scripts/security-gate";
import type { ScanResult } from "@openai/codex-security";

test("release gate refuses errors, partial coverage, deferred review and high findings", () => {
 const result = (status = "completed", completeness = "complete", deferred: object[] = [], blocked = false) => ({
  manifest: { scan: { status } }, coverage: { completeness, deferred }, findings: { findings: [] },
  hasFindingsAtOrAbove: (threshold: string) => { expect(threshold).toBe("high"); return blocked; },
 }) as unknown as ScanResult;
 expect(releaseGate(result()).passed).toBe(true);
 for (const fixture of [result("failed"), result("interrupted"), result("completed", "partial"),
  result("completed", "unknown"), result("completed", "complete", [{}]), result("completed", "complete", [], true)]) {
  expect(releaseGate(fixture).passed).toBe(false);
 }
});
