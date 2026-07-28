import { describe, it, expect } from "vitest";

import {
	emptyGitStatus,
	parseGitStatusPorcelain,
	parseGitNumstat,
	detectGitState,
} from "./git";

// ===========================================================================
// emptyGitStatus
// ===========================================================================

describe("emptyGitStatus", () => {
	it("returns a zeroed-out GitStatusSummary", () => {
		const status = emptyGitStatus();
		expect(status).toEqual({
			branch: undefined,
			dirty: false,
			ahead: 0,
			behind: 0,
			conflicted: 0,
			untracked: 0,
			stashed: 0,
			modified: 0,
			staged: 0,
			renamed: 0,
			deleted: 0,
			typechanged: 0,
			gitState: undefined,
			gitStateLabel: undefined,
			commit: undefined,
			metrics: undefined,
		});
	});

	it("returns a new object each call", () => {
		expect(emptyGitStatus()).not.toBe(emptyGitStatus());
	});
});

// ===========================================================================
// parseGitStatusPorcelain
// ===========================================================================

describe("parseGitStatusPorcelain", () => {
	it("returns empty status for empty input", () => {
		const result = parseGitStatusPorcelain("", 0);
		expect(result).toEqual(emptyGitStatus());
	});

	it("sets stashed count", () => {
		const result = parseGitStatusPorcelain("", 3);
		expect(result.stashed).toBe(3);
	});

	it("parses branch name from branch.head", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.branch).toBe("main");
		expect(result.commit).toBeDefined();
		expect(result.commit!.oid).toBe("abc123");
		expect(result.commit!.detached).toBe(false);
	});

	it("detects detached HEAD", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head (detached)",
			"# branch.ab +0 -0",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.branch).toBeUndefined();
		expect(result.commit!.detached).toBe(true);
	});

	it("parses ahead/behind counts", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +3 -2",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.ahead).toBe(3);
		expect(result.behind).toBe(2);
	});

	it("handles missing ahead/behind gracefully", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.ahead).toBe(0);
		expect(result.behind).toBe(0);
	});

	it("counts untracked files (?)", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
			"? newfile.txt",
			"? another.txt",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.untracked).toBe(2);
		expect(result.dirty).toBe(true);
	});

	it("counts conflicted files (u)", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
			"u AA conflict.txt",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.conflicted).toBe(1);
	});

	it("parses 1-format porcelain entries", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
			"1 M. staged-modified.txt",
			"1 .M unstaged-modified.txt",
			"1 D. deleted.txt",
			"1 R. renamed.txt",
			"1 T. typechanged.txt",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.staged).toBe(1);    // M in index
		expect(result.modified).toBe(1);  // M in worktree
		expect(result.deleted).toBe(1);   // D in index
		expect(result.renamed).toBe(1);   // R in index
		expect(result.typechanged).toBe(1); // T in index
		expect(result.dirty).toBe(true);
	});

	it("parses 2-format porcelain entries (renames)", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
			"2 R. old.txt new.txt",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.renamed).toBe(1);
	});

	it("handles modified in both index and worktree (MM)", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
			"1 MM double-modified.txt",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.staged).toBe(1);
		expect(result.modified).toBe(1);
	});

	it("detects dirty when any file change exists", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
			"1 M. file.txt",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.dirty).toBe(true);
	});

	it("clean repo when no file entries", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.dirty).toBe(false);
	});

	it("skips initial oid", () => {
		const output = [
			"# branch.oid (initial)",
			"# branch.head main",
			"# branch.ab +0 -0",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.commit).toBeDefined();
		expect(result.commit!.oid).toBeNull();
	});

	it("empty branch.head — no commit info populated", () => {
		const output = "? untracked.txt";
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.commit).toBeUndefined();
	});

	it("ignores comment lines other than branch.*", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +1 -0",
			"# some.other.key value",
		].join("\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.branch).toBe("main");
		// Should not throw, just ignore
	});

	it("handles CRLF line endings", () => {
		const output = [
			"# branch.oid abc123",
			"# branch.head main",
			"# branch.ab +0 -0",
			"? file1.txt",
		].join("\r\n");
		const result = parseGitStatusPorcelain(output, 0);
		expect(result.untracked).toBe(1);
	});
});

// ===========================================================================
// parseGitNumstat
// ===========================================================================

