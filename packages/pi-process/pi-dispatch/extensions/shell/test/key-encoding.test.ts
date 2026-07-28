import { describe, it, expect } from "vitest";
import { translateInput } from "../key-encoding";

describe("translateInput", () => {
  describe("string passthrough", () => {
    it("returns raw string input as-is", () => {
      expect(translateInput("hello world")).toBe("hello world");
    });
    it("preserves escape sequences in raw strings", () => {
      expect(translateInput("\x1b[A")).toBe("\x1b[A");
    });
  });

  describe("named keys", () => {
    it("encodes enter as carriage return", () => {
      expect(translateInput({ keys: ["enter"] })).toBe("\r");
    });
    it("encodes escape", () => {
      expect(translateInput({ keys: ["escape"] })).toBe("\x1b");
      expect(translateInput({ keys: ["esc"] })).toBe("\x1b");
    });
    it("encodes arrow keys", () => {
      expect(translateInput({ keys: ["up"] })).toBe("\x1b[A");
      expect(translateInput({ keys: ["down"] })).toBe("\x1b[B");
      expect(translateInput({ keys: ["left"] })).toBe("\x1b[D");
      expect(translateInput({ keys: ["right"] })).toBe("\x1b[C");
    });
    it("encodes tab", () => {
      expect(translateInput({ keys: ["tab"] })).toBe("\t");
    });
    it("encodes backspace as DEL (0x7f)", () => {
      expect(translateInput({ keys: ["backspace"] })).toBe("\x7f");
      expect(translateInput({ keys: ["bspace"] })).toBe("\x7f");
    });
    it("encodes function keys F1-F4 (SS3)", () => {
      expect(translateInput({ keys: ["f1"] })).toBe("\x1bOP");
      expect(translateInput({ keys: ["f4"] })).toBe("\x1bOS");
    });
    it("encodes function keys F5-F12 (CSI)", () => {
      expect(translateInput({ keys: ["f5"] })).toBe("\x1b[15~");
      expect(translateInput({ keys: ["f12"] })).toBe("\x1b[24~");
    });
    it("encodes home/end", () => {
      expect(translateInput({ keys: ["home"] })).toBe("\x1b[H");
      expect(translateInput({ keys: ["end"] })).toBe("\x1b[F");
    });
    it("encodes page up/down", () => {
      expect(translateInput({ keys: ["pageup"] })).toBe("\x1b[5~");
      expect(translateInput({ keys: ["pagedown"] })).toBe("\x1b[6~");
      expect(translateInput({ keys: ["pgup"] })).toBe("\x1b[5~");
      expect(translateInput({ keys: ["pgdn"] })).toBe("\x1b[6~");
    });
    it("encodes delete", () => {
      expect(translateInput({ keys: ["delete"] })).toBe("\x1b[3~");
      expect(translateInput({ keys: ["del"] })).toBe("\x1b[3~");
    });
    it("encodes shift-tab (back-tab)", () => {
      expect(translateInput({ keys: ["shift+tab"] })).toBe("\x1b[Z");
    });
  });

  describe("ctrl modifiers", () => {
    it("encodes ctrl+c", () => {
      expect(translateInput({ keys: ["ctrl+c"] })).toBe("\x03");
    });
    it("encodes ctrl+d", () => {
      expect(translateInput({ keys: ["ctrl+d"] })).toBe("\x04");
    });
    it("encodes ctrl+a through ctrl+z", () => {
      for (let i = 0; i < 26; i++) {
        const char = String.fromCharCode(97 + i);
        const expected = String.fromCharCode(i + 1);
        expect(translateInput({ keys: [`ctrl+${char}`] })).toBe(expected);
      }
    });
    it("encodes ctrl+[ as escape", () => {
      expect(translateInput({ keys: ["ctrl+["] })).toBe("\x1b");
    });
    it("encodes ctrl+\", ctrl+], ctrl+^, ctrl+_", () => {
      expect(translateInput({ keys: ["ctrl+\\"] })).toBe("\x1c");
      expect(translateInput({ keys: ["ctrl+]"] })).toBe("\x1d");
      expect(translateInput({ keys: ["ctrl+^"] })).toBe("\x1e");
      expect(translateInput({ keys: ["ctrl+_"] })).toBe("\x1f");
    });
    it("encodes c-x shorthand (same as ctrl+x)", () => {
      expect(translateInput({ keys: ["c-x"] })).toBe("\x18"); // ctrl+x = 0x18
    });
  });

  describe("alt modifiers", () => {
    it("encodes alt+key as ESC prefix", () => {
      expect(translateInput({ keys: ["alt+o"] })).toBe("\x1bo");
    });
    it("encodes m-x shorthand (same as alt+x)", () => {
      expect(translateInput({ keys: ["m-x"] })).toBe("\x1bx");
    });
    it("alt+named-key uses ESC prefix on base sequence", () => {
      expect(translateInput({ keys: ["alt+enter"] })).toBe("\x1b\r");
    });
  });

  describe("compound modifiers on modifiable keys", () => {
    it("ctrl+arrow uses xterm modifier encoding", () => {
      const result = translateInput({ keys: ["ctrl+up"] });
      expect(result).toBe("\x1b[1;5A");
    });
    it("shift+arrow", () => {
      expect(translateInput({ keys: ["shift+up"] })).toBe("\x1b[1;2A");
      expect(translateInput({ keys: ["shift+down"] })).toBe("\x1b[1;2B");
    });
    it("ctrl+shift+arrow", () => {
      expect(translateInput({ keys: ["ctrl+shift+tab"] })).toBe("\x1b[Z"); // shift+tab special case
      expect(translateInput({ keys: ["ctrl+shift+up"] })).toBe("\x1b[1;6A");
    });
    it("alt+arrow", () => {
      expect(translateInput({ keys: ["alt+up"] })).toBe("\x1b[1;3A");
    });
    it("ctrl+home, ctrl+end", () => {
      expect(translateInput({ keys: ["ctrl+home"] })).toBe("\x1b[1;5H");
      expect(translateInput({ keys: ["ctrl+end"] })).toBe("\x1b[1;5F");
    });
    it("ctrl+delete", () => {
      expect(translateInput({ keys: ["ctrl+delete"] })).toBe("\x1b[3;5~");
    });
  });

  describe("shift on regular chars", () => {
    it("uppercases a-z with shift modifier", () => {
      expect(translateInput({ keys: ["shift+a"] })).toBe("A");
      expect(translateInput({ keys: ["s-a"] })).toBe("A");
    });
    it("leaves non-alpha chars unchanged with shift", () => {
      expect(translateInput({ keys: ["shift+1"] })).toBe("1");
    });
  });

  describe("hex input", () => {
    it("encodes hex byte values", () => {
      expect(translateInput({ hex: ["0x1b", "0x5b", "0x41"] })).toBe("\x1b[A");
    });
    it("handles hex without 0x prefix", () => {
      expect(translateInput({ hex: ["1b", "5b", "41"] })).toBe("\x1b[A");
    });
    it("ignores invalid hex values", () => {
      expect(translateInput({ hex: ["gg", "0x1b"] })).toBe("\x1b");
    });
    it("ignores out-of-range hex values", () => {
      // 0x100 = 256 > 0xff (255), should be ignored
      expect(translateInput({ hex: ["0x100", "0x1b"] })).toBe("\x1b");
    });
  });

  describe("text input", () => {
    it("appends text as-is", () => {
      expect(translateInput({ text: "hello" })).toBe("hello");
    });
  });

  describe("paste input", () => {
    it("wraps paste in bracketed paste codes", () => {
      const result = translateInput({ paste: "multi\nline" });
      expect(result).toBe("\x1b[200~multi\nline\x1b[201~");
    });
  });

  describe("combined input", () => {
    it("combines hex + text + keys", () => {
      const result = translateInput({
        hex: ["0x1b"],
        text: "cmd",
        keys: ["enter"],
      });
      expect(result).toBe("\x1bcmd\r");
    });
  });

  describe("empty/edge cases", () => {
    it("empty keys array returns empty string", () => {
      expect(translateInput({ keys: [] })).toBe("");
    });
    it("unknown key name returns it as-is", () => {
      expect(translateInput({ keys: ["bogus"] })).toBe("bogus");
    });
    it("empty string key returns empty string", () => {
      expect(translateInput({ keys: ["  "] })).toBe("");
    });
  });

  describe("case insensitivity", () => {
    it("UPPERCASE key names work", () => {
      expect(translateInput({ keys: ["ENTER"] })).toBe("\r");
      expect(translateInput({ keys: ["CTRL+C"] })).toBe("\x03");
      expect(translateInput({ keys: ["ALT+O"] })).toBe("\x1bo");
    });
  });
});
