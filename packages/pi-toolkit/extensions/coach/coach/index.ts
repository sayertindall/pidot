import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { handleCoach } from "./command";

export default function coachExtension(pi: ExtensionAPI): void {
	pi.registerCommand("coach", {
		description: "LLM-powered deep analysis of PI session habits, plus /coach last to reopen the latest report",
		handler: async (args: string | undefined, ctx) => {
			await handleCoach(pi, args ?? "", ctx);
		},
	});
}
