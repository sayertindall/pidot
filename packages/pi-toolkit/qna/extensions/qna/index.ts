/**
 * pi-toolkit-qna — index
 *
 * Extension factory. Wiring only. The actual work happens in:
 *   - extraction.ts:   local + LLM question extraction
 *   - last-message.ts: pull text of last assistant message
 *   - component.ts:    interactive answer TUI
 *
 * Flow:
 *   /qna
 *     → get last assistant text
 *     → try local extraction first; fall back to LLM
 *     → mount QnAComponent with the extracted questions
 *     → on submit, send the answers as a user message
 */

import { BorderedLoader, type ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { QnAComponent } from "./component";
import { extractQuestionsLocally, extractQuestionsWithLLM, selectExtractionModel } from "./extraction";
import { getLastAssistantText } from "./last-message";

export default function qnaExtension(pi: ExtensionAPI): void {
	pi.registerCommand("qna", {
		description: "Extract questions from last assistant message into interactive Q&A",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("answer requires interactive mode", "error");
				return;
			}
			if (!ctx.model) {
				ctx.ui.notify("No model selected", "error");
				return;
			}

			const last = getLastAssistantText(ctx);
			if (!last) {
				ctx.ui.notify("No assistant messages found", "error");
				return;
			}
			if (last.stopReason !== "stop" && last.stopReason !== undefined) {
				ctx.ui.notify(`Last assistant message incomplete (${last.stopReason})`, "error");
				return;
			}

			// 1. Try local extraction first (cheap, no LLM).
			const local = extractQuestionsLocally(last.text);
			let extraction = local.questions.length > 0 ? local : null;

			// 2. If local found nothing, fall back to LLM extraction.
			if (!extraction) {
				const selection = await selectExtractionModel(ctx.model, ctx.modelRegistry);
				if (selection) {
					extraction = await ctx.ui.custom((tui, theme, _kb, done) => {
						const loader = new BorderedLoader(tui, theme, `Extracting questions using ${selection.model.id}...`);
						loader.onAbort = () => done(null);
						const text = last.text;
						extractQuestionsWithLLM(text, selection, loader.signal)
							.then(done)
							.catch(() => done(null));
						return loader;
					});
				}
			}

			if (extraction === null || extraction === undefined) {
				ctx.ui.notify("Could not extract questions from the last message", "error");
				return;
			}
			if (extraction.questions.length === 0) {
				ctx.ui.notify("No questions found in the last message", "info");
				return;
			}

			// 3. Show the answer TUI.
			const answersResult = await ctx.ui.custom<string | null>((tui, _theme, _kb, done) => {
				return new QnAComponent({
					questions: extraction.questions,
					tui: { requestRender: () => tui.requestRender() },
					onDone: done,
				});
			});

			if (answersResult === null) {
				ctx.ui.notify("Cancelled", "info");
				return;
			}

			// 4. Send the answers back as a user message.
			pi.sendMessage(
				{
					customType: "answers",
					content: "I answered your questions in the following way:\n\n" + answersResult,
					display: true,
				},
				{ triggerTurn: true },
			);
		},
	});
}
