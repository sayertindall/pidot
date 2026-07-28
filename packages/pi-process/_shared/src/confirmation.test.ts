import { describe, expect, it, vi } from "vitest";
import { confirmOrThrow, ConfirmationDeclinedError } from "./confirmation";

describe("confirmOrThrow", () => {
	it("resolves when confirm returns true", async () => {
		await expect(
			confirmOrThrow("test", "Continue?", async () => true),
		).resolves.toBeUndefined();
	});

	it("throws ConfirmationDeclinedError when confirm returns false", async () => {
		await expect(
			confirmOrThrow("test", "Continue?", async () => false),
		).rejects.toBeInstanceOf(ConfirmationDeclinedError);
	});

	it("passes the prompt string to the confirm function", async () => {
		const confirm = vi.fn(async () => true);
		await confirmOrThrow("reason", "Are you sure?", confirm);
		expect(confirm).toHaveBeenCalledWith("Are you sure?");
	});

	it("ConfirmationDeclinedError includes reason and prompt", async () => {
		try {
			await confirmOrThrow("delete-files", "Delete all files?", async () => false);
			expect.unreachable("expected throw");
		} catch (error) {
			expect(error).toBeInstanceOf(ConfirmationDeclinedError);
			const e = error as ConfirmationDeclinedError;
			expect(e.reason).toBe("delete-files");
			expect(e.prompt).toBe("Delete all files?");
			expect(e.message).toContain("delete-files");
		}
	});

	it("does not throw when confirm returns true after initial rejection (retry scenario)", async () => {
		let calls = 0;
		const confirm = vi.fn(async () => {
			calls++;
			return calls > 1; // reject first, accept second
		});
		// First call — should reject
		await expect(confirmOrThrow("retry", "Try again?", confirm)).rejects.toBeInstanceOf(
			ConfirmationDeclinedError,
		);
		// Second call — should pass
		await expect(confirmOrThrow("retry", "Try again?", confirm)).resolves.toBeUndefined();
	});

	it("handles empty reason and prompt", async () => {
		const confirm = vi.fn(async () => false);
		await expect(confirmOrThrow("", "", confirm)).rejects.toBeInstanceOf(
			ConfirmationDeclinedError,
		);
		try {
			await confirmOrThrow("", "", async () => false);
		} catch (error) {
			const e = error as ConfirmationDeclinedError;
			expect(e.reason).toBe("");
			expect(e.prompt).toBe("");
		}
	});
});
