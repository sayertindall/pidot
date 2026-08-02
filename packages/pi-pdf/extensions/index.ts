import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { access, readFile, stat } from "node:fs/promises";
import { basename } from "node:path";

// ---------------------------------------------------------------------------
// pdf-inspector types (replicated since @firecrawl/pdf-inspector ships
// .node binaries and TypeBox needs explicit schemas)
// ---------------------------------------------------------------------------

type PdfType = "TextBased" | "Scanned" | "ImageBased" | "Mixed";

interface PdfClassification {
	pdfType: PdfType;
	pageCount: number;
	pagesNeedingOcr: number[];
	confidence: number;
}

interface ProcessPdfResult {
	pdfType: PdfType;
	pageCount: number;
	pagesNeedingOcr: number[];
	confidence: number;
	markdown?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const MAX_PDF_BYTES = 100 * 1024 * 1024; // 100 MB
const MAX_MARKDOWN_CHARS = 120_000;

function formatSize(bytes: number): string {
	if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
	if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(1)} KB`;
	return `${bytes} B`;
}

function pdfTypeLabel(t: PdfType): string {
	switch (t) {
		case "TextBased":
			return "text-based";
		case "Scanned":
			return "scanned (needs OCR)";
		case "ImageBased":
			return "image-based";
		case "Mixed":
			return "mixed (text + scanned pages)";
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function pdfExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "read_pdf",
		label: "Read PDF",
		description:
			"Read and extract text/markdown from a PDF file. " +
			"Classifies the PDF as text-based, scanned, image-based, or mixed. " +
			"Extracts structured markdown (headings, tables, lists, formatting) " +
			"from text-based PDFs. For scanned/image-based PDFs, text extraction " +
			"will be limited — use OCR tools for those.",
		promptSnippet: "Read a PDF file and extract text/markdown with classification.",
		promptGuidelines: [
			"Use read_pdf to inspect PDF documents, reports, invoices, research papers, and forms.",
			"Prefer read_pdf over bash-based PDF tools (pdftotext, etc.) — it preserves structure, tables, and formatting.",
			"When read_pdf reports pdfType=Scanned or ImageBased, the extracted text will be sparse or empty. Inform the user that OCR is needed.",
		],
		parameters: Type.Object({
			path: Type.String({
				description: "Absolute or relative path to the PDF file.",
			}),
		}),

		async execute(
			_toolCallId: string,
			params: unknown,
			signal?: AbortSignal,
			onUpdate?: (update: {
				content: Array<{ type: "text"; text: string }>;
				details: Record<string, unknown>;
			}) => void,
		) {
			const { path } = params as { path: string };

			// -- validate & load -------------------------------------------------

			await access(path).catch(() => {
				throw new Error(`File not found: ${path}`);
			});

			const stats = await stat(path);
			if (!stats.isFile()) {
				throw new Error(`Not a file: ${path}`);
			}
			if (stats.size > MAX_PDF_BYTES) {
				throw new Error(
					`PDF too large (${formatSize(stats.size)}, max ${formatSize(MAX_PDF_BYTES)}). ` +
						`Use a tool that streams pages instead.`,
				);
			}
			if (stats.size === 0) {
				throw new Error(`PDF file is empty: ${path}`);
			}

			const fileName = basename(path);

			onUpdate?.({
				content: [textContent(`Reading ${fileName} (${formatSize(stats.size)})...`)],
				details: { stage: "loading", path, size: stats.size },
			});

			const pdfBuffer = await readFile(path);

			// -- load pdf-inspector ----------------------------------------------
			// Dynamic import so the extension loads even when the native module
			// isn't installed yet (pi will show a clear error at tool-call time).

			const { processPdf, classifyPdf } = await import(
				"@firecrawl/pdf-inspector"
			);

			onUpdate?.({
				content: [textContent(`Classifying ${fileName}...`)],
				details: { stage: "classifying", path, size: stats.size },
			});

			signal?.throwIfAborted();

			// -- classify --------------------------------------------------------

			let classification: PdfClassification;
			try {
				classification = classifyPdf(pdfBuffer);
			} catch {
				// classifyPdf may not be available in older versions; try processPdf
				classification = { pdfType: "TextBased" as PdfType, pageCount: 0, pagesNeedingOcr: [], confidence: 0 };
			}

			const { pdfType, pageCount, pagesNeedingOcr: ocrPages, confidence } = classification;

			// -- extract markdown ------------------------------------------------

			let markdown: string | undefined;
			let extractionNote = "";

			if (pdfType === "TextBased" || pdfType === "Mixed") {
				onUpdate?.({
					content: [textContent(`Extracting text from ${fileName}...`)],
					details: { stage: "extracting", path, size: stats.size, pdfType, pageCount, confidence },
				});

				signal?.throwIfAborted();

				try {
					const result: ProcessPdfResult = processPdf(pdfBuffer);
					markdown = result.markdown;

					if (markdown && markdown.length > MAX_MARKDOWN_CHARS) {
						const truncated = markdown.slice(0, MAX_MARKDOWN_CHARS);
						const omitted = markdown.length - MAX_MARKDOWN_CHARS;
						markdown = truncated;
						extractionNote =
							`\n\n> ⚠️  Markdown output truncated at ${formatSize(MAX_MARKDOWN_CHARS)} characters ` +
							`(${formatSize(omitted)} omitted).`;
					}
				} catch (err) {
					extractionNote =
						`\n\n> ⚠️  Markdown extraction failed: ${err instanceof Error ? err.message : String(err)}. ` +
						`Classification data is still available.`;
				}
			}

			// -- build response --------------------------------------------------

			const lines: string[] = [];

			lines.push(`## ${fileName}`);
			lines.push("");
			lines.push(`| Property | Value |`);
			lines.push(`|----------|-------|`);
			lines.push(`| **Type** | ${pdfTypeLabel(pdfType)} |`);
			lines.push(`| **Pages** | ${pageCount} |`);
			lines.push(`| **Confidence** | ${(confidence * 100).toFixed(1)}% |`);

			if (ocrPages.length > 0) {
				const pageList = ocrPages.length <= 10
					? ocrPages.map((p) => p + 1).join(", ")
					: ocrPages.slice(0, 10).map((p) => p + 1).join(", ") + ` ... (+${ocrPages.length - 10} more)`;
				lines.push(`| **Pages needing OCR** | ${pageList} |`);
			}

			if (markdown) {
				lines.push("");
				lines.push("### Extracted Content");
				lines.push("");
				lines.push(markdown);
			}

			if (extractionNote) {
				lines.push(extractionNote);
			}

			if (pdfType === "Scanned" || pdfType === "ImageBased") {
				lines.push("");
				lines.push(
					"> ℹ️  This PDF is **" +
						pdfTypeLabel(pdfType) +
						"**. " +
						"The text layer is empty or unusable. " +
						"Use an OCR tool to extract text from the rendered page images.",
				);
			}

			return {
				content: [{ type: "text" as const, text: lines.join("\n") }],
				details: {
					pdfType,
					pageCount,
					pagesNeedingOcr: ocrPages,
					confidence,
					hasMarkdown: markdown !== undefined && markdown.length > 0,
					markdownLength: markdown?.length ?? 0,
				},
			};
		},
	});
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function textContent(text: string): { type: "text"; text: string } {
	return { type: "text", text };
}
