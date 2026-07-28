/**
 * enhance/test/commands.test.ts
 */
import { describe, expect, it } from "vitest";
import { parseEnhanceArgs } from "../commands";

describe("parseEnhanceArgs", () => {
	it("returns help on empty input", () => {
		expect(parseEnhanceArgs("")).toEqual({ kind: "help" });
	});

	it("parses on / off", () => {
		expect(parseEnhanceArgs("on")).toEqual({ kind: "on" });
		expect(parseEnhanceArgs("off")).toEqual({ kind: "off" });
	});

	it("parses preset with a name", () => {
		expect(parseEnhanceArgs("preset concise")).toEqual({ kind: "preset", name: "concise" });
	});

	it("returns help when preset has no name", () => {
		expect(parseEnhanceArgs("preset")).toEqual({ kind: "help" });
	});

	it("parses list", () => {
		expect(parseEnhanceArgs("list")).toEqual({ kind: "list" });
	});

	it("parses rewrite with text", () => {
		expect(parseEnhanceArgs("rewrite make it concise")).toEqual({
			kind: "rewrite",
			text: "make it concise",
		});
	});

	it("treats bare text as rewrite", () => {
		expect(parseEnhanceArgs("fix this prompt")).toEqual({
			kind: "rewrite",
			text: "fix this prompt",
		});
	});
});
