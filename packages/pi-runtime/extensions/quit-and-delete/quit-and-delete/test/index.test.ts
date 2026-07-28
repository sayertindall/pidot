import { describe, it, expect, vi, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import quitAndDeleteExtension from '../index';

function makeTempFile(): { dir: string; file: string } {
	const dir = mkdtempSync(join(tmpdir(), "pi-qad-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, "test data");
	return { dir, file };
}

describe("quitAndDeleteExtension", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("deletes the session file and exits with 0", async () => {
		const { dir, file } = makeTempFile();
		expect(existsSync(file)).toBe(true);

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		let capturedHandler: ((ctx: unknown) => Promise<void>) | undefined;
		const fakePi = {
			registerShortcut: vi.fn(
				(_shortcut: string, opts: { handler: (ctx: unknown) => Promise<void> }) => {
					capturedHandler = opts.handler;
				},
			),
		};

		quitAndDeleteExtension(fakePi as never);

		expect(fakePi.registerShortcut).toHaveBeenCalledOnce();
		expect(fakePi.registerShortcut).toHaveBeenCalledWith(
			"ctrl+shift+x",
			expect.objectContaining({ description: expect.any(String) }),
		);

		const fakeCtx = {
			sessionManager: {
				getSessionFile: () => file,
			},
		};

		await capturedHandler!(fakeCtx);

		expect(existsSync(file)).toBe(false);
		expect(exitSpy).toHaveBeenCalledWith(0);

		rmSync(dir, { recursive: true, force: true });
	});

	it("exits with 0 even when sessionFile is null (no session active)", async () => {
		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);

		let capturedHandler: ((ctx: unknown) => Promise<void>) | undefined;
		const fakePi = {
			registerShortcut: vi.fn(
				(_shortcut: string, opts: { handler: (ctx: unknown) => Promise<void> }) => {
					capturedHandler = opts.handler;
				},
			),
		};

		quitAndDeleteExtension(fakePi as never);

		const fakeCtx = {
			sessionManager: {
				getSessionFile: () => undefined,
			},
		};

		await capturedHandler!(fakeCtx);
		expect(exitSpy).toHaveBeenCalledWith(0);
	});

	it("swallows ENOENT when the file is already gone", async () => {
		const { dir, file } = makeTempFile();
		// Delete the file ourselves first
		rmSync(file);
		expect(existsSync(file)).toBe(false);

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		let capturedHandler: ((ctx: unknown) => Promise<void>) | undefined;
		const fakePi = {
			registerShortcut: vi.fn(
				(_shortcut: string, opts: { handler: (ctx: unknown) => Promise<void> }) => {
					capturedHandler = opts.handler;
				},
			),
		};

		quitAndDeleteExtension(fakePi as never);

		const fakeCtx = {
			sessionManager: {
				getSessionFile: () => file,
			},
		};

		await capturedHandler!(fakeCtx);

		expect(exitSpy).toHaveBeenCalledWith(0);
		expect(stderrSpy).not.toHaveBeenCalled();

		rmSync(dir, { recursive: true, force: true });
	});

	it("writes to stderr on non-ENOENT unlink failure but still exits", async () => {
		const { dir, file } = makeTempFile();
		expect(existsSync(file)).toBe(true);

		// Root bypasses file permissions — skip this test when uid 0.
		if (process.getuid?.() === 0) {
			rmSync(dir, { recursive: true, force: true });
			return;
		}

		// Make the directory non-writable so unlink fails with EACCES.
		const { chmodSync } = await import("node:fs");
		let restored = false;
		try {
			chmodSync(dir, 0o500); // r-x, no write
		} catch {
			rmSync(dir, { recursive: true, force: true });
			return;
		}

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
		const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);

		let capturedHandler: ((ctx: unknown) => Promise<void>) | undefined;
		const fakePi = {
			registerShortcut: vi.fn(
				(_shortcut: string, opts: { handler: (ctx: unknown) => Promise<void> }) => {
					capturedHandler = opts.handler;
				},
			),
		};

		quitAndDeleteExtension(fakePi as never);

		const fakeCtx = {
			sessionManager: {
				getSessionFile: () => file,
			},
		};

		await capturedHandler!(fakeCtx);

		expect(exitSpy).toHaveBeenCalledWith(0);
		expect(stderrSpy).toHaveBeenCalled();

		// Restore permissions so we can clean up
		if (!restored) {
			chmodSync(dir, 0o700);
			restored = true;
		}
		rmSync(dir, { recursive: true, force: true });
	});
});
