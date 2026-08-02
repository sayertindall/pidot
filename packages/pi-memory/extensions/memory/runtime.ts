import type { Model } from "@earendil-works/pi-ai";
import { type Config, DEFAULTS, loadConfig } from "./config.js";

export type ResolveResult =
	| { ok: true; model: unknown; apiKey: string; headers?: Record<string, string> }
	| { ok: false; reason: string };

type NotifyLevel = "warning" | "info" | "error";
type Notify = (message: string, type?: NotifyLevel) => void;
export type ConsolidationPhase = "observer" | "reflector" | "dropper";

function isModelAvailableById(
	registry: ModelRegistryLike | undefined,
	provider: string,
	modelId: string,
): boolean {
	const getAvailable = registry?.getAvailable;
	if (typeof getAvailable !== "function") return true;
	return getAvailable().some((entry) => entry.provider === provider && entry.id === modelId);
}

function resolveConfiguredModel(
	provider: string,
	modelId: string,
	modelRegistry: ModelRegistryLike | undefined,
): Model<any> | undefined {
	if (!modelRegistry?.find) return undefined;
	if (!isModelAvailableById(modelRegistry, provider, modelId)) return undefined;
	return modelRegistry.find(provider, modelId);
}

type ModelRegistryLike = {
	find: (provider: string, modelId: string) => Model<any> | undefined;
	getAvailable?: () => { provider: string; id: string }[];
};

export interface ResolveCtx {
	model: unknown;
	modelRegistry?: ModelRegistryLike;
	hasUI: boolean;
	ui?: { notify: Notify };
}

export interface LaunchCtx {
	hasUI: boolean;
	ui?: { notify: Notify };
}

export class Runtime {
	config: Config = { ...DEFAULTS };
	configLoaded = false;
	consolidationInFlight = false;
	consolidationPromise: Promise<void> | null = null;
	consolidationPhase: ConsolidationPhase | undefined;
	compactInFlight = false;
	compactHookInFlight = false;
	compactLastAttemptAt = 0;
	resolveFailureNotified = false;
	private _memoryModelWarningNotified = false;
	lastObserverError: string | undefined;
	lastReflectorError: string | undefined;
	lastDropperError: string | undefined;

	ensureConfig(cwd: string): void {
		if (this.configLoaded) return;
		this.config = loadConfig(cwd);
		this.configLoaded = true;
	}

	async resolveModel(ctx: ResolveCtx): Promise<ResolveResult> {
		if (this.config.model) {
			const configured = this.config.model;
			const availableModel = resolveConfiguredModel(configured.provider, configured.id, ctx.modelRegistry);
			if (availableModel) return { ok: true, model: availableModel, apiKey: "", headers: undefined };

			if (ctx.model) {
				if (!this._memoryModelWarningNotified && ctx.hasUI && ctx.ui) {
					ctx.ui.notify(
						`Observational memory: configured model ${configured.provider}/${configured.id} unavailable; using session model for memory workers`,
						"warning",
				);
					this._memoryModelWarningNotified = true;
				}
				return { ok: true, model: ctx.model, apiKey: "", headers: undefined };
			}

			return { ok: false, reason: `configured model ${configured.provider}/${configured.id} unavailable` };
		}

		const model = ctx.model;
		if (!model) return { ok: false, reason: "no model available (session has no model)" };
		// Auth handled internally by createAgentSession via auto-discovered ModelRuntime
		return { ok: true, model, apiKey: "", headers: undefined };
	}

	launchConsolidationTask(ctx: LaunchCtx, work: () => Promise<void>): Promise<void> {
		this.consolidationInFlight = true;
		this.consolidationPhase = undefined;
		this.lastObserverError = undefined;
		this.lastReflectorError = undefined;
		this.lastDropperError = undefined;
		const promise = this.launchTrackedTask(ctx, "consolidation", work, () => {
			this.consolidationInFlight = false;
			this.consolidationPhase = undefined;
			if (this.consolidationPromise === promise) this.consolidationPromise = null;
		});
		this.consolidationPromise = promise;
		return promise;
	}

	recordConsolidationStageError(ctx: LaunchCtx, phase: ConsolidationPhase, error: unknown): string {
		const message = error instanceof Error ? error.message : String(error);
		if (phase === "observer") this.lastObserverError = message;
		if (phase === "reflector") this.lastReflectorError = message;
		if (phase === "dropper") this.lastDropperError = message;
		if (ctx.hasUI && ctx.ui) ctx.ui.notify(`Observational memory: ${phase} failed: ${message}`, "warning");
		return message;
	}

	private launchTrackedTask(
		ctx: LaunchCtx,
		label: string,
		work: () => Promise<void>,
		onFinally: (error: string | undefined) => void,
	): Promise<void> {
		const hasUI = ctx.hasUI;
		const ui = ctx.ui;
		return (async () => {
			let errorMessage: string | undefined;
			try {
				await work();
			} catch (error) {
				errorMessage = error instanceof Error ? error.message : String(error);
				if (hasUI && ui) ui.notify(`Observational memory: ${label} failed: ${errorMessage}`, "warning");
			} finally {
				onFinally(errorMessage);
			}
		})();
	}
}
