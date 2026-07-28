import { describe, it, expect } from "vitest";
import { Type } from "typebox";
import { validateConfigOrThrow, validateConfigWithDiagnostics, validateRecordEntries } from "../validate";

const Person = Type.Object({
	name: Type.String({ minLength: 1 }),
	age: Type.Optional(Type.Integer({ minimum: 0 })),
});

describe("validate", () => {
	describe("validateConfigOrThrow", () => {
		it("returns the value when valid", () => {
			const result = validateConfigOrThrow<{ name: string }>({ name: "Ada" }, Person, "person");
			expect(result).toEqual({ name: "Ada" });
		});

		it("throws with source-prefixed message when invalid", () => {
			expect(() => validateConfigOrThrow({}, Person, "person-file")).toThrow(/Invalid person-file/);
		});
	});

	describe("validateConfigWithDiagnostics", () => {
		it("returns value+empty diagnostics on success", () => {
			const result = validateConfigWithDiagnostics<{ name: string }>({ name: "x" }, Person, "p");
			expect(result.value).toEqual({ name: "x" });
			expect(result.diagnostics).toEqual([]);
		});

		it("returns undefined + a single warning on failure", () => {
			const result = validateConfigWithDiagnostics({}, Person, "p");
			expect(result.value).toBeUndefined();
			expect(result.diagnostics).toHaveLength(1);
			expect(result.diagnostics[0]?.level).toBe("warning");
			expect(result.diagnostics[0]?.source).toBe("p");
		});
	});

	describe("validateRecordEntries", () => {
		it("returns only valid entries and per-key warnings", () => {
			const { entries, diagnostics } = validateRecordEntries<{ name: string }>(
				{
					good: { name: "Ada" },
					bad: { name: "" }, // minLength: 1 violated
					alsoGood: { name: "Bob" },
				},
				Person,
				(key) => `people#${key}`,
			);
			expect(Object.keys(entries).sort()).toEqual(["alsoGood", "good"]);
			expect(diagnostics).toHaveLength(1);
			expect(diagnostics[0]?.source).toBe("people#bad");
		});

		it("returns a root warning for non-object input", () => {
			const { entries, diagnostics } = validateRecordEntries("not an object", Person, (key) => `x#${key}`);
			expect(entries).toEqual({});
			expect(diagnostics[0]?.source).toBe("x#<root>");
		});
	});
});
