export const MAX_MSG_CHARS = 500;
export const MAX_ASSISTANT_CHARS = 200;

export function messageContentToText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map((block) => {
			if (!block || typeof block !== "object") return "";
			const b = block as { type?: string; text?: string };
			return b.type === "text" && typeof b.text === "string" ? b.text : "";
		})
		.filter(Boolean)
		.join("\n")
		.trim();
}

export function truncate(text: string, max: number): string {
	const clean = text.replace(/\s+/g, " ").trim();
	if (clean.length <= max) return clean;
	return clean.slice(0, max - 1) + "…";
}

export function abbreviatePath(filePath: string, cwd: string): string {
	if (filePath.startsWith(cwd + "/")) return filePath.slice(cwd.length + 1);
	const home = process.env.HOME ?? "";
	if (home && filePath.startsWith(home + "/")) return "~/" + filePath.slice(home.length + 1);
	return filePath;
}
