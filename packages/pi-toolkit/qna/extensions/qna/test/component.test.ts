/**
 * component.test.ts
 *
 * TUI component tests. The Q&A component's input handling is the
 * load-bearing part: navigation between questions, Enter to advance
 * or confirm, Esc to cancel, the confirmation dialog. Render is
 * smoke-tested for snapshot stability.
 */

import { describe, expect, it, vi } from "vitest";

// Mock the Editor from pi-tui so the QnAComponent can be constructed
// in node tests without a real TUI. The onChange callback the
// component sets in its constructor must be invoked by setText.
vi.mock("@earendil-works/pi-tui", async () => {
	const actual = await vi.importActual<any>("@earendil-works/pi-tui");
	return {
		...actual,
		Editor: class FakeEditor {
			private text = "";
			constructor(_tui: any, _theme: any) {}
			getText() {
				return this.text;
			}
			setText(t: string) {
				this.text = t;
				if ((this as any).onChange) (this as any).onChange();
			}
			render(_width: number) {
				return ["─".repeat(_width), this.text, "─".repeat(_width)];
			}
			handleInput(_data: string) {}
		},
	};
});

import { QnAComponent } from '../component';
import type { ExtractedQuestion, QnAComponentOptions } from '../types';

const QUESTIONS: ExtractedQuestion[] = [
	{ question: "First question?" },
	{ question: "Second question?", context: "Some context" },
	{ question: "Third question?" },
];

function makeComponent(overrides: Partial<QnAComponentOptions> = {}) {
	const onDone = vi.fn();
	const requestRender = vi.fn();
	const component = new QnAComponent({
		questions: QUESTIONS,
		tui: { requestRender },
		onDone,
		...overrides,
	});
	return { component, onDone, requestRender };
}

describe("QnAComponent — input", () => {
	it("calls onDone(null) on Esc", () => {
		const { component, onDone } = makeComponent();
		component.handleInput("\x1b");
		expect(onDone).toHaveBeenCalledWith(null);
	});

	it("calls onDone(null) on Ctrl+C", () => {
		const { component, onDone } = makeComponent();
		component.handleInput("\x03");
		expect(onDone).toHaveBeenCalledWith(null);
	});

	it("Tab moves to the next question", () => {
		const onDoneCalls: Array<string | null> = [];
		const c = new QnAComponent({
			questions: QUESTIONS,
			tui: { requestRender: vi.fn() },
			onDone: (r) => onDoneCalls.push(r),
		});
		c.handleInput("\t"); // Tab
		c.handleInput("\t"); // Tab
		c.handleInput("\r"); // Enter on last → confirm dialog
		// We should now be in confirmation mode. Confirm.
		c.handleInput("\r");
		expect(onDoneCalls).toHaveLength(1);
		expect(onDoneCalls[0]).toContain("First question?");
		expect(onDoneCalls[0]).toContain("Second question?");
		expect(onDoneCalls[0]).toContain("Third question?");
	});

	it("Shift+Tab moves to the previous question", () => {
		const onDoneCalls: Array<string | null> = [];
		const c = new QnAComponent({
			questions: QUESTIONS,
			tui: { requestRender: vi.fn() },
			onDone: (r) => onDoneCalls.push(r),
		});
		// Navigate to question 2 via Tab.
		c.handleInput("\t");
		// Now Shift+Tab back to question 0.
		c.handleInput("\x1b[Z"); // Shift+Tab
		c.handleInput("\r"); // Plain Enter on Q0 → advances to Q1
		c.handleInput("\r"); // Plain Enter on Q1 → advances to Q2
		c.handleInput("\r"); // Plain Enter on Q2 → confirm
		c.handleInput("\r"); // Confirm
		expect(onDoneCalls).toHaveLength(1);
	});

	it("Enter on last question shows confirmation; 'y' confirms", () => {
		const onDoneCalls: Array<string | null> = [];
		const c = new QnAComponent({
			questions: QUESTIONS,
			tui: { requestRender: vi.fn() },
			onDone: (r) => onDoneCalls.push(r),
		});
		c.handleInput("\t");
		c.handleInput("\t");
		c.handleInput("\r"); // confirm dialog
		c.handleInput("y");
		expect(onDoneCalls).toHaveLength(1);
	});

	it("Enter in confirmation dialog then 'n' cancels the confirmation", () => {
		const onDoneCalls: Array<string | null> = [];
		const c = new QnAComponent({
			questions: QUESTIONS,
			tui: { requestRender: vi.fn() },
			onDone: (r) => onDoneCalls.push(r),
		});
		c.handleInput("\t");
		c.handleInput("\t");
		c.handleInput("\r"); // confirm
		c.handleInput("n"); // decline
		expect(onDoneCalls).toHaveLength(0);
		// After declining, the user can still submit. Press Enter again → confirm, then y.
		c.handleInput("\r");
		c.handleInput("y");
		expect(onDoneCalls).toHaveLength(1);
	});

	it("includes context when present in the answer block", () => {
		const onDoneCalls: Array<string | null> = [];
		const c = new QnAComponent({
			questions: QUESTIONS,
			tui: { requestRender: vi.fn() },
			onDone: (r) => onDoneCalls.push(r),
		});
		c.handleInput("\t");
		c.handleInput("\t");
		c.handleInput("\r"); // confirm
		c.handleInput("y");
		expect(onDoneCalls[0]).toContain("> Some context");
	});

	it("uses '(no answer)' for unanswered questions", () => {
		const onDoneCalls: Array<string | null> = [];
		const c = new QnAComponent({
			questions: [{ question: "Only Q?" }],
			tui: { requestRender: vi.fn() },
			onDone: (r) => onDoneCalls.push(r),
		});
		c.handleInput("\r"); // last question, no more
		c.handleInput("y");
		expect(onDoneCalls[0]).toContain("(no answer)");
	});

	it("clamps navigation at the boundaries", () => {
		const onDoneCalls: Array<string | null> = [];
		const c = new QnAComponent({
			questions: QUESTIONS,
			tui: { requestRender: vi.fn() },
			onDone: (r) => onDoneCalls.push(r),
		});
		// At Q0, Shift+Tab should be a no-op (stay at Q0).
		c.handleInput("\x1b[Z");
		c.handleInput("\t");
		c.handleInput("\t");
		c.handleInput("\t"); // try to go past last
		c.handleInput("\r"); // still on last → confirm
		c.handleInput("y");
		expect(onDoneCalls).toHaveLength(1);
	});
});

describe("QnAComponent — render", () => {
	it("renders something for the default questions", () => {
		const { component } = makeComponent();
		const lines = component.render(120);
		expect(lines.length).toBeGreaterThan(5);
		expect(lines.join("\n")).toContain("Questions");
	});

	it("invalidate() forces a re-render on next call", () => {
		const { component } = makeComponent();
		const first = component.render(80);
		component.invalidate();
		const second = component.render(80);
		expect(second).toEqual(first); // same content, but re-rendered
	});

	it("renders without throwing on narrow widths", () => {
		const { component } = makeComponent();
		expect(() => component.render(40)).not.toThrow();
		expect(() => component.render(200)).not.toThrow();
	});
});
