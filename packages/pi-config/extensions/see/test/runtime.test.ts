/**
* see/test/runtime.test.ts
*/
import { describe, expect, it } from "vitest";
import { buildSeeArgs, DEFAULT_MODEL } from "../runtime";

describe("buildSeeArgs", () => {
	it("uses the default model", () => {
		expect(buildSeeArgs(["/tmp/a.png"], DEFAULT_MODEL)).toEqual([
			"exec",
			"-s",
			"read-only",
			"--skip-git-repo-check",
			"-m",
			"gpt-5.6-luna",
			"-i",
			"/tmp/a.png",
		]);
	});

	it("honors an explicit model", () => {
		expect(buildSeeArgs(["/tmp/a.png"], "gpt-5.4-mini")).toContain(
			"gpt-5.4-mini",
		);
	});

	it("passes multiple images as repeated -i flags", () => {
		const args = buildSeeArgs(["/tmp/a.png", "/tmp/b.png"], DEFAULT_MODEL);
		expect(args.filter((a) => a === "-i")).toHaveLength(2);
		expect(args).toContain("/tmp/a.png");
		expect(args).toContain("/tmp/b.png");
	});

	it("never puts the prompt in argv (it goes on stdin)", () => {
		const args = buildSeeArgs(["/tmp/a.png"], DEFAULT_MODEL);
		expect(args).not.toContain("describe");
		expect(args).not.toContain("--json");
	});
});
