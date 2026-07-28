/**
 * pi-toolkit-qna — component
 *
 * Interactive TUI for answering extracted questions. One editor per
 * question; Tab/Shift+Tab to navigate, Enter to move to next (or
 * confirm on the last), Esc to cancel, Shift+Enter for newlines.
 *
 * Implements Component so it can be hosted in a `ctx.ui.custom`
 * overlay. Self-contained — handles its own rendering, input, and
 * state. On submit, builds a markdown-formatted answer block and
 * passes it to `onDone`.
 */

import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	truncateToWidth,
	type TUI,
	visibleWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import type { QnAComponentOptions } from "./types";

interface Component {
	render(width: number): string[];
	invalidate(): void;
	handleInput(data: string): void;
}

// ANSI helpers — keep them local so the component has no theme dependency.
const RESET = "\x1b[0m";
const DIM = (s: string) => `\x1b[2m${s}${RESET}`;
const BOLD = (s: string) => `\x1b[1m${s}${RESET}`;
const CYAN = (s: string) => `\x1b[36m${s}${RESET}`;
const GREEN = (s: string) => `\x1b[32m${s}${RESET}`;
const GRAY = (s: string) => `\x1b[90m${s}${RESET}`;

export class QnAComponent implements Component {
	private currentIndex = 0;
	private answers: string[];
	private editor: Editor;
	private showingConfirmation = false;
	private cachedWidth: number | null = null;
	private cachedLines: string[] | null = null;

	constructor(private readonly options: QnAComponentOptions) {
		this.answers = options.questions.map(() => "");

		const editorTheme: EditorTheme = {
			borderColor: DIM,
			selectList: {
				selectedPrefix: CYAN,
				selectedText: (s: string) => `\x1b[44m${s}${RESET}`,
				description: GRAY,
				scrollInfo: DIM,
				noMatch: DIM,
			},
		};

		this.editor = new Editor(options.tui as unknown as TUI, editorTheme);
		// Disable the editor's built-in submit so we can intercept Enter
		// and preserve the text across navigation.
		(this.editor as any).disableSubmit = true;
		(this.editor as any).onChange = () => {
			this.invalidate();
			options.tui.requestRender();
		};
	}

	private saveCurrentAnswer(): void {
		this.answers[this.currentIndex] = this.editor.getText();
	}

	private navigateTo(index: number): void {
		if (index < 0 || index >= this.options.questions.length) return;
		this.saveCurrentAnswer();
		this.currentIndex = index;
		this.editor.setText(this.answers[index] ?? "");
		this.invalidate();
	}

	private submit(): void {
		this.saveCurrentAnswer();
		const parts: string[] = [];
		for (let i = 0; i < this.options.questions.length; i++) {
			const q = this.options.questions[i];
			if (!q) continue;
			const a = this.answers[i]?.trim() || "(no answer)";
			parts.push(`Q: ${q.question}`);
			if (q.context) parts.push(`> ${q.context}`);
			parts.push(`A: ${a}`);
			parts.push("");
		}
		this.options.onDone(parts.join("\n").trim());
	}

	private cancel(): void {
		this.options.onDone(null);
	}

	invalidate(): void {
		this.cachedWidth = null;
		this.cachedLines = null;
	}

	handleInput(data: string): void {
		// Confirmation dialog intercepts Enter/y and Esc/n.
		if (this.showingConfirmation) {
			if (matchesKey(data, Key.enter) || data.toLowerCase() === "y") {
				this.submit();
				return;
			}
			if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c")) || data.toLowerCase() === "n") {
				this.showingConfirmation = false;
				this.invalidate();
				this.options.tui.requestRender();
				return;
			}
			return;
		}

		// Global cancel.
		if (matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
			this.cancel();
			return;
		}

		// Tab / Shift+Tab navigation.
		if (matchesKey(data, Key.tab)) {
			if (this.currentIndex < this.options.questions.length - 1) {
				this.navigateTo(this.currentIndex + 1);
				this.options.tui.requestRender();
			}
			return;
		}
		if (matchesKey(data, Key.shift("tab"))) {
			if (this.currentIndex > 0) {
				this.navigateTo(this.currentIndex - 1);
				this.options.tui.requestRender();
			}
			return;
		}

		// Up/Down when editor is empty = navigate. Otherwise let the editor handle it.
		if (matchesKey(data, Key.up) && this.editor.getText() === "") {
			if (this.currentIndex > 0) {
				this.navigateTo(this.currentIndex - 1);
				this.options.tui.requestRender();
				return;
			}
		}
		if (matchesKey(data, Key.down) && this.editor.getText() === "") {
			if (this.currentIndex < this.options.questions.length - 1) {
				this.navigateTo(this.currentIndex + 1);
				this.options.tui.requestRender();
				return;
			}
		}

