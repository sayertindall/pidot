import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

let pendingWorktreeSwitch = false;

export function isPendingWorktreeSwitch(): boolean {
  return pendingWorktreeSwitch;
}

export function setPendingWorktreeSwitch(value: boolean): void {
  pendingWorktreeSwitch = value;
}

export function blockForWorktreeSwitch(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (pendingWorktreeSwitch) return;
  pendingWorktreeSwitch = true;
  ctx.ui.setStatus("worktree", "switch pending — press Enter");
  if (process.env.HERDR_ENV) {
    pi.events.emit("herdr:blocked", { active: true, label: "press Enter to switch worktree" });
  }
}

export function clearWorktreeBlock(pi: ExtensionAPI, ctx: ExtensionContext): void {
  if (!pendingWorktreeSwitch) return;
  pendingWorktreeSwitch = false;
  ctx.ui.setStatus("worktree", undefined);
  if (process.env.HERDR_ENV) {
    pi.events.emit("herdr:blocked", { active: false });
  }
}
