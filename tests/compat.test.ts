import { expect, test } from "bun:test";
import { relocateSystem, adaptiveThinking, toPosixPaths, compatModels } from "../compat";
import golden from "./fixtures/compat-golden.json";
const environment = { cwd: "/synthetic/project", home: "/synthetic/home", platform: "synthetic-platform", shell: "/synthetic/shell" };
test("opt-in default is empty and the retired variable has no authority", () => {
 expect(compatModels()).toEqual(new Set());
 expect(compatModels(" none, claude-opus-5-5, claude-opus-5-5 ")).toEqual(new Set(["claude-opus-5-5"]));
});
test("0.1.0 golden request transforms remain exact and do not mutate input", () => {
 for (const fixture of golden) {
  const before = structuredClone(fixture.input);
  expect(adaptiveThinking(relocateSystem(fixture.input, environment))).toEqual(fixture.output);
  expect(fixture.input).toEqual(before);
 }
});
test("legacy path translation is only a compatibility function", () => {
 expect(toPosixPaths('cat C:\\Users\\tester\\file.txt', '/Users/tester', false)).toBe('cat /Users/tester/file.txt');
 expect(toPosixPaths('C:\\Users\\tester\\file.txt', 'C:\\Users\\tester', true)).toBe('C:\\Users\\tester\\file.txt');
});
