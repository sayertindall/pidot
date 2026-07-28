/**
 * pi-toolkit extension registry.
 *
 * Bundles all pi-toolkit sub-extensions into one package:
 *   - clean-sessions   — Remove old/stale pi sessions
 *   - coach            — Interactive coaching prompts
 *   - find-session     — Search and navigate to past sessions
 *   - loop             — Loop over a command until it succeeds
 *   - qna              — Extract & answer questions from assistant responses
 *   - session-control  — Unix socket RPC for session-to-session communication
 *   - tilldone         — Keep running until the task is actually done
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import cleanSessionsExtensions from "../clean-sessions/extensions/index";
import coachExtensions from "../coach/extensions/index";
import findSessionExtensions from "../find-session/extensions/index";
import loopExtensions from "../loop/extensions/index";
import qnaExtensions from "../qna/extensions/index";
import sessionControlExtensions from "../session-control/extensions/index";
import tilldoneExtensions from "../tilldone/extensions/index";

export default function piToolkitExtensions(pi: ExtensionAPI): void {
	cleanSessionsExtensions(pi);
	coachExtensions(pi);
	findSessionExtensions(pi);
	loopExtensions(pi);
	qnaExtensions(pi);
	sessionControlExtensions(pi);
	tilldoneExtensions(pi);
}
