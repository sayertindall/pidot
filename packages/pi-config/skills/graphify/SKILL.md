---
name: graphify
description: "Turn any folder of files into a queryable knowledge graph with community detection. Use for codebase questions when a graph already exists, or to build a graph from code, docs, papers, images, or video. Trigger when the user says 'graphify this', 'build a knowledge graph', 'map this codebase', asks a question about a codebase that has graphify-out/, or wants to understand project architecture through a graph. Also trigger for 'what does the graph say about X?' or 'trace the connection between Y and Z.'"
---

# Graphify

Turn any folder of files into a navigable knowledge graph. Drop in code, docs, papers, images, or video — get back interactive HTML, GraphRAG-ready JSON, and a plain-language `GRAPH_REPORT.md` with god nodes, surprising connections, and suggested questions.

The full pipeline spec lives at `/Users/sayertindall/.agents/skills/graphify/SKILL.md`. This skill covers the decision points: when to build vs. query, which mode to use, and how to navigate the graph effectively.

## When to Use

- User says "graphify this", "build a knowledge graph", "map this codebase"
- User asks a question about a codebase that already has `graphify-out/graph.json`
- User says "what does the graph say about X?" or "trace the connection between Y and Z"
- User passes a URL, path, or asks to clone and graph a repo
- User wants to understand project architecture, dependencies, or cross-module connections
- User asks "how does X work?" or "what calls Y?" in a graphed codebase

## When NOT to Use

- The user wants a one-off grep or symbol lookup → use `rg` or `semble_rs`
- The corpus is trivial (a single file, a few dozen lines) → read it directly
- The user explicitly says "don't graph this" → respect that
- The graph already exists and the question is a simple file read → use the graph query, don't rebuild

## Essential Principles

1. **Check for an existing graph before building.** If `graphify-out/graph.json` exists and the user is asking a codebase question (not a rebuild command), jump straight to querying. A graph already built is a graph ready to answer. *Failure mode: rebuilding a 50,000-node graph because the user asked "how does auth work?"*

2. **Match the mode to the task.** `--mode deep` for thorough extraction with richer inferred edges. `--update` for incremental changes (new/modified files only). Default mode for a first build. *Failure mode: running deep mode on a 200K-file monorepo, burning tokens on edges the user didn't need.*

3. **Query with vocabulary from the graph, not from memory.** Before running a query, expand the user's question against the graph's actual node labels. A user asking about "authentication" in a codebase where the graph calls it `Guardian` will get zero hits unless you map the term first. *Failure mode: "No results found" because the graph uses different words than the user.*

4. **Never invent an edge.** Every edge must be EXTRACTED (explicit in source), INFERRED (reasonable, with a confidence score), or AMBIGUOUS (flagged for review). If you're unsure, use AMBIGUOUS — never omit. *Failure mode: a graph full of confident-sounding edges the code doesn't actually contain.*

5. **Respect corpus size.** If `detect` reports >500 files or >2M words, warn the user and suggest narrowing to a subdirectory. A graph too large to navigate is worse than no graph. *Failure mode: a 12-hour build that produces an unreadable 10,000-community graph.*

6. **Present the interesting findings.** After a build, always surface god nodes, surprising connections, and suggested questions from `GRAPH_REPORT.md`. Offer to trace the most interesting question. The graph is a map — your job is to be the guide. *Failure mode: building the graph and saying "done" without showing the user what's in it.*

## Fast Path: Querying an Existing Graph

When `graphify-out/graph.json` exists and the user asks a codebase question:

```bash
graphify query "<question>"           # BFS - broad context
graphify query "<question>" --dfs     # DFS - trace a specific path
graphify query "<question>" --budget 1500  # cap answer at N tokens
```

If the CLI is unavailable, load `graphify-out/graph.json` and run an inline NetworkX traversal. Always:
1. Expand the question against the graph's vocabulary first
2. Quote `source_location` when citing facts
3. Save the answer back with `graphify save-result` so the graph learns

See `references/query.md` in the full spec for the vocab-expansion flow, BFS/DFS traversal, and inline NetworkX fallback.

## Full Build Pipeline

When no graph exists, or the user explicitly asks to build/rebuild:

```bash
/graphify <path>                      # full pipeline
/graphify <path> --mode deep          # richer inferred edges
/graphify <path> --update             # incremental, changed files only
/graphify https://github.com/<owner>/<repo>  # clone then build
/graphify <path> --directed           # preserve edge direction
/graphify <path> --obsidian           # also generate Obsidian vault
```

The pipeline has 9 steps: install → detect → extract (AST + semantic) → build & cluster → label communities → generate HTML → optional exports → cleanup & report. Load the full spec at `/Users/sayertindall/.agents/skills/graphify/SKILL.md` and follow each step in order. Do not skip steps.

Key flags:
| Flag | When |
|------|------|
| `--mode deep` | User wants thorough analysis, willing to spend tokens |
| `--update` | Files changed since last run, avoid full rebuild |
| `--directed` | Edge direction matters (calls, imports, data flow) |
| `--no-viz` | Skip HTML, just report + JSON |
| `--obsidian` | User wants an Obsidian vault of the graph |
| `--wiki` | Generate agent-crawlable wiki |
| `--neo4j` / `--neo4j-push` | Export to Neo4j |
| `--svg` / `--graphml` | Static export for Notion, Gephi, yEd |
| `--watch` | Auto-rebuild on file changes |

## Navigating the Graph

```
/graphify path "AuthModule" "Database"     # shortest path between concepts
/graphify explain "SwinTransformer"        # plain-language node explanation
```

After a build, always paste the God Nodes, Surprising Connections, and Suggested Questions from `GRAPH_REPORT.md`. Then offer to trace the most interesting question — the one that crosses the most community boundaries or has the most surprising bridge node.

Each answer should end with a natural follow-up so the session feels like navigation, not a one-shot report.

## Honesty Rules

- Never invent an edge. If unsure, use AMBIGUOUS.
- Never skip the corpus check warning.
- Always show token cost in the report.
- Never hide cohesion scores behind symbols — show the raw number.
- Never run HTML viz on a graph with more than 5,000 nodes without warning the user.
