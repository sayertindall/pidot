/**
 * shell/runtime.ts
 *
 * PTY process wrapper (zigpty), screen buffer (xterm-headless), ANSI
 * render. Direct port of pi-shell-old/pty-session.ts + pty-log.ts +
 * pty-protocol.ts (this spec doesn't split those out separately — they're
 * tightly coupled to the PTY session and small enough to fold in). No
 * behavioral changes: this is the machinery the old package got right
 * (PI-DISPATCH-SPEC.md §0).
 */
import { stripVTControlCharacters } from "node:util";
import { spawn, type IPty } from "zigpty";
import type { IBufferCell, Terminal as XtermTerminal } from "@xterm/headless";
import xterm from "@xterm/headless";
import { SerializeAddon } from "@xterm/addon-serialize";

const Terminal = xterm.Terminal;

// --- pty-log.ts equivalent: raw output buffer trimming + log slicing ---

const MAX_RAW_OUTPUT_SIZE = 1024 * 1024;

function trimRawOutput(
	rawOutput: string,
	lastStreamPosition: number,
): { rawOutput: string; lastStreamPosition: number } {
	if (rawOutput.length <= MAX_RAW_OUTPUT_SIZE) {
		return { rawOutput, lastStreamPosition };
	}
	const keepSize = Math.floor(MAX_RAW_OUTPUT_SIZE / 2);
	const trimAmount = rawOutput.length - keepSize;
	return {
		rawOutput: rawOutput.substring(trimAmount),
		lastStreamPosition: Math.max(0, lastStreamPosition - trimAmount),
	};
}

export function sliceLogOutput(
	text: string,
	options: { offset?: number; limit?: number; stripAnsi?: boolean } = {},
): { slice: string; totalLines: number; totalChars: number; sliceLineCount: number } {
	let source = text;
	if (options.stripAnsi !== false && source) {
		source = stripVTControlCharacters(source);
	}
	if (!source) {
		return { slice: "", totalLines: 0, totalChars: 0, sliceLineCount: 0 };
	}

	const normalized = source.replace(/\r\n/g, "\n");
	const lines = normalized.split("\n");
	if (lines.length > 0 && lines[lines.length - 1] === "") {
		lines.pop();
	}

	const totalLines = lines.length;
	const totalChars = source.length;
	let start: number;
	if (typeof options.offset === "number" && Number.isFinite(options.offset)) {
		start = Math.max(0, Math.floor(options.offset));
	} else if (options.limit !== undefined) {
		const tailCount = Math.max(0, Math.floor(options.limit));
		start = Math.max(totalLines - tailCount, 0);
	} else {
		start = 0;
	}

	const end =
		typeof options.limit === "number" && Number.isFinite(options.limit)
			? start + Math.max(0, Math.floor(options.limit))
			: undefined;
	const selectedLines = lines.slice(start, end);
	return { slice: selectedLines.join("\n"), totalLines, totalChars, sliceLineCount: selectedLines.length };
}

// --- pty-protocol.ts equivalent: DSR (cursor position query) handling ---

