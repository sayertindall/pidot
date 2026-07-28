import { describe, expect, it } from "vitest";
import { normalizeRemoteDir, remoteRelativePath, shellQuote, toLocalEditPath, toRemotePath } from "../path-utils";

describe("shellQuote", () => {
	it("wraps a simple value in single quotes", () => {
		expect(shellQuote("hello")).toBe("'hello'");
	});

	it("escapes embedded single quotes", () => {
		expect(shellQuote("it's")).toBe("'it'\"'\"'s'");
	});

	it("handles empty string", () => {
		expect(shellQuote("")).toBe("''");
	});

	it("preserves spaces and special characters", () => {
		expect(shellQuote("a b $c")).toBe("'a b $c'");
	});
});

describe("normalizeRemoteDir", () => {
	it("removes trailing slashes", () => {
		expect(normalizeRemoteDir("/var/www/")).toBe("/var/www");
	});

	it("removes multiple trailing slashes", () => {
		expect(normalizeRemoteDir("/var/www///")).toBe("/var/www");
	});

	it("keeps root as /", () => {
		expect(normalizeRemoteDir("/")).toBe("/");
	});

	it("keeps single-char paths", () => {
		expect(normalizeRemoteDir("/a")).toBe("/a");
	});
});

describe("remoteRelativePath", () => {
	it("returns '.' for the cwd itself", () => {
		expect(remoteRelativePath("/var/www", "/var/www")).toBe(".");
	});

	it("returns the path relative to cwd", () => {
		expect(remoteRelativePath("/var/www/index.html", "/var/www")).toBe("index.html");
		expect(remoteRelativePath("/var/www/sub/file.txt", "/var/www")).toBe("sub/file.txt");
	});

	it("handles trailing slashes in cwd", () => {
		expect(remoteRelativePath("/var/www/x", "/var/www/")).toBe("x");
	});

	it("throws when the path is not under cwd", () => {
		expect(() => remoteRelativePath("/etc/passwd", "/var/www")).toThrow(/outside/);
	});
});

describe("toLocalEditPath", () => {
	it("returns a relative path unchanged", () => {
		expect(toLocalEditPath("index.html", "/var/www")).toBe("index.html");
	});

	it("makes an absolute path relative to cwd", () => {
		expect(toLocalEditPath("/var/www/index.html", "/var/www")).toBe("index.html");
	});

	it("rejects tilde paths", () => {
		expect(() => toLocalEditPath("~/foo", "/var/www")).toThrow(/~/);
	});
});

describe("toRemotePath", () => {
	it("returns the cwd for the cwd itself", () => {
		expect(toRemotePath("/home/user/project", "/home/user/project", "/var/www")).toBe("/var/www");
	});

	it("returns cwd for a path equal to cwd", () => {
		expect(toRemotePath("/home/user/project/foo.txt", "/home/user/project", "/var/www")).toBe(
			"/var/www/foo.txt",
		);
	});

	it("normalizes the cwd's trailing slash", () => {
		expect(toRemotePath("/home/user/project/foo.txt", "/home/user/project", "/var/www/")).toBe(
			"/var/www/foo.txt",
		);
	});

	it("throws when the path escapes localCwd", () => {
		expect(() => toRemotePath("/etc/passwd", "/home/user/project", "/var/www")).toThrow(/escaped/);
	});

	it("uses posix-style separators on the remote side", () => {
		expect(toRemotePath("/home/user/project/sub/deep.txt", "/home/user/project", "/var/www")).toBe(
			"/var/www/sub/deep.txt",
		);
	});
});
