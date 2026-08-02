import { describe, expect, it, vi } from "vitest";

import { Runtime } from "../runtime.js";

describe("Runtime V3 behavior", () => {
	it("passes configured model through when configured model registry match exists", async () => {
		const runtime = new Runtime();
		runtime.config.model = { provider: "openai", id: "gpt-memory" };
		const configuredModel = { provider: "openai", id: "gpt-memory" };
		const sessionModel = { provider: "openai", id: "gpt-4" };
		const registry = {
			find: vi.fn().mockImplementation((provider: string, id: string) =>
				provider === configuredModel.provider && id === configuredModel.id ? configuredModel : undefined,
			),
			getAvailable: vi.fn().mockReturnValue([configuredModel]),
		};

		const result = await runtime.resolveModel({ model: sessionModel, modelRegistry: registry, hasUI: false });

		expect(result).toEqual({ ok: true, model: configuredModel, apiKey: "", headers: undefined });
		expect(registry.find).toHaveBeenCalledWith("openai", "gpt-memory");
		expect(registry.getAvailable).toHaveBeenCalled();
	});

	it("falls back to session model when configured memory model is unavailable", async () => {
		const runtime = new Runtime();
		runtime.config.model = { provider: "openai", id: "gpt-memory" };
		const sessionModel = { provider: "openai", id: "gpt-4" };
		const notify = vi.fn();
		const result = await runtime.resolveModel({
			model: sessionModel,
			modelRegistry: { find: vi.fn(() => undefined) },
			hasUI: true,
			ui: { notify },
		});

		expect(result).toEqual({ ok: true, model: sessionModel, apiKey: "", headers: undefined });
		expect(notify).toHaveBeenCalledWith(
			"Observational memory: configured model openai/gpt-memory unavailable; using session model for memory workers",
			"warning",
		);
	});

	it("returns failure when configured model is unavailable and no session model is available", async () => {
		const runtime = new Runtime();
		runtime.config.model = { provider: "openai", id: "gpt-memory" };
		await expect(runtime.resolveModel({ model: undefined, hasUI: false })).resolves.toEqual({
			ok: false,
			reason: "configured model openai/gpt-memory unavailable",
		});
	});

	it("returns failure when no model available", async () => {
		const runtime = new Runtime();
		await expect(runtime.resolveModel({ model: undefined, hasUI: false })).resolves.toEqual({
			ok: false,
			reason: "no model available (session has no model)",
		});
	});

	it("tracks consolidation task state", async () => {
		const runtime = new Runtime();
		let release: (() => void) | undefined;
		const work = new Promise<void>((resolve) => {
			release = resolve;
		});

		const promise = runtime.launchConsolidationTask({ hasUI: false }, async () => {
			runtime.consolidationPhase = "observer";
			await work;
		});

		expect(runtime.consolidationInFlight).toBe(true);
		expect(runtime.consolidationPromise).toBe(promise);
		expect(runtime.consolidationPhase).toBe("observer");
		release?.();
		await promise;
		expect(runtime.consolidationInFlight).toBe(false);
		expect(runtime.consolidationPromise).toBeNull();
		expect(runtime.consolidationPhase).toBeUndefined();
	});

	it("records stage-specific consolidation errors", () => {
		const runtime = new Runtime();
		const notify = vi.fn();

		expect(runtime.recordConsolidationStageError({ hasUI: true, ui: { notify } }, "observer", new Error("observe failed"))).toBe(
			"observe failed",
		);
		expect(runtime.recordConsolidationStageError({ hasUI: true, ui: { notify } }, "reflector", new Error("reflect failed"))).toBe(
			"reflect failed",
		);
		expect(runtime.recordConsolidationStageError({ hasUI: true, ui: { notify } }, "dropper", "drop failed")).toBe(
			"drop failed",
		);

		expect(runtime.lastObserverError).toBe("observe failed");
		expect(runtime.lastReflectorError).toBe("reflect failed");
		expect(runtime.lastDropperError).toBe("drop failed");
		expect(notify).toHaveBeenCalledWith("Observational memory: observer failed: observe failed", "warning");
		expect(notify).toHaveBeenCalledWith("Observational memory: reflector failed: reflect failed", "warning");
		expect(notify).toHaveBeenCalledWith("Observational memory: dropper failed: drop failed", "warning");
	});

	it("keeps compaction flags independent", () => {
		const runtime = new Runtime();
		runtime.compactInFlight = true;
		runtime.compactHookInFlight = true;
		expect(runtime.consolidationInFlight).toBe(false);
		expect(runtime.consolidationPhase).toBeUndefined();
	});
});
