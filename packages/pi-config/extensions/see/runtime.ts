/**
* see/runtime.ts
*
* Vision delegation via the Codex CLI: runs
*   codex exec -s read-only --skip-git-repo-check -m <model> -i <image>...
* with the prompt written to stdin (a positional prompt would be swallowed by
* the variadic `-i <FILE>...` flag).
*
* No config file, no state, no data directory: this extension is stateless.
*/
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";

export const DEFAULT_MODEL = "gpt-5.6-luna";

export interface DescribeImageOptions {
	/** Prompt written to codex on stdin. */
	prompt: string;
	/** Codex model id. Defaults to DEFAULT_MODEL. */
	model?: string;
	/** Abort signal forwarded to the child process. */
	signal?: AbortSignal;
	/** Kill the codex process after this many milliseconds. */
	timeoutMs?: number;
}

export function buildSeeArgs(paths: string[], model: string): string[] {
	const args = ["exec", "-s", "read-only", "--skip-git-repo-check"];
	if (model) args.push("-m", model);
	for (const path of paths) args.push("-i", path);
	return args;
}

export function describeImage(
	paths: string[],
	opts: DescribeImageOptions,
): Promise<string> {
	const { prompt, model = DEFAULT_MODEL, signal, timeoutMs = 180_000 } = opts;
	if (paths.length === 0)
		return Promise.reject(new Error("no image paths given"));
	for (const path of paths) {
		if (!existsSync(path)) {
			return Promise.reject(new Error(`image not found: ${path}`));
		}
	}
	return new Promise<string>((resolve, reject) => {
		const child = spawn("codex", buildSeeArgs(paths, model), {
			stdio: ["pipe", "pipe", "pipe"],
		});
		const timer = setTimeout(() => {
			child.kill("SIGTERM");
		}, timeoutMs);
		const onAbort = () => child.kill("SIGTERM");
		if (signal) {
			if (signal.aborted) onAbort();
			else signal.addEventListener("abort", onAbort, { once: true });
		}

		let stdout = "";
		let stderr = "";
		child.stdout.setEncoding("utf8");
		child.stderr.setEncoding("utf8");
		child.stdout.on("data", (chunk: string) => (stdout += chunk));
		child.stderr.on("data", (chunk: string) => (stderr += chunk));

		child.on("error", (error) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			const code = (error as NodeJS.ErrnoException).code;
			if (code === "ENOENT") {
				reject(
					new Error(
						"codex CLI not found on PATH. Install it with `npm install -g @openai/codex`.",
					),
				);
			} else {
				reject(new Error(`codex exec failed to start: ${error.message}`));
			}
		});

		child.on("close", (code, signalName) => {
			clearTimeout(timer);
			signal?.removeEventListener("abort", onAbort);
			const text = stdout.trim();
			if (code === 0) {
				resolve(text || "(no output)");
				return;
			}
			const tail = stderr.trim().split("\n").slice(-5).join("\n");
			reject(
				new Error(
					`codex exec exited (${code ?? signalName ?? "unknown"}): ${tail || "no stderr"}`,
				),
			);
		});

		child.stdin.end(prompt);
	});
}
