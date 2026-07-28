import { describe, expect, it } from "vitest";
import { safeExec, SafeExecError } from "./safe-exec";

describe("safeExec", () => {
	it("returns stdout and exitCode 0 on success", () => {
		const result = safeExec("echo", ["hello"], { timeoutMs: 5000, maxBuffer: 1024 });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.trim()).toBe("hello");
		expect(result.stderr).toBe("");
		expect(result.signal).toBeNull();
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
	});

	it("captures stdout faithfully", () => {
		const result = safeExec("node", ["-e", "process.stdout.write('line1\\nline2')"], {
			timeoutMs: 5000,
			maxBuffer: 1024,
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("line1\nline2");
	});

	it("captures stderr on non-zero exit", () => {
		try {
			safeExec("node", ["-e", "process.stderr.write('bad error');process.exit(1)"], {
				timeoutMs: 5000,
				maxBuffer: 1024,
			});
			expect.unreachable("expected safeExec to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SafeExecError);
			const e = error as SafeExecError;
			expect(e.cause).toBe("nonzero_exit");
			expect(e.result.stderr).toBe("bad error");
			expect(e.result.exitCode).toBe(1);
		}
	});

	it("handles commands with empty output", () => {
		const result = safeExec("node", ["-e", ""], { timeoutMs: 5000, maxBuffer: 1024 });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("");
	});

	it("handles special characters in output", () => {
		const result = safeExec("node", [
			"-e",
			"process.stdout.write('\\x00\\t\\n\\\\n☃')",
		], { timeoutMs: 5000, maxBuffer: 1024 });
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toContain("☃");
	});

	it("handles large output within maxBuffer", () => {
		const result = safeExec("node", [
			"-e",
			"process.stdout.write('x'.repeat(10000))",
		], { timeoutMs: 5000, maxBuffer: 20 * 1024 });
		expect(result.exitCode).toBe(0);
		expect(result.stdout.length).toBe(10000);
	});

	it("throws SafeExecError with cause nonzero_exit on a failing command", () => {
		try {
			safeExec("node", ["-e", "process.exit(3)"], { timeoutMs: 5000, maxBuffer: 1024 });
			expect.unreachable("expected safeExec to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SafeExecError);
			const safeError = error as SafeExecError;
			expect(safeError.cause).toBe("nonzero_exit");
			expect(safeError.result.exitCode).toBe(3);
			expect(safeError.command).toBe("node");
			expect(safeError.args).toEqual(["-e", "process.exit(3)"]);
		}
	});

	it("throws SafeExecError with cause spawn for a missing binary", () => {
		try {
			safeExec("pi-dispatch-definitely-not-a-real-binary", [], { timeoutMs: 5000, maxBuffer: 1024 });
			expect.unreachable("expected safeExec to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SafeExecError);
			const e = error as SafeExecError;
			expect(e.cause).toBe("spawn");
			expect(e.result.exitCode).toBe(-1);
		}
	});

	it("throws SafeExecError with cause timeout when the command runs too long", () => {
		try {
			safeExec("node", ["-e", "setTimeout(() => {}, 5000)"], { timeoutMs: 100, maxBuffer: 1024 });
			expect.unreachable("expected safeExec to throw");
		} catch (error) {
			expect(error).toBeInstanceOf(SafeExecError);
			const e = error as SafeExecError;
			expect(e.cause).toBe("timeout");
		}
	});

	it("SafeExecError exposes command and args", () => {
		try {
			safeExec("node", ["-e", "process.exit(99)"], { timeoutMs: 5000, maxBuffer: 1024 });
			expect.unreachable("expected throw");
		} catch (error) {
			const e = error as SafeExecError;
			expect(e.command).toBe("node");
			expect(e.args).toEqual(["-e", "process.exit(99)"]);
			expect(e.name).toBe("SafeExecError");
		}
	});
		const result = safeExec("node", ["-e", "process.stdout.write(process.cwd())"], {
			timeoutMs: 5000,
			maxBuffer: 1024,
			cwd: "/tmp",
		});
		expect(result.exitCode).toBe(0);
		// macOS resolves /tmp to /private/tmp; both are valid
		expect(result.stdout).toMatch(/\/tmp$/);
	});

	it("passes env to the child process", () => {
		const result = safeExec("node", [
			"-e",
			"process.stdout.write(process.env.TEST_VAR || '')",
		], {
			timeoutMs: 5000,
			maxBuffer: 1024,
			env: { TEST_VAR: "hello-env" },
		});
		expect(result.exitCode).toBe(0);
		expect(result.stdout).toBe("hello-env");
	});

	it("tracks duration in the result", () => {
		const result = safeExec("echo", ["test"], { timeoutMs: 5000, maxBuffer: 1024 });
		expect(result.durationMs).toBeGreaterThanOrEqual(0);
		expect(result.durationMs).toBeLessThan(1000); // should be fast
	});

	it("SafeExecError exposes command and args", () => {
		try {
			safeExec("node", ["-e", "process.exit(99)"], { timeoutMs: 5000, maxBuffer: 1024 });
			expect.unreachable("expected throw");
		} catch (error) {
			const e = error as SafeExecError;
			expect(e.command).toBe("node");
			expect(e.args).toEqual(["-e", "process.exit(99)"]);
			expect(e.name).toBe("SafeExecError");
		}
	});
