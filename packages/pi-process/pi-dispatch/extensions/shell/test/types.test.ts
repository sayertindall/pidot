import { describe, it, expect } from "vitest";
import { formatDuration, formatShortcut } from "../types";

describe("formatDuration", () => {
	it("formats seconds", () => {
		expect(formatDuration(5000)).toBe("5s");
		expect(formatDuration(0)).toBe("0s");
		expect(formatDuration(59000)).toBe("59s");
	});

	it("formats minutes", () => {
		expect(formatDuration(60000)).toBe("1m 0s");
		expect(formatDuration(90000)).toBe("1m 30s");
		expect(formatDuration(3599000)).toBe("59m 59s");
	});

	it("formats hours", () => {
		expect(formatDuration(3600000)).toBe("1h 0m");
		expect(formatDuration(3661000)).toBe("1h 1m");
	});

	it("handles sub-second values", () => {
		expect(formatDuration(999)).toBe("0s");
	});
});

describe("formatShortcut", () => {
	it("capitalizes modifier names", () => {
		expect(formatShortcut("ctrl+shift+f")).toBe("Ctrl+Shift+f");
		expect(formatShortcut("alt+o")).toBe("Alt+o");
	});
});
