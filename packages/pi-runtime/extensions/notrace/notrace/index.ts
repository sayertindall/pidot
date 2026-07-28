import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { notraceCommand } from "./command.js";

export default function (pi: ExtensionAPI): void {
  pi.registerCommand("notrace", {
    description: "Generate a self-contained HTML session report",
    handler: async (args, ctx) => {
      await notraceCommand(args, ctx);
    },
  });
}
