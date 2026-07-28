export type LoopMode = "tests" | "custom" | "self";

export interface LoopStateData {
	active: boolean;
	mode?: LoopMode;
	condition?: string;
	prompt?: string;
	summary?: string;
	loopCount?: number;
}

export interface LoopPreset {
	value: LoopMode;
	label: string;
	description: string;
}
