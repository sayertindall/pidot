import { expect, test } from "vitest";
import { ok, type Result } from "../result.ts";
import {
	projectSearchWebResultToPiToolResult,
	type ToolOutputStore,
	type ToolOutputStoreError,
} from "../tool-output.ts";
import { parsePublicHttpUrl, parseSearchQuery } from "../types.ts";

class RecordingToolOutputStore implements ToolOutputStore {
	readonly writes: Array<{ readonly prefix: string; readonly fileName: string; readonly content: string }> = [];

	constructor(private readonly outputPath: string) {}

	async writeTextFile(
		prefix: string,
		fileName: string,
		content: string,
	): Promise<Result<string, ToolOutputStoreError>> {
		this.writes.push({ prefix, fileName, content });
		return ok(this.outputPath);
	}
}

test("projectSearchWebResultToPiToolResult truncates and records full output path", async () => {
	const query = parseSearchQuery("example");
	const url = parsePublicHttpUrl("https://example.com/");
	expect(query._tag).toBe("ok");
	expect(url._tag).toBe("ok");
	const store = new RecordingToolOutputStore("/tmp/full-output.txt");

	const result = await projectSearchWebResultToPiToolResult(
		{
			query: query.value,
			depth: "auto",
			maxResults: 8,
			provider: "exa",
			results: Array.from({ length: 200 }, (_, index) => ({
				title: `Example ${index + 1}`,
				url: url.value,
				snippet: "Documentation-safe example domain.".repeat(20),
			})),
		},
		store,
	);

	expect(result._tag).toBe("ok");
	expect(result.value.details.truncated).toBe(true);
	expect(result.value.details.fullOutputPath).toBe("/tmp/full-output.txt");
	expect(result.value.content[0]?.type === "text" ? result.value.content[0].text : "").toMatch(/Output truncated/);
	expect(store.writes.length).toBe(1);
});
