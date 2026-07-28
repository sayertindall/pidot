/**
 * pi-ssh — extension factory.
 *
 * When SSH mode is on, four tools (`ssh_read`, `ssh_write`,
 * `ssh_edit`, `ssh_bash`) replace the standard read/write/edit/bash
 * tools and route through the active SSH target's remote host. When
 * SSH mode is off, those tools are removed from the active tool
 * set and the standard local tools take over.
 *
 * The extension is shaped around an "active target" — at most one
 * SSH host at a time. `/ssh <host>[:/path]` activates; `/ssh off`
 * deactivates. The `before_agent_start` hook injects a system
 * prompt noting the active target so the model knows which
 * operations are remote vs. local.
 *
 * The SDK supplies typed tool definitions
 * (`createReadToolDefinition`, etc.) that accept custom
 * `ReadOperations` / `WriteOperations` / `EditOperations` /
 * `BashOperations`. The `remote-ops.ts` factory functions return
 * operation sets that issue SSH commands instead of local I/O.
 *
 * DEPENDENCY INJECTION: `sshExec`'s spawn call is overridable via
 * the `spawnImpl` factory parameter for testability. Tests pass a
 * fake that records what was sent and lets the test drive the
 * response.
 */

import { homedir } from "node:os";
import {
	createBashToolDefinition,
	createEditToolDefinition,
	createReadToolDefinition,
	createWriteToolDefinition,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { defaultSshConfigPath, normalizeTargetArg, readSshProfiles } from "./profiles";
import { toLocalEditPath } from "./path-utils";
import {
	createRemoteBashOps,
	createRemoteEditOps,
	createRemoteReadOps,
	createRemoteWriteOps,
	resolveRemoteCwd,
	type SshSpawn,
} from "./remote-ops";
import type { ActiveSshTarget, SshProfile } from "./types";

type SshToolsDeps = {
	spawnImpl?: SshSpawn;
	configPath?: string;
	home?: string;
};

const SSH_STATUS_KEY = "ssh-tools";
const SSH_TOOL_NAMES = ["ssh_read", "ssh_write", "ssh_edit", "ssh_bash"] as const;
const SSH_TOOL_NAME_SET = new Set<string>(SSH_TOOL_NAMES);

function enableSshTools(pi: ExtensionAPI): void {
	const next = new Set(pi.getActiveTools());
	for (const name of SSH_TOOL_NAMES) {
		next.add(name);
	}
	pi.setActiveTools(Array.from(next));
}

function disableSshTools(pi: ExtensionAPI): void {
	const next = pi.getActiveTools().filter((name) => !SSH_TOOL_NAME_SET.has(name));
	pi.setActiveTools(next);
}

export default function sshToolsExtension(pi: ExtensionAPI, deps: SshToolsDeps = {}): void {
	const home = deps.home ?? homedir();
	const configPath = deps.configPath ?? defaultSshConfigPath(home);
	const spawnImpl = deps.spawnImpl;

	let activeTarget: ActiveSshTarget | null = null;

	const refreshProfiles = (): SshProfile[] => readSshProfiles(configPath);

	const updateStatus = (ctx: ExtensionContext): void => {
		if (!activeTarget) {
			ctx.ui.setStatus(SSH_STATUS_KEY, undefined);
			return;
		}
		ctx.ui.setStatus(
			SSH_STATUS_KEY,
			ctx.ui.theme.fg("accent", `SSH ${activeTarget.name}:${activeTarget.remoteCwd}`),
		);
	};

	const activate = async (profile: SshProfile, ctx: ExtensionCommandContext): Promise<void> => {
		const remoteCwd = await resolveRemoteCwd(profile, spawnImpl);
		activeTarget = { name: profile.name, remote: profile.remote, remoteCwd };
		enableSshTools(pi);
		updateStatus(ctx);
		ctx.ui.notify(`SSH mode on: ${activeTarget.name} (${activeTarget.remoteCwd})`, "info");
	};

	const deactivate = (ctx: ExtensionCommandContext): void => {
		activeTarget = null;
		disableSshTools(pi);
		updateStatus(ctx);
		ctx.ui.notify("SSH mode off", "info");
	};

	const requireActiveTarget = (): ActiveSshTarget => {
		if (!activeTarget) {
			throw new Error("SSH mode is off. Use /ssh <host> first.");
		}
		return activeTarget;
	};

	// --- tools (ssh_read / ssh_write / ssh_edit / ssh_bash) ---

	pi.registerTool({
		name: "ssh_read",
		label: "ssh_read",
		description:
			"Read a file on the active SSH host. Relative paths are resolved against the active remote working directory.",
		promptSnippet: "Read file contents on the active SSH host",
		promptGuidelines: ["Use ssh_read when the task is on the active SSH host instead of the local machine."],
		parameters: createReadToolDefinition("/").parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const target = requireActiveTarget();
			const tool = createReadToolDefinition(target.remoteCwd, {
				operations: createRemoteReadOps(target, spawnImpl),
			});
			return tool.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme) {
			const path = typeof args?.path === "string" ? args.path : "...";
			const targetLabel = activeTarget ? activeTarget.name : "inactive";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ssh_read"))} ${theme.fg("accent", path)} ${theme.fg("muted", `[${targetLabel}]`)}`,
				0,
				0,
			);
		},
		renderResult: createReadToolDefinition("/").renderResult,
	});

	pi.registerTool({
		name: "ssh_write",
		label: "ssh_write",
		description:
			"Write a text file on the active SSH host. Relative paths are resolved against the active remote working directory.",
		promptSnippet: "Create or overwrite files on the active SSH host",
		promptGuidelines: ["Use ssh_write only for new files or full rewrites on the active SSH host."],
		parameters: createWriteToolDefinition("/").parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const target = requireActiveTarget();
			const tool = createWriteToolDefinition(target.remoteCwd, {
				operations: createRemoteWriteOps(target, spawnImpl),
			});
			return tool.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme) {
			const path = typeof args?.path === "string" ? args.path : "...";
			const targetLabel = activeTarget ? activeTarget.name : "inactive";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ssh_write"))} ${theme.fg("accent", path)} ${theme.fg("muted", `[${targetLabel}]`)}`,
				0,
				0,
			);
		},
		renderResult: createWriteToolDefinition("/").renderResult,
	});

	pi.registerTool({
		name: "ssh_edit",
		label: "ssh_edit",
		description:
			"Edit a file on the active SSH host using exact text replacement. Relative paths are resolved against the active remote working directory.",
		promptSnippet: "Make precise file edits on the active SSH host",
		promptGuidelines: [
			"Use ssh_edit for precise remote changes.",
			"Each edits[].oldText must match exactly on the remote file.",
		],
		parameters: createEditToolDefinition("/").parameters,
		prepareArguments: createEditToolDefinition("/").prepareArguments,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const target = requireActiveTarget();
			const localCwd = process.cwd();
			const transformedParams = {
				...params,
				path: toLocalEditPath(params.path, target.remoteCwd),
			};
			const tool = createEditToolDefinition(localCwd, {
				operations: createRemoteEditOps(target, localCwd, spawnImpl),
			});
			return tool.execute(toolCallId, transformedParams, signal, onUpdate, ctx);
		},
		renderCall(args, theme) {
			const path = typeof args?.path === "string" ? args.path : "...";
			const targetLabel = activeTarget ? activeTarget.name : "inactive";
			return new Text(
				`${theme.fg("toolTitle", theme.bold("ssh_edit"))} ${theme.fg("accent", path)} ${theme.fg("muted", `[${targetLabel}]`)}`,
				0,
				0,
			);
		},
		renderResult: createEditToolDefinition("/").renderResult,
	});

	pi.registerTool({
		name: "ssh_bash",
		label: "ssh_bash",
		description: "Execute a bash command on the active SSH host in the active remote working directory.",
		promptSnippet: "Execute bash commands on the active SSH host",
		promptGuidelines: ["Use ssh_bash when the command must run on the active SSH host rather than locally."],
		parameters: createBashToolDefinition("/").parameters,
		async execute(toolCallId, params, signal, onUpdate, ctx) {
			const target = requireActiveTarget();
			const tool = createBashToolDefinition(target.remoteCwd, {
				operations: createRemoteBashOps(target, spawnImpl),
			});
			return tool.execute(toolCallId, params, signal, onUpdate, ctx);
		},
		renderCall(args, theme, context) {
			const command = typeof args?.command === "string" ? args.command : "...";
			const targetLabel = activeTarget ? activeTarget.name : "inactive";
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(
				`${theme.fg("toolTitle", theme.bold("ssh_bash"))} ${theme.fg("accent", command)} ${theme.fg("muted", `[${targetLabel}]`)}`,
			);
			return text;
		},
		renderResult: createBashToolDefinition("/").renderResult,
	});

	// --- /ssh command ---

	pi.registerCommand("ssh", {
		description: "Toggle remote SSH tools: /ssh, /ssh off, /ssh status, /ssh <host>[:/path]",
		getArgumentCompletions: (prefix) => {
			const options = ["off", "status", ...refreshProfiles().map((profile) => profile.name)];
			const filtered = options.filter((option) => option.startsWith(prefix));
			return filtered.length > 0 ? filtered.map((option) => ({ value: option, label: option })) : null;
		},
		handler: async (args, ctx) => {
			const input = args.trim();
			const profiles = refreshProfiles();

			if (input === "status") {
				if (!activeTarget) {
					ctx.ui.notify("SSH mode is off", "info");
					return;
				}
				ctx.ui.notify(`SSH mode: ${activeTarget.name} (${activeTarget.remote}:${activeTarget.remoteCwd})`, "info");
				return;
			}

			if (input === "off") {
				if (!activeTarget) {
					ctx.ui.notify("SSH mode is already off", "info");
					return;
				}
				deactivate(ctx);
				return;
			}

			if (!input) {
				if (profiles.length === 0) {
					ctx.ui.notify("No SSH hosts found in ~/.ssh/config. Use /ssh <host>[:/path]", "warning");
					return;
				}
				const items = [...(activeTarget ? ["off"] : []), ...profiles.map((profile) => profile.name)];
				const picked = await ctx.ui.select("SSH target", items);
				if (!picked) {
					return;
				}
				if (picked === "off") {
					deactivate(ctx);
					return;
				}
				await activate(normalizeTargetArg(picked, profiles), ctx);
				return;
			}

			await activate(normalizeTargetArg(input, profiles), ctx);
		},
	});

	pi.on("session_start", async (_event, ctx) => {
		activeTarget = null;
		disableSshTools(pi);
		updateStatus(ctx);
	});

	pi.on("before_agent_start", async (event) => {
		if (!activeTarget) {
			return;
		}
		return {
			systemPrompt:
				event.systemPrompt +
				`\n\nSSH mode is active for this turn.\nRemote host: ${activeTarget.remote}\nRemote working directory: ${activeTarget.remoteCwd}\nUse ssh_read, ssh_write, ssh_edit, and ssh_bash for remote work. Local read/write/edit/bash still operate on the local machine.`,
		};
	});
}
