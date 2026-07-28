import { describe, expect, it } from "vitest";
import { readRunRecord, runRecordPath } from "./run-record";

describe("runRecord (stub)", () => {
	it("runRecordPath returns a path", () => {
		expect(runRecordPath("rec-1", "tok-1")).toContain("rec-1");
	});

	it("readRunRecord returns null for the stub", () => {
		expect(readRunRecord("rec-1", "tok-1")).toBeNull();
	});
});