const DSR_PATTERN = /\x1b\[\??6n/g;

interface DsrSplit {
	segments: Array<{ text: string; dsrAfter: boolean }>;
	hasDsr: boolean;
}

function splitAroundDsr(input: string): DsrSplit {
	const segments: Array<{ text: string; dsrAfter: boolean }> = [];
	let lastIndex = 0;
	let hasDsr = false;
	const regex = new RegExp(DSR_PATTERN.source, "g");
	let match: RegExpExecArray | null;
	while ((match = regex.exec(input)) !== null) {
		hasDsr = true;
		if (match.index > lastIndex) {
			segments.push({ text: input.slice(lastIndex, match.index), dsrAfter: true });
		} else {
			segments.push({ text: "", dsrAfter: true });
		}
		lastIndex = match.index + match[0].length;
	}
	if (lastIndex < input.length) {
		segments.push({ text: input.slice(lastIndex), dsrAfter: false });
	}
	return { segments, hasDsr };
}

function buildCursorPositionResponse(row = 1, col = 1): string {
	return `\x1b[${row};${col}R`;
}

// --- pty-session.ts equivalent: sanitize + cell-to-SGR rendering ---

const OSC_REGEX = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
const APC_REGEX = /\x1b_[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const DCS_REGEX = /\x1bP[^\x07\x1b]*(?:\x07|\x1b\\)/g;
const CSI_REGEX = /\x1b\[[0-9;?]*[A-Za-z]/g;
const ESC_SINGLE_REGEX = /\x1b[@-_]/g;
const CONTROL_REGEX = /[\x00-\x08\x0B\x0C\x0E-\x1A\x1C-\x1F\x7F]/g;

function sanitizeLine(line: string): string {
	let out = line;
	if (out.includes("")) {
		out = out.replace(OSC_REGEX, "");
		out = out.replace(APC_REGEX, "");
		out = out.replace(DCS_REGEX, "");
		out = out.replace(CSI_REGEX, (match) => (match.endsWith("m") ? match : ""));
		out = out.replace(ESC_SINGLE_REGEX, "");
	}
	if (out.includes("\t")) {
		out = out.replace(/\t/g, "   ");
	}
	if (out.includes("\r")) {
		out = out.replace(/\r/g, "");
	}
	out = out.replace(CONTROL_REGEX, "");
	return out;
}

type CellStyle = {
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	inverse: boolean;
	invisible: boolean;
	strikethrough: boolean;
	fgMode: "default" | "palette" | "rgb";
	fg: number;
	bgMode: "default" | "palette" | "rgb";
	bg: number;
};

function styleKey(style: CellStyle): string {
	return [
		style.bold ? "b" : "-",
		style.dim ? "d" : "-",
		style.italic ? "i" : "-",
		style.underline ? "u" : "-",
		style.inverse ? "v" : "-",
		style.invisible ? "x" : "-",
		style.strikethrough ? "s" : "-",
		`fg:${style.fgMode}:${style.fg}`,
		`bg:${style.bgMode}:${style.bg}`,
	].join("");
}

function rgbToSgr(isFg: boolean, hex: number): string {
	const r = (hex >> 16) & 0xff;
	const g = (hex >> 8) & 0xff;
	const b = hex & 0xff;
	return isFg ? `38;2;${r};${g};${b}` : `48;2;${r};${g};${b}`;
}

function paletteToSgr(isFg: boolean, idx: number): string {
	return isFg ? `38;5;${idx}` : `48;5;${idx}`;
}

function sgrForStyle(style: CellStyle): string {
	const parts: string[] = ["0"];
	if (style.bold) parts.push("1");
	if (style.dim) parts.push("2");
	if (style.italic) parts.push("3");
	if (style.underline) parts.push("4");
	if (style.inverse) parts.push("7");
	if (style.invisible) parts.push("8");
	if (style.strikethrough) parts.push("9");

	if (style.fgMode === "rgb") parts.push(rgbToSgr(true, style.fg));
	else if (style.fgMode === "palette") parts.push(paletteToSgr(true, style.fg));

	if (style.bgMode === "rgb") parts.push(rgbToSgr(false, style.bg));
	else if (style.bgMode === "palette") parts.push(paletteToSgr(false, style.bg));

	return `[${parts.join(";")}m`;
}

function normalizePaletteColor(
	mode: "default" | "palette" | "rgb",
	value: number,
): { mode: "default" | "palette" | "rgb"; value: number } {
	if (mode !== "palette") return { mode, value };
	if (value < 0 || value > 255) {
		return { mode: "default", value: 0 };
	}
	return { mode: "palette", value };
}

export interface PtySessionOptions {
	command: string;
	shell?: string;
	cwd?: string;
	env?: Record<string, string | undefined>;
	cols?: number;
	rows?: number;
	scrollback?: number;
	ansiReemit?: boolean;
}

export interface PtySessionEvents {
	onData?: (data: string) => void;
	onExit?: (exitCode: number, signal?: number) => void;
}

class WriteQueue {
	private queue = Promise.resolve();

	enqueue(fn: () => Promise<void> | void): void {
		this.queue = this.queue.then(() => fn()).catch((err) => {
			console.error("pi-dispatch: WriteQueue error:", err);
		});
	}

	async drain(): Promise<void> {
		await this.queue;
	}
}

export class PtyRuntime {
	private ptyProcess: IPty;
	private xterm: XtermTerminal;
	private serializer: SerializeAddon | null = null;
	private _exited = false;
	private _exitCode: number | null = null;
	private _signal: number | undefined;
	private scrollOffset = 0;
	private followBottom = true;

	private rawOutput = "";
	private lastStreamPosition = 0;

	private writeQueue = new WriteQueue();

	private dataHandler: ((data: string) => void) | undefined;
	private exitHandler: ((exitCode: number, signal?: number) => void) | undefined;
	private additionalDataListeners: Array<(data: string) => void> = [];
	private additionalExitListeners: Array<(exitCode: number, signal?: number) => void> = [];

	private trimRawOutputIfNeeded(): void {
		const trimmed = trimRawOutput(this.rawOutput, this.lastStreamPosition);
		this.rawOutput = trimmed.rawOutput;
		this.lastStreamPosition = trimmed.lastStreamPosition;
	}

	constructor(options: PtySessionOptions, events: PtySessionEvents = {}) {
		const {
			command,
			cwd = process.cwd(),
			env,
			cols = 80,
			rows = 24,
			scrollback = 5000,
			ansiReemit = true,
		} = options;

		this.dataHandler = events.onData;
		this.exitHandler = events.onExit;

		this.xterm = new Terminal({ cols, rows, scrollback, allowProposedApi: true, convertEol: true });
		if (ansiReemit) {
			this.serializer = new SerializeAddon();
			this.xterm.loadAddon(this.serializer);
		}

		const shell =
			options.shell ?? (process.platform === "win32" ? process.env.COMSPEC || "cmd.exe" : process.env.SHELL || "/bin/sh");
		const shellArgs = process.platform === "win32" ? ["/c", command] : ["-c", command];

		const mergedEnvRaw = env ? { ...process.env, ...env } : { ...process.env };
		if (!mergedEnvRaw.TERM) mergedEnvRaw.TERM = "xterm-256color";
		const mergedEnv: Record<string, string> = {};
		for (const [envKey, value] of Object.entries(mergedEnvRaw)) {
			if (value !== undefined) mergedEnv[envKey] = value;
		}

		this.ptyProcess = spawn(shell, shellArgs, { name: "xterm-256color", cols, rows, cwd, env: mergedEnv });

		this.ptyProcess.onData((data) => {
			const chunk = typeof data === "string" ? data : data.toString("utf8");
			const { segments, hasDsr } = splitAroundDsr(chunk);

			if (!hasDsr) {
				this.writeQueue.enqueue(async () => {
					this.rawOutput += chunk;
					this.trimRawOutputIfNeeded();
					await new Promise<void>((res) => {
						this.xterm.write(chunk, () => res());
					});
					this.notifyDataListeners(chunk);
				});
			} else {
				for (const segment of segments) {
					this.writeQueue.enqueue(async () => {
						if (segment.text) {
							this.rawOutput += segment.text;
							this.trimRawOutputIfNeeded();
							await new Promise<void>((res) => {
								this.xterm.write(segment.text, () => res());
							});
							this.notifyDataListeners(segment.text);
						}
						if (segment.dsrAfter) {
							const buffer = this.xterm.buffer.active;
							const response = buildCursorPositionResponse(buffer.cursorY + 1, buffer.cursorX + 1);
							this.ptyProcess.write(response);
						}
					});
				}
			}
		});

		this.ptyProcess.onExit(({ exitCode, signal }) => {
			this._exited = true;
			this._exitCode = exitCode;
			this._signal = signal;

			const exitMsg = `\n[Process exited with code ${exitCode}${signal ? ` (signal: ${signal})` : ""}]\n`;
			this.writeQueue.enqueue(async () => {
				this.rawOutput += exitMsg;
				await new Promise<void>((res) => {
					this.xterm.write(exitMsg, () => res());
				});
			});

			this.writeQueue.drain().then(() => {
				this.notifyExitListeners(exitCode, signal);
			});
		});
	}

	setEventHandlers(events: PtySessionEvents): void {
		this.dataHandler = events.onData;
		this.exitHandler = events.onExit;
	}

	addDataListener(cb: (data: string) => void): () => void {
		this.additionalDataListeners.push(cb);
		return () => {
			const idx = this.additionalDataListeners.indexOf(cb);
			if (idx >= 0) this.additionalDataListeners.splice(idx, 1);
		};
	}

	addExitListener(cb: (exitCode: number, signal?: number) => void): () => void {
		this.additionalExitListeners.push(cb);
		return () => {
			const idx = this.additionalExitListeners.indexOf(cb);
			if (idx >= 0) this.additionalExitListeners.splice(idx, 1);
		};
	}

	private notifyDataListeners(data: string): void {
		this.dataHandler?.(data);
		for (const listener of [...this.additionalDataListeners]) {
			listener(data);
		}
	}

	private notifyExitListeners(exitCode: number, signal?: number): void {
		this.exitHandler?.(exitCode, signal);
		for (const listener of [...this.additionalExitListeners]) {
			listener(exitCode, signal);
		}
	}

	get exited(): boolean {
		return this._exited;
	}
	get exitCode(): number | null {
		return this._exitCode;
	}
	get signal(): number | undefined {
		return this._signal;
	}
	get pid(): number {
		return this.ptyProcess.pid;
	}
	get cols(): number {
		return this.xterm.cols;
	}
	get rows(): number {
		return this.xterm.rows;
	}

	write(data: string): void {
		if (!this._exited) {
			this.ptyProcess.write(data);
		}
	}

	resize(cols: number, rows: number): void {
		if (cols === this.xterm.cols && rows === this.xterm.rows) return;
		if (cols < 1 || rows < 1) return;
		this.xterm.resize(cols, rows);
		if (!this._exited) {
			this.ptyProcess.resize(cols, rows);
		}
	}

	private renderLineFromCells(lineIndex: number, cols: number): string {
		const buffer = this.xterm.buffer.active;
		const line = buffer.getLine(lineIndex);

		let currentStyle: CellStyle = {
			bold: false,
			dim: false,
			italic: false,
			underline: false,
			inverse: false,
			invisible: false,
			strikethrough: false,
			fgMode: "default",
			fg: 0,
			bgMode: "default",
			bg: 0,
		};
		let currentKey = styleKey(currentStyle);
		let out = sgrForStyle(currentStyle);

		for (let x = 0; x < cols; x++) {
			const cell: IBufferCell | undefined = line?.getCell(x);
			const width = cell?.getWidth() ?? 1;
			if (width === 0) continue;

			const chars = cell?.getChars() ?? " ";
			const cellChars = chars.length === 0 ? " " : chars;

			const rawFgMode: CellStyle["fgMode"] = cell?.isFgDefault()
				? "default"
				: cell?.isFgRGB()
					? "rgb"
					: cell?.isFgPalette()
						? "palette"
						: "default";
			const rawBgMode: CellStyle["bgMode"] = cell?.isBgDefault()
				? "default"
				: cell?.isBgRGB()
					? "rgb"
					: cell?.isBgPalette()
						? "palette"
						: "default";

			const fg = normalizePaletteColor(rawFgMode, cell?.getFgColor() ?? 0);
			const bg = normalizePaletteColor(rawBgMode, cell?.getBgColor() ?? 0);

			const nextStyle: CellStyle = {
				bold: !!cell?.isBold(),
				dim: !!cell?.isDim(),
				italic: !!cell?.isItalic(),
				underline: !!cell?.isUnderline(),
				inverse: !!cell?.isInverse(),
				invisible: !!cell?.isInvisible(),
				strikethrough: !!cell?.isStrikethrough(),
				fgMode: fg.mode,
				fg: fg.value,
				bgMode: bg.mode,
				bg: bg.value,
			};
			const nextKey = styleKey(nextStyle);
			if (nextKey !== currentKey) {
				currentStyle = nextStyle;
				currentKey = nextKey;
				out += sgrForStyle(currentStyle);
			}

			out += cellChars;
		}

		return out + "[0m";
	}

	getViewportLines(options: { ansi?: boolean } = {}): string[] {
		const buffer = this.xterm.buffer.active;
		const lines: string[] = [];

		const totalLines = buffer.length;
		if (this.followBottom) {
			this.scrollOffset = 0;
		}
		const viewportStart = Math.max(0, totalLines - this.xterm.rows - this.scrollOffset);

		const useAnsi = !!options.ansi;
		if (useAnsi) {
			for (let i = 0; i < this.xterm.rows; i++) {
				const lineIndex = viewportStart + i;
				const rendered = this.renderLineFromCells(lineIndex, this.xterm.cols);

				const plain = buffer.getLine(lineIndex)?.translateToString(true) ?? "";
				const renderedPlain = rendered.replace(/\x1b\[[0-9;]*m/g, "").replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, "");
				if (plain.trim().length > 0 && renderedPlain.trim().length === 0) {
					lines.push(sanitizeLine(plain) + "[0m");
				} else {
					lines.push(rendered);
				}
			}
			return lines;
		}

		for (let i = 0; i < this.xterm.rows; i++) {
			const lineIndex = viewportStart + i;
			if (lineIndex < totalLines) {
				const line = buffer.getLine(lineIndex);
				lines.push(sanitizeLine(line?.translateToString(true) ?? ""));
			} else {
				lines.push("");
			}
		}

		return lines;
	}

	getTailLines(options: { lines: number; ansi?: boolean; maxChars?: number }): {
		lines: string[];
		totalLinesInBuffer: number;
		truncatedByChars: boolean;
	} {
		const requested = Math.max(0, Math.trunc(options.lines));
		const maxChars = options.maxChars !== undefined ? Math.max(0, Math.trunc(options.maxChars)) : undefined;

		const buffer = this.xterm.buffer.active;
		const totalLinesInBuffer = buffer.length;

		if (requested === 0) {
			return { lines: [], totalLinesInBuffer, truncatedByChars: false };
		}

		const start = Math.max(0, totalLinesInBuffer - requested);
		const out: string[] = [];
		let remainingChars = maxChars;
		let truncatedByChars = false;

		const useAnsi = options.ansi && this.serializer;
		if (useAnsi) {
			const serialized = this.serializer!.serialize();
			const serializedLines = serialized.split(/\r?\n/);
			if (serializedLines.length >= totalLinesInBuffer) {
				for (let i = start; i < totalLinesInBuffer; i++) {
					const raw = serializedLines[i] ?? "";
					const line = sanitizeLine(raw) + "[0m";
					if (remainingChars !== undefined) {
						if (remainingChars <= 0) {
							truncatedByChars = true;
							break;
						}
						remainingChars -= line.length;
					}
					out.push(line);
				}
				return { lines: out, totalLinesInBuffer, truncatedByChars };
			}
		}

		for (let i = start; i < totalLinesInBuffer; i++) {
			const lineObj = buffer.getLine(i);
			const line = sanitizeLine(lineObj?.translateToString(true) ?? "");
			if (remainingChars !== undefined) {
				if (remainingChars <= 0) {
					truncatedByChars = true;
					break;
				}
				remainingChars -= line.length;
			}
			out.push(line);
		}

		return { lines: out, totalLinesInBuffer, truncatedByChars };
	}

	getRawStream(options: { sinceLast?: boolean; stripAnsi?: boolean } = {}): string {
		let output: string;

		if (options.sinceLast) {
			output = this.rawOutput.substring(this.lastStreamPosition);
			this.lastStreamPosition = this.rawOutput.length;
		} else {
			output = this.rawOutput;
		}

		if (options.stripAnsi !== false && output) {
			output = stripVTControlCharacters(output);
		}

		return output;
	}

	getLogSlice(options: { offset?: number; limit?: number; stripAnsi?: boolean } = {}): {
		slice: string;
		totalLines: number;
		totalChars: number;
		sliceLineCount: number;
	} {
		return sliceLogOutput(this.rawOutput, options);
	}

	scrollUp(lines: number): void {
		const buffer = this.xterm.buffer.active;
		const maxScroll = Math.max(0, buffer.length - this.xterm.rows);
		this.scrollOffset = Math.min(this.scrollOffset + lines, maxScroll);
		this.followBottom = false;
	}

	scrollDown(lines: number): void {
		this.scrollOffset = Math.max(0, this.scrollOffset - lines);
		if (this.scrollOffset === 0) {
			this.followBottom = true;
		}
	}

	scrollToBottom(): void {
		this.scrollOffset = 0;
		this.followBottom = true;
	}

	isScrolledUp(): boolean {
		return this.scrollOffset > 0;
	}

	/** Process group id, when the platform exposes one — used for RunRecord.ptyPgid (§5). */
	get pgid(): number | null {
		if (process.platform === "win32") return null;
		try {
			return -this.ptyProcess.pid > 0 ? this.ptyProcess.pid : this.ptyProcess.pid;
		} catch {
			return null;
		}
	}

	kill(signal: string = "SIGTERM"): void {
		if (this._exited) return;

		const pid = this.ptyProcess.pid;

		if (process.platform !== "win32" && pid) {
			try {
				process.kill(-pid, signal as NodeJS.Signals);
				return;
			} catch {
				// Fall through to direct kill
			}
		}

		try {
			this.ptyProcess.kill(signal);
		} catch {
			// Process may already be dead
		}
	}

	dispose(): void {
		this.kill();
		try {
			this.ptyProcess.close();
		} catch {
			// Ignore close errors during teardown.
		}
		this.xterm.dispose();
	}
}
