import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultSshConfigPath, normalizeTargetArg, parseSshConfig, readSshProfiles } from "../profiles";

describe("parseSshConfig", () => {
	it("returns an empty array for empty input", () => {
		expect(parseSshConfig("")).toEqual([]);
	});

	it("parses a single Host block", () => {
		const text = `Host dev
  HostName dev.example.com
  User admin
`;
		expect(parseSshConfig(text)).toEqual([{ name: "dev", remote: "dev" }]);
	});

	it("parses multiple Host blocks and dedupes", () => {
		const text = `Host dev
Host prod
Host dev
`;
		expect(parseSshConfig(text)).toEqual([
			{ name: "dev", remote: "dev" },
			{ name: "prod", remote: "prod" },
		]);
	});

	it("handles inline comments", () => {
		const text = `Host dev # the dev box
  HostName dev.example.com
`;
		expect(parseSshConfig(text)).toEqual([{ name: "dev", remote: "dev" }]);
	});

	it("skips wildcard hosts", () => {
		const text = `Host *
Host *.example.com
Host dev
Host ?pecial
`;
		expect(parseSshConfig(text)).toEqual([{ name: "dev", remote: "dev" }]);
	});

	it("skips negated hosts", () => {
		const text = `Host dev
Host !nope
`;
		expect(parseSshConfig(text)).toEqual([{ name: "dev", remote: "dev" }]);
	});

	it("handles multiple aliases per Host line", () => {
		const text = `Host dev prod
`;
		expect(parseSshConfig(text)).toEqual([
			{ name: "dev", remote: "dev" },
			{ name: "prod", remote: "prod" },
		]);
	});

	it("ignores non-Host lines", () => {
		const text = `Host dev
  HostName dev.example.com
  User admin
Host prod
`;
		expect(parseSshConfig(text)).toHaveLength(2);
	});

	it("is case-insensitive on Host keyword", () => {
		const text = `host dev
HOST prod
`;
		expect(parseSshConfig(text)).toEqual([
			{ name: "dev", remote: "dev" },
			{ name: "prod", remote: "prod" },
		]);
	});

	it("returns profiles sorted by name", () => {
		const text = `Host zzz
Host aaa
Host mmm
`;
		const profiles = parseSshConfig(text);
		expect(profiles.map((p) => p.name)).toEqual(["aaa", "mmm", "zzz"]);
	});
});

describe("readSshProfiles", () => {
	let tmp: string;

	beforeEach(() => {
		tmp = mkdtempSync(join(tmpdir(), "pi-ssh-profiles-"));
	});

	afterEach(() => {
		rmSync(tmp, { recursive: true, force: true });
	});

	it("returns an empty array when config file does not exist", () => {
		expect(readSshProfiles(join(tmp, "missing"))).toEqual([]);
	});

	it("parses a real config file", () => {
		const configPath = join(tmp, "config");
		writeFileSync(
			configPath,
			`Host dev
  HostName dev.example.com
  User admin

Host prod
  HostName prod.example.com
`,
		);
		const profiles = readSshProfiles(configPath);
		expect(profiles).toEqual([
			{ name: "dev", remote: "dev" },
			{ name: "prod", remote: "prod" },
		]);
	});
});

describe("defaultSshConfigPath", () => {
	it("returns ~/.ssh/config for a given home", () => {
		expect(defaultSshConfigPath("/home/alice")).toBe("/home/alice/.ssh/config");
	});
});

describe("normalizeTargetArg", () => {
	const profiles = [
		{ name: "dev", remote: "dev" },
		{ name: "prod", remote: "prod.example.com" },
	];

	it("returns a matching profile unchanged", () => {
		expect(normalizeTargetArg("dev", profiles)).toEqual({ name: "dev", remote: "dev" });
	});

	it("splits host:/path into remote + cwd", () => {
		expect(normalizeTargetArg("myhost:/var/www", profiles)).toEqual({
			name: "myhost:/var/www",
			remote: "myhost",
			cwd: "/var/www",
		});
	});

	it("treats a bare unknown host as both name and remote", () => {
		expect(normalizeTargetArg("unknown", profiles)).toEqual({ name: "unknown", remote: "unknown" });
	});

	it("trims whitespace", () => {
		expect(normalizeTargetArg("  dev  ", profiles)).toEqual({ name: "dev", remote: "dev" });
	});

	it("does not split on a colon-less bare name with a slash path", () => {
		// No colon, so no cwd. Remote is the whole string.
		expect(normalizeTargetArg("myhost/var", profiles)).toEqual({ name: "myhost/var", remote: "myhost/var" });
	});
});
