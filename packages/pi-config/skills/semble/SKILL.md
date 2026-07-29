---
name: semble
description: "Fast semantic code search with `semble_rs` — hybrid BM25 + embedding retrieval that replaces grep/cat/read/ls. Use when searching a codebase for how something works, finding specific symbols, exploring dependencies, or compressing build/CI output. Also use when the user says 'find where X is handled', 'search for Y', 'what depends on Z', 'compress this log', or asks for a codebase overview."
---

# semble_rs — Semantic Code Search

Use `semble_rs` to search codebases efficiently. One binary. No daemon, no API keys, no GPU needed. Auto-downloads a 60MB embedding model on first run.

## When to Use

- Searching for "where is X handled" or "how does Y work" in a codebase
- Finding code by what it does, not just by symbol name
- Getting a quick codebase overview (`tree`)
- Understanding dependencies (`deps` / `impact`)
- Compressing build/test/CI output before reading it (`digest`)
- The user says: "search the codebase", "find where", "show me the deps", "what uses this", "compress this output"

## When NOT to Use

- For exact symbol/string matching — use `rg` (ripgrep) instead
- For running tests or builds — use the actual build tool
- For reading specific known files — use `read` directly
- The codebase is not indexed and the query is trivial — `grep` is faster

## Essential Principles

1. **Two-pass search.** Always start with `--outline` to survey structure, then narrow with `--compact` for matching lines. Never jump straight to `--json` for initial exploration — it's 9x more tokens.
2. **Use `plan` for unknown targets.** When you don't know which files or symbols are relevant, run `semble_rs plan "<task>"` first. It recommends a search sequence. Skip it when you already know the symbol or feature name.
3. **`digest` before reading logs.** Always pipe build/test/CI output through `semble_rs digest` before reading it. 3MB logs compress to 35KB. Errors and tracebacks are always preserved.
4. **`tree --symbols` over `ls -R`.** The codebase tree is up to 747x smaller and gitignore-aware. Always prefer it for structural overviews.

## Commands

### Search

```bash
# Pass 1: structural scan (cheapest output mode)
semble_rs search "how is auth handled" --outline

# Pass 2: matching lines (narrow down)
semble_rs search "loginWithEmail" --compact

# Pass 3: full JSON (only if chunk bodies are needed)
semble_rs search "password hashing" --json --strip

# With remote repos (auto-cloned shallow)
semble_rs search "model export" https://github.com/owner/repo
```

Output modes ranked by token cost (cheapest first):
| Mode | When |
|------|------|
| `--outline` | First-pass: one signature per chunk |
| `--group` | Many matches: capped at 3 per chunk, grouped by dir |
| `--compact` | Precision scan: score + path + every matching line |
| `--json --strip` | Tooling: chunk bodies, comments stripped |
| `--json` | Tooling: raw chunk bodies |

### Find Related

Given a `file:line` from a search result, find semantically similar code:

```bash
semble_rs find-related src/auth.rs 42
```

### Tree

```bash
semble_rs tree                  # current dir, gitignore-aware
semble_rs tree --symbols        # + top-level symbols per file
semble_rs tree --max-depth 2    # cap depth
semble_rs tree --lang rust,py   # filter by language
```

### Dependencies & Impact

```bash
semble_rs deps src/auth.rs           # what this file imports + defines
semble_rs deps src/auth.rs --tree    # transitive imports as ASCII tree
semble_rs impact src/auth.rs         # who depends on this file
semble_rs impact src/auth.rs --tree  # reverse-dependency tree
```

### Digest (compress build/CI output)

```bash
cargo build 2>&1 | semble_rs digest
pnpm install 2>&1 | semble_rs digest
gh run view <id> --log-failed | semble_rs digest
```

Auto-detects: cargo, pnpm/npm/yarn/bun, tsc, pytest, go test, gradle, ruff, mypy, clang/gcc/cmake/make/swiftc, GitHub Actions.

### Plan (search strategy)

```bash
semble_rs plan "fix auth flow bug" -k 5
```

## Flags Reference

| Flag | Effect |
|------|--------|
| `-k, --top-k <N>` | Number of results (default 10) |
| `--include-text-files` | Also index `.md`, `.yaml`, `.json`, etc. |
| `--json` | Output as JSON |
| `--compact` | Score + path + match lines only |
| `--strip` | Strip comments from JSON chunks |
| `--outline` | One signature per chunk (cheapest) |
| `--group` | Group by directory, cap at 3 lines each |
| `--model <repo>` | Override embedding model |
