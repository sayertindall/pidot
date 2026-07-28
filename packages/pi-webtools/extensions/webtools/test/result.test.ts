import { expect, test } from "vitest";
import { err, ok } from "../result.ts";

test("ok and err preserve typed result tags", () => {
	const success = ok("value");
	expect(success._tag).toBe("ok");

	const failure = err({ _tag: "ExampleFailure" as const });
	expect(failure._tag).toBe("err");
});
