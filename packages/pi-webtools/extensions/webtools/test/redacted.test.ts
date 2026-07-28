import { expect, test } from "vitest";
import { inspect } from "node:util";
import { Redacted } from "../redacted.ts";

test("Redacted protects accidental string, JSON, and inspect projections", () => {
	const secret = Redacted.make("api-key-123");

	expect(String(secret)).toBe("<redacted>");
	expect(JSON.stringify(secret)).toBe('"<redacted>"');
	expect(inspect(secret)).toBe("<redacted>");
	expect(Redacted.value(secret)).toBe("api-key-123");
});

test("Redacted.value rejects values not created by Redacted.make", () => {
	expect(() => Redacted.value({})).toThrow(/Redacted value was not in registry/);
});
