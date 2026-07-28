/**
 * review/test/state.test.ts
 *
 * Real-fs tests for the review state module: session-scoped subdir
 * layout, base64url(sessionId) encoding, atomic writes, corruption-move,
 * and the eager-vs-debounced persistence split.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as state from "../state";

let tmp: string;
let originalAgentDir: string | undefined;

beforeEach(() => {
	tmp = mkdtempSync(join(tmpdir(), "pi-config-review-test-"));
	originalAgentDir = process.env.PI_CODING_AGENT_DIR;
	// getAgentDir() reads PI_CODING_AGENT_DIR first, then falls back to
	// homedir() + "/.pi/agent". We use the env var because vitest workers
	// don't reflect HOME changes in os.homedir().
	process.env.PI_CODING_AGENT_DIR = tmp;
});

afterEach(async () => {
	if (originalAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = originalAgentDir;
	// Small async gap to let any pending debounce timers settle.
	await new Promise((r) => setTimeout(r, 1100));
	rmSync(tmp, { recursive: true, force: true });
});

function base64url(s: string): string {
	return Buffer.from(s, "utf8").toString("base64url");
}

function sessionStateDir(sessionId: string): string {
	return join(tmp, "pi-config", "review", base64url(sessionId));
}

describe("review state — session-scoped base64url subdir", () => {
	it("writes state under PI_CODING_AGENT_DIR/pi-config/review/<base64url(sessionId)>/state.json", async () => {
		const sessionId = "019f9f22-7ce3-7b2e-b6cf-b9d17abb133f";
		await state.mutateState(sessionId, (current) => ({
			...current,
			current: {
				target: { type: "uncommitted" },
				status: "running",
				startedAt: 1000,
				updatedAt: 1000,
				toolCount: 0,
			},
		}));
		const expectedDir = sessionStateDir(sessionId);
		expect(existsSync(expectedDir)).toBe(true);
		const file = join(expectedDir, "state.json");
		expect(existsSync(file)).toBe(true);
		const json = JSON.parse(readFileSync(file, "utf8"));
		expect(json.current.status).toBe("running");
	});

	it("isolates different sessions into separate subdirs", async () => {
		const a = "session-a";
		const b = "session-b";
		await state.mutateState(a, () => ({
			current: {
				target: { type: "uncommitted" },
				status: "running",
				startedAt: 1,
				updatedAt: 1,
				toolCount: 0,
			},
		}));
		await state.mutateState(b, () => ({
			current: {
				target: { type: "baseBranch", branch: "main" },
				status: "done",
				startedAt: 2,
				updatedAt: 2,
				toolCount: 1,
			},
		}));
		expect(state.readState(a).current?.status).toBe("running");
		expect(state.readState(b).current?.status).toBe("done");
	});

	it("returns empty state when no file exists", () => {
		expect(state.readState("unknown-session")).toEqual({ current: null });
	});
});

describe("review state — corruption-move", () => {
	it("moves a corrupt state.json to .corrupt-<timestamp> and returns empty", () => {
		const sessionId = "session-with-bad-file";
		const expectedDir = sessionStateDir(sessionId);
		mkdirSync(expectedDir, { recursive: true });
		const file = join(expectedDir, "state.json");
		writeFileSync(file, "not json");
		expect(state.readState(sessionId)).toEqual({ current: null });
		expect(existsSync(file)).toBe(false);
		const siblings = readdirSync(expectedDir);
		expect(siblings.some((f) => f.startsWith("state.json.corrupt-"))).toBe(true);
	});

	it("rejects a state.json whose shape doesn't match the schema", () => {
		const sessionId = "session-bad-shape";
		const expectedDir = sessionStateDir(sessionId);
		mkdirSync(expectedDir, { recursive: true });
		const file = join(expectedDir, "state.json");
		writeFileSync(
			file,
			JSON.stringify({
				current: { target: { type: "bogus" }, status: "running", startedAt: 1, updatedAt: 1, toolCount: 0 },
			}),
		);
		expect(state.readState(sessionId)).toEqual({ current: null });
	});
});
