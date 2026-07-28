/**
 * status/test/commands.test.ts
 *
 * Pure parser tests for the /status subcommand shape.
 */
import { describe, expect, it } from "vitest";
import { parseStatusArgs } from "../commands";

describe("parseStatusArgs", () => {
	it("returns toggle on empty input", () => {
		expect(parseStatusArgs("")).toEqual({ kind: "toggle" });
		expect(parseStatusArgs(undefined)).toEqual({ kind: "toggle" });
		expect(parseStatusArgs("   ")).toEqual({ kind: "toggle" });
	});

	it("parses on / show", () => {
		expect(parseStatusArgs("on")).toEqual({ kind: "set", hidden: false });
		expect(parseStatusArgs("show")).toEqual({ kind: "set", hidden: false });
	});

	it("parses off / hide", () => {
		expect(parseStatusArgs("off")).toEqual({ kind: "set", hidden: true });
		expect(parseStatusArgs("hide")).toEqual({ kind: "set", hidden: true });
	});

	it("parses refresh", () => {
		expect(parseStatusArgs("refresh")).toEqual({ kind: "refresh" });
	});

	it("returns help for unknown subcommands", () => {
		expect(parseStatusArgs("nope")).toEqual({ kind: "help" });
	});

	it("is case-insensitive", () => {
		expect(parseStatusArgs("OFF")).toEqual({ kind: "set", hidden: true });
	});
});
