/**
 * pi-toolkit-qna — types
 *
 * Pure type definitions. No runtime, no side effects.
 */

/** A single question extracted from an assistant message. */
export interface ExtractedQuestion {
	question: string;
	context?: string;
}

/** Result of extraction (local or LLM). */
export interface ExtractionResult {
	questions: ExtractedQuestion[];
}

/** A model + auth + headers, ready to call `complete()`. */
export interface ModelWithAuth {
	model: import("@earendil-works/pi-ai").Model<import("@earendil-works/pi-ai").Api>;
	apiKey: string;
	headers?: Record<string, string>;
}

/** Minimal model registry surface used by the extraction layer. */
export interface ModelRegistryLike {
	find: (provider: string, modelId: string) => import("@earendil-works/pi-ai").Model<import("@earendil-works/pi-ai").Api> | undefined;
	getApiKeyAndHeaders: (model: import("@earendil-works/pi-ai").Model<import("@earendil-works/pi-ai").Api>) => Promise<{
		ok: boolean;
		apiKey?: string;
		headers?: Record<string, string>;
		error?: string;
	}>;
}

/** Options for the answer-input TUI component. */
export interface QnAComponentOptions {
	questions: ExtractedQuestion[];
	tui: { requestRender(): void };
	onDone: (result: string | null) => void;
}
