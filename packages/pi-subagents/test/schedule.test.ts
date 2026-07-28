import { describe, expect, it } from "vitest";
import { SubagentScheduler } from "../extensions/subagents/schedule.ts";

describe("SubagentScheduler.parseRelativeTime", () => {
	it("parses +Ns/+Nm/+Nh/+Nd into a future ISO timestamp", () => {
		const before = Date.now();
		const result = SubagentScheduler.parseRelativeTime("+10m");
		expect(result).not.toBeNull();
		const parsed = new Date(result as string).getTime();
		expect(parsed).toBeGreaterThanOrEqual(before + 10 * 60_000 - 1000);
		expect(parsed).toBeLessThanOrEqual(before + 10 * 60_000 + 5000);
	});

	it("returns null for non-relative input", () => {
		expect(SubagentScheduler.parseRelativeTime("10m")).toBeNull();
		expect(SubagentScheduler.parseRelativeTime("0 0 9 * * 1")).toBeNull();
	});
});

describe("SubagentScheduler.parseInterval", () => {
	it("parses plain Ns/Nm/Nh/Nd into milliseconds", () => {
		expect(SubagentScheduler.parseInterval("5m")).toBe(5 * 60_000);
		expect(SubagentScheduler.parseInterval("1h")).toBe(3_600_000);
		expect(SubagentScheduler.parseInterval("2d")).toBe(2 * 86_400_000);
		expect(SubagentScheduler.parseInterval("30s")).toBe(30_000);
	});

	it("returns null for a relative one-shot or cron string", () => {
		expect(SubagentScheduler.parseInterval("+5m")).toBeNull();
		expect(SubagentScheduler.parseInterval("0 0 9 * * 1")).toBeNull();
	});
});

describe("SubagentScheduler.validateCronExpression", () => {
	it("accepts a valid 6-field cron expression", () => {
		expect(SubagentScheduler.validateCronExpression("0 0 9 * * 1").valid).toBe(true);
	});

	it("rejects a 5-field (non-second-resolution) expression", () => {
		const result = SubagentScheduler.validateCronExpression("0 9 * * 1");
		expect(result.valid).toBe(false);
		expect(result.error).toMatch(/6 fields/);
	});

	it("rejects a malformed 6-field expression", () => {
		expect(SubagentScheduler.validateCronExpression("0 0 99 * * 1").valid).toBe(false);
	});
});

describe("SubagentScheduler.detectSchedule", () => {
	it("tags a relative one-shot as 'once'", () => {
		const result = SubagentScheduler.detectSchedule("+10m");
		expect(result.type).toBe("once");
	});

	it("tags a plain interval as 'interval'", () => {
		const result = SubagentScheduler.detectSchedule("5m");
		expect(result.type).toBe("interval");
		expect(result.intervalMs).toBe(5 * 60_000);
	});

	it("tags a future ISO timestamp as 'once'", () => {
		const future = new Date(Date.now() + 60_000).toISOString();
		const result = SubagentScheduler.detectSchedule(future);
		expect(result.type).toBe("once");
		expect(result.normalized).toBe(future);
	});

	it("throws for a past ISO timestamp", () => {
		const past = new Date(Date.now() - 60_000).toISOString();
		expect(() => SubagentScheduler.detectSchedule(past)).toThrow(/is in the past/);
	});

	it("tags a valid 6-field cron string as 'cron'", () => {
		const result = SubagentScheduler.detectSchedule("0 0 9 * * 1");
		expect(result.type).toBe("cron");
	});

	it("throws for input that matches none of the formats", () => {
		expect(() => SubagentScheduler.detectSchedule("not a schedule")).toThrow(/Invalid schedule/);
	});
});
