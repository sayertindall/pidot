/**
 * pi-toolkit-clean-sessions — io
 *
 * Low-level I/O helpers: streaming line reader and line counter.
 * Never reads an entire file into memory.
 */

import { createReadStream, type ReadStream } from "node:fs";
import readline from "node:readline";

/**
 * Create a readline interface for a JSONL file.
 * Returns both the reader and the underlying stream so the caller
 * can close/destroy both when done.
 */
export function createLineReader(filePath: string): {
	reader: readline.Interface;
	stream: ReadStream;
} {
	const stream = createReadStream(filePath, { encoding: "utf8" });
	const reader = readline.createInterface({ input: stream, crlfDelay: Infinity });
	return { reader, stream };
}

/**
 * Count the number of lines in a file by streaming through it.
 * Never reads the whole file into memory.
 */
export async function countLines(filePath: string): Promise<number> {
	const { reader, stream } = createLineReader(filePath);

	try {
		let count = 0;
		for await (const _line of reader) {
			count++;
		}
		return count;
	} finally {
		reader.close();
		stream.destroy();
	}
}