describe("parseGitNumstat", () => {
	it("returns zeros for empty input", () => {
		expect(parseGitNumstat("")).toEqual({ added: 0, deleted: 0 });
	});

	it("parses a single file change", () => {
		const result = parseGitNumstat("10\t5\tfile.txt");
		expect(result).toEqual({ added: 10, deleted: 5 });
	});

	it("aggregates across multiple files", () => {
		const output = [
			"10\t5\tfile1.txt",
			"20\t3\tfile2.txt",
			"0\t7\tfile3.txt",
		].join("\n");
		const result = parseGitNumstat(output);
		expect(result).toEqual({ added: 30, deleted: 15 });
	});

	it("skips binary files (-/-)", () => {
		const output = [
			"10\t5\ttext.txt",
			"-\t-\tbinary.bin",
			"3\t2\tmore.txt",
		].join("\n");
		const result = parseGitNumstat(output);
		expect(result).toEqual({ added: 13, deleted: 7 });
	});

	it("skips lines with too few fields", () => {
		const output = [
			"10\t5\tfile.txt",
			"just one field",
			"",
			"a\tb",
		].join("\n");
		const result = parseGitNumstat(output);
		expect(result).toEqual({ added: 10, deleted: 5 });
	});

	it("skips renamed lines (4 fields)", () => {
		// renamed files have 4 tab-delimited fields: added, deleted, old, new
		const output = "5\t3\told.txt\tnew.txt";
		const result = parseGitNumstat(output);
		expect(result).toEqual({ added: 5, deleted: 3 });
	});

	it("skips non-finite numbers", () => {
		const output = [
			"10\t5\tfile.txt",
			"NaN\tNaN\tbad.txt",
			"Infinity\t0\tbad2.txt",
		].join("\n");
		const result = parseGitNumstat(output);
		expect(result).toEqual({ added: 10, deleted: 5 });
	});

	it("skips negative numbers", () => {
		const output = [
			"10\t5\tfile.txt",
			"-3\t2\tnegative.txt",
		].join("\n");
		const result = parseGitNumstat(output);
		expect(result).toEqual({ added: 10, deleted: 5 });
	});

	it("handles CRLF line endings", () => {
		const result = parseGitNumstat("3\t1\ta.txt\r\n5\t2\tb.txt");
		expect(result).toEqual({ added: 8, deleted: 3 });
	});
});

// ===========================================================================
// detectGitState
// ===========================================================================

describe("detectGitState", () => {
	it("returns empty when no paths are set", () => {
		expect(detectGitState({})).toEqual({});
	});

	it("returns empty when paths are all undefined", () => {
		expect(
			detectGitState({
				rebaseMerge: undefined,
				mergeHead: undefined,
				cherryPickHead: undefined,
				revertHead: undefined,
				bisectLog: undefined,
			}),
		).toEqual({});
	});

	it("detects REBASING from rebase-merge path", () => {
		const result = detectGitState({
			rebaseMerge: "/path/to/rebase-merge",
		});
		expect(result.gitState).toBe("REBASING");
		expect(result.gitStateLabel).toBe("REBASING");
	});

	it("detects REBASING from rebase-apply path", () => {
		const result = detectGitState({
			rebaseApply: "/path/to/rebase-apply",
		});
		expect(result.gitState).toBe("REBASING");
		expect(result.gitStateLabel).toBe("REBASING");
	});

	it("detects MERGING from MERGE_HEAD path", () => {
		const result = detectGitState({
			mergeHead: "/path/to/MERGE_HEAD",
		});
		expect(result.gitState).toBe("MERGING");
		expect(result.gitStateLabel).toBe("MERGING");
	});

	it("detects CHERRY-PICKING from CHERRY_PICK_HEAD path", () => {
		const result = detectGitState({
			cherryPickHead: "/path/to/CHERRY_PICK_HEAD",
		});
		expect(result.gitState).toBe("CHERRY-PICKING");
		expect(result.gitStateLabel).toBe("CHERRY-PICKING");
	});

	it("detects REVERTING from REVERT_HEAD path", () => {
		const result = detectGitState({
			revertHead: "/path/to/REVERT_HEAD",
		});
		expect(result.gitState).toBe("REVERTING");
		expect(result.gitStateLabel).toBe("REVERTING");
	});

	it("detects BISECTING from BISECT_LOG path", () => {
		const result = detectGitState({
			bisectLog: "/path/to/BISECT_LOG",
		});
		expect(result.gitState).toBe("BISECTING");
		expect(result.gitStateLabel).toBe("BISECTING");
	});

	it("REBASING takes priority over other states", () => {
		const result = detectGitState({
			rebaseMerge: "/path/to/rebase-merge",
			mergeHead: "/path/to/MERGE_HEAD",
			bisectLog: "/path/to/BISECT_LOG",
		});
		expect(result.gitState).toBe("REBASING");
	});

	it("MERGING takes priority over CHERRY-PICKING, REVERTING, BISECTING", () => {
		const result = detectGitState({
			mergeHead: "/path/to/MERGE_HEAD",
			cherryPickHead: "/path/to/CHERRY_PICK_HEAD",
			bisectLog: "/path/to/BISECT_LOG",
		});
		expect(result.gitState).toBe("MERGING");
	});

	it("CHERRY-PICKING takes priority over REVERTING and BISECTING", () => {
		const result = detectGitState({
			cherryPickHead: "/path/to/CHERRY_PICK_HEAD",
			revertHead: "/path/to/REVERT_HEAD",
		});
		expect(result.gitState).toBe("CHERRY-PICKING");
	});

	it("REVERTING takes priority over BISECTING", () => {
		const result = detectGitState({
			revertHead: "/path/to/REVERT_HEAD",
			bisectLog: "/path/to/BISECT_LOG",
		});
		expect(result.gitState).toBe("REVERTING");
	});
});
