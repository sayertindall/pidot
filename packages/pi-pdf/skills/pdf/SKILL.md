---
name: pdf
description: "Read PDF files and extract structured text/markdown using Firecrawl's pdf-inspector — a fast Rust-native parser. Classifies PDFs as text-based, scanned, image-based, or mixed, then extracts markdown with headings, tables, lists, formatting, and reading-order awareness. Trigger when the user asks to read a PDF, inspect a PDF document, extract text from a PDF, or convert a PDF to markdown. Also trigger for questions like 'what's in this PDF?', 'summarize this report', 'extract tables from this invoice', or when a .pdf file is mentioned in conversation."
---

## PDF Reading with `read_pdf`

Use the `read_pdf` tool to read PDF files. It is backed by
[pdf-inspector](https://github.com/firecrawl/pdf-inspector), a fast Rust
library that classifies and extracts text from PDFs in under 200ms without
OCR or external services.

### What it does

1. **Classifies** the PDF as one of:
   - **TextBased** — fully digital text, ready for extraction
   - **Scanned** — needs OCR; text layer is empty
   - **ImageBased** — page images without any text
   - **Mixed** — some pages are text, others need OCR

2. **Extracts** structured markdown from text-based and mixed PDFs:
   - Headings (H1–H4 via font size ratios)
   - Tables (rectangle-based + heuristic detection)
   - Bullet, numbered, and letter lists
   - Code blocks (monospace font detection)
   - Bold/italic formatting
   - URL linking and page breaks
   - Multi-column reading order

### Usage

```bash
# Call the tool directly — it takes a file path
read_pdf(path="path/to/document.pdf")
```

The tool accepts absolute or relative paths.

### What you get back

- Classification info (type, page count, confidence, OCR-needed pages)
- Extracted markdown content (for text-based/mixed PDFs)
- Clear guidance when a PDF needs OCR instead

### When to use this vs. other tools

| Tool | Use when |
|------|----------|
| `read_pdf` | Reading PDF content, inspecting a document, extracting text/structure |
| `read` | Looking at raw PDF bytes (rarely useful) |
| `bash` + `pdftotext` | Fallback if `read_pdf` is unavailable |

### Limitations

- **No OCR**: Scanned PDFs will return classification info but no text. Tell the user when a PDF needs OCR.
- **Max 100 MB**: Large PDFs are rejected with a clear error message.
- **Max output**: Markdown is truncated at ~120K characters to fit context windows.
- **Single-file only**: The tool reads one PDF at a time.

### Best practices

1. **Always try `read_pdf` first** for any PDF the user mentions — it's fast and preserves structure.
2. **Check the pdfType** in the result. If it's Scanned or ImageBased, tell the user immediately and suggest OCR options.
3. **For tables**: pdf-inspector has strong table detection. When the user asks about tables in a PDF, `read_pdf` is always the right first tool.
4. **For forms/invoices**: The structured markdown preserves the layout better than raw text extraction.
