/**
 * widget.test.ts
 *
 * Tests for updateWidget, formatTaskList.
 */

import { describe, expect, it, vi } from "vitest";
import { formatTaskList, updateWidget } from '../widget';

function makeCtx() {
	return {
		ui: {
			setStatus: vi.fn(),
			setWidget: vi.fn(),
		},
	} as any;
}

describe("updateWidget", () => {
	it("clears widget and status when disabled", () => {
		const ctx = makeCtx();
		updateWidget(ctx, { enabled: false, tasks: [], nextId: 1 });
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("tilldone", undefined);
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("tilldone-current", undefined);
	});

	it("shows 'none' status when enabled with no tasks", () => {
		const ctx = makeCtx();
		updateWidget(ctx, { enabled: true, tasks: [], nextId: 1 });
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("tilldone", "TASKS: none");
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("tilldone-current", undefined);
	});

	it("shows progress when tasks exist", () => {
		const ctx = makeCtx();
		updateWidget(ctx, {
			enabled: true,
			tasks: [
				{ id: 1, text: "a", status: "done" },
				{ id: 2, text: "b", status: "inprogress" },
				{ id: 3, text: "c", status: "idle" },
			],
			nextId: 4,
		});
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("tilldone", "TASKS: 1/3");
		// Widget should be set for inprogress task.
		expect(ctx.ui.setWidget).toHaveBeenCalled();
		const widgetCall = ctx.ui.setWidget.mock.calls[0];
		expect(widgetCall[0]).toBe("tilldone-current");
		expect(widgetCall[1]).toBeTypeOf("function");
		expect(widgetCall[2]).toEqual({ placement: "belowEditor" });
	});

	it("shows all-done message", () => {
		const ctx = makeCtx();
		updateWidget(ctx, {
			enabled: true,
			tasks: [
				{ id: 1, text: "a", status: "done" },
				{ id: 2, text: "b", status: "done" },
			],
			nextId: 3,
		});
		expect(ctx.ui.setStatus).toHaveBeenCalledWith("tilldone", "TASKS: 2/2 done ✓");
	});

	it("renders widget with inprogress task info", () => {
		const ctx = makeCtx();
		updateWidget(ctx, {
			enabled: true,
			tasks: [{ id: 42, text: "Write tests", status: "inprogress" }],
			nextId: 2,
		});
		const factory = ctx.ui.setWidget.mock.calls[0][1];
		const component = factory({}, {});
		const lines = component.render(80);
		expect(lines[0]).toContain("#42");
		expect(lines[0]).toContain("Write tests");
	});

	it("widget returns empty when no task is inprogress", () => {
		const ctx = makeCtx();
		updateWidget(ctx, {
			enabled: true,
			tasks: [{ id: 1, text: "a", status: "idle" }],
			nextId: 2,
		});
		expect(ctx.ui.setWidget).toHaveBeenCalledWith("tilldone-current", undefined);
	});
});

describe("formatTaskList", () => {
	it("returns placeholder when no tasks", () => {
		expect(formatTaskList({ enabled: true, tasks: [], nextId: 1 })).toBe("No tasks defined.");
	});

	it("formats tasks with status icons", () => {
		const result = formatTaskList({
			enabled: true,
			tasks: [
				{ id: 1, text: "a", status: "idle" },
				{ id: 2, text: "b", status: "inprogress" },
				{ id: 3, text: "c", status: "done" },
			],
			nextId: 4,
		});
		expect(result).toContain("( )");
		expect(result).toContain("(*)");
		expect(result).toContain("(x)");
		expect(result).toContain("#1");
		expect(result).toContain("#2");
		expect(result).toContain("#3");
		expect(result).toContain("a");
		expect(result).toContain("b");
		expect(result).toContain("c");
	});
});