		// Plain Enter moves to next or shows confirmation; Shift+Enter is a newline.
		if (matchesKey(data, Key.enter) && !matchesKey(data, Key.shift("enter"))) {
			this.saveCurrentAnswer();
			if (this.currentIndex < this.options.questions.length - 1) {
				this.navigateTo(this.currentIndex + 1);
			} else {
				this.showingConfirmation = true;
			}
			this.invalidate();
			this.options.tui.requestRender();
			return;
		}

		// Otherwise, pass through to the editor.
		this.editor.handleInput(data);
		this.invalidate();
		this.options.tui.requestRender();
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}
		const lines = this.renderFresh(width);
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	private renderFresh(width: number): string[] {
		const lines: string[] = [];
		const boxWidth = Math.min(width - 4, 120);
		const contentWidth = boxWidth - 4;

		const horizontalLine = (count: number) => "─".repeat(count);
		const boxLine = (content: string, leftPad: number = 2): string => {
			const paddedContent = " ".repeat(leftPad) + content;
			const contentLen = visibleWidth(paddedContent);
			const rightPad = Math.max(0, boxWidth - contentLen - 2);
			return DIM("│") + paddedContent + " ".repeat(rightPad) + DIM("│");
		};
		const emptyBoxLine = (): string => DIM("│") + " ".repeat(boxWidth - 2) + DIM("│");
		const padToWidth = (line: string): string => {
			const len = visibleWidth(line);
			return line + " ".repeat(Math.max(0, width - len));
		};

		// Title.
		lines.push(padToWidth(DIM("╭" + horizontalLine(boxWidth - 2) + "╮")));
		const title = `${BOLD(CYAN("Questions"))} ${DIM(`(${this.currentIndex + 1}/${this.options.questions.length})`)}`;
		lines.push(padToWidth(boxLine(title)));
		lines.push(padToWidth(DIM("├" + horizontalLine(boxWidth - 2) + "┤")));

		// Progress dots.
		const progress: string[] = [];
		for (let i = 0; i < this.options.questions.length; i++) {
			const answered = (this.answers[i]?.trim() || "").length > 0;
			const current = i === this.currentIndex;
			if (current) progress.push(CYAN("●"));
			else if (answered) progress.push(GREEN("●"));
			else progress.push(DIM("○"));
		}
		lines.push(padToWidth(boxLine(progress.join(" "))));
		lines.push(padToWidth(emptyBoxLine()));

		// Current question.
		const q = this.options.questions[this.currentIndex];
		if (q) {
			const questionText = `${BOLD("Q:")} ${q.question}`;
			const wrappedQuestion = wrapTextWithAnsi(questionText, contentWidth);
			for (const line of wrappedQuestion) {
				lines.push(padToWidth(boxLine(line)));
			}
			if (q.context) {
				lines.push(padToWidth(emptyBoxLine()));
				const contextText = GRAY(`> ${q.context}`);
				const wrappedContext = wrapTextWithAnsi(contextText, contentWidth - 2);
				for (const line of wrappedContext) {
					lines.push(padToWidth(boxLine(line)));
				}
			}
		}
		lines.push(padToWidth(emptyBoxLine()));

		// Editor (skip first and last lines — the editor's own borders).
		const answerPrefix = BOLD("A: ");
		const editorWidth = contentWidth - 4 - 3;
		const editorLines = this.editor.render(editorWidth);
		for (let i = 1; i < editorLines.length - 1; i++) {
			if (i === 1) {
				lines.push(padToWidth(boxLine(answerPrefix + editorLines[i])));
			} else {
				lines.push(padToWidth(boxLine("   " + editorLines[i])));
			}
		}
		lines.push(padToWidth(emptyBoxLine()));

		// Confirmation or controls footer.
		lines.push(padToWidth(DIM("├" + horizontalLine(boxWidth - 2) + "┤")));
		if (this.showingConfirmation) {
			const confirmMsg = `${CYAN("Submit all answers?")} ${DIM("(Enter/y to confirm, Esc/n to cancel)")}`;
			lines.push(padToWidth(boxLine(truncateToWidth(confirmMsg, contentWidth))));
		} else {
			const controls = `${DIM("Tab/Enter")} next · ${DIM("Shift+Tab")} prev · ${DIM("Shift+Enter")} newline · ${DIM("Esc")} cancel`;
			lines.push(padToWidth(boxLine(truncateToWidth(controls, contentWidth))));
		}
		lines.push(padToWidth(DIM("╰" + horizontalLine(boxWidth - 2) + "╯")));

		return lines;
	}
}
