import type { ScanResult } from "@openai/codex-security";

export function releaseGate(result: Pick<ScanResult, "manifest" | "coverage" | "findings" | "hasFindingsAtOrAbove">) {
 const completed = result.manifest.scan.status === "completed";
 const completeCoverage = result.coverage.completeness === "complete" && result.coverage.deferred.length === 0;
 const blockedFindings = result.hasFindingsAtOrAbove("high");
 return { passed: completed && completeCoverage && !blockedFindings, completed, completeCoverage,
  blockedFindings, findingCount: result.findings.findings.length };
}
