import { expect, test } from "vitest";
import { ok, type Result } from "../result.ts";
import { SearchWeb } from "../search-web.ts";
import { parsePublicHttpUrl, parseSearchQuery, type WebToolsSettings } from "../types.ts";
import type { NormalizedSearchResult, SearchProvider, SearchProviderError, SearchProviderRequest } from "../providers/types.ts";

const endpoint = parsePublicHttpUrl("https://example.test/mcp");
if (endpoint._tag !== "ok") throw new Error("Invalid test URL");

const testSearchSettings: WebToolsSettings["search"] = {
	enabled: true,
	provider: "exa",
	endpoint: endpoint.value,
	timeoutSeconds: 25,
	defaultMaxResults: 8,
	defaultDepth: "auto",
};

class FakeSearchProvider implements SearchProvider {
	readonly name = "exa" as const;
	readonly requests: SearchProviderRequest[] = [];

	constructor(private readonly response: Result<readonly NormalizedSearchResult[], SearchProviderError>) {}

	async search(
		input: SearchProviderRequest,
		_options?: { readonly signal?: AbortSignal },
	): Promise<Result<readonly NormalizedSearchResult[], SearchProviderError>> {
		this.requests.push(input);
		return this.response;
	}
}

test("SearchWeb returns provider results with query metadata", async () => {
	const query = parseSearchQuery("example");
	const resultUrl = parsePublicHttpUrl("https://example.com/");
	expect(query._tag).toBe("ok");
	expect(resultUrl._tag).toBe("ok");
	const exampleResult: NormalizedSearchResult = {
		title: "Example Domain",
		url: resultUrl.value,
		snippet: "Documentation-safe example domain.",
	};
	const provider = new FakeSearchProvider(ok([exampleResult]));
	const service = new SearchWeb({ provider, settings: testSearchSettings });

	const result = await service.search({ query: query.value, maxResults: 8, depth: "auto" });

	expect(result._tag).toBe("ok");
	expect(result.value.provider).toBe("exa");
	expect(result.value.query).toBe("example");
	expect(result.value.results.length).toBe(1);
});
