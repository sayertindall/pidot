# pi-config: Review

Code review launcher — spawns a fresh pi session in a new git branch for
isolated review of uncommitted changes, branch diffs, commits, or pull requests.

## Features

- **Four target types**: Uncommitted changes, branch diff, specific commit, or pull request
- **Interactive target picker**: Guided selection via `ctx.ui.select` (branch, commit from history, PR number/URL)
- **Fresh session branch**: Review runs in isolated session — no pollution of current conversation
- **Persistent state**: Per-session state under `~/.pi/agent/pi-config/review/<base64url(session_id)>/`
- **PR checkout**: Checks out PR via `gh pr checkout`, validates no pending changes
- **Review guidelines**: Loads rubric from `REVIEW_GUIDELINES.md` or defaults
- **Single follow-up bundle**: Posts one hidden message to the main session on completion (not per-file spam)

## Structure

```
pi-config/extensions/review/
├── index.ts          # Extension entry — /review, /end-review commands
├── commands.ts       # Argument parser (parseReviewArgs)
├── selectors.ts      # Interactive target picker (branch/commit/PR)
├── targets.ts        # Git helpers: branches, commits, PR info, merge base
├── runtime.ts        # Review session lifecycle, rubric loading, prompt building
├── state.ts          # Session-scoped state (base64url session ID)
├── ui.ts             # Widget rendering
├── schemas.ts        # TypeBox schemas for ReviewState
└── types.ts          # ReviewTarget, ReviewRecord, ReviewStatus
```

## Commands

| Command | Description |
|---|---|
| `/review` | Start review — `uncommitted`, `branch <name>`, `commit <sha>`, `pr <num>`, or interactive |
| `/end-review` | End current review session |

### Review arguments

| Arg | Description |
|---|---|
| (none) | Interactive target picker |
| `uncommitted` | Review current uncommitted changes |
| `branch <name>` | Review diff against a base branch |
| `commit <sha>` | Review a specific commit |
| `pr <number>` | Review a pull request (checks out via `gh pr checkout`) |
| `--extra <text>` | Extra instructions for the reviewer |

## Target resolution (targets.ts)

| Function | Description |
|---|---|
| `getMergeBase` | Find merge base between HEAD and a branch |
| `getLocalBranches` | List local git branches |
| `getDefaultBranch` | Detect main/master |
| `getCurrentBranch` | Current branch name |
| `getRecentCommits` | Recent commit log (sha + title) |
| `hasPendingChanges` | Check git status for tracked changes |
| `parsePrReference` | Parse PR number from plain number or GitHub URL |
| `getPrInfo` | PR details via `gh pr view --json` |
| `checkoutPr` | Check out PR via `gh pr checkout` |
| `getUserFacingHint` | Human-readable target description |

## State

Per-session state stored at:
```
~/.pi/agent/pi-config/review/<base64url(session_id)>/state.json
```

```json
{
  "current": {
    "target": { "type": "uncommitted" },
    "status": "running",
    "startedAt": 1700000000000,
    "updatedAt": 1700000001000,
    "toolCount": 5,
    "filesChanged": 3
  }
}
```

## Limitations

- Requires `git` for all operations, `gh` CLI for PR checkout
- Review runs in a child session — results returned as a follow-up message
- No inline review (all review happens in the child session)
- PR checkout blocked if uncommitted changes exist
