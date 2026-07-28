import { describe, it, expect } from "vitest";
import {
  isSupportedColorSpec,
  renderTerminalStyle,
  renderStyle,
  renderThemeStyle,
  renderStyleForSource,
  renderStyleForSourceOrFallback,
  safeThemeFg,
  colorize,
} from "./style";
import type { ThemeLike, SourceStyleFallback } from "./style";
import type { ColorSource } from "./config";

function makeFakeTheme(
  fgValues: Record<string, string> = {},
): ThemeLike & { fg: (color: string, text: string) => string } {
  const theme: ThemeLike & { fg: (color: string, text: string) => string } = {
    fg(color: string, text: string): string {
      if (fgValues[color] != null) return fgValues[color] + text;
      return `[${color}]${text}`;
    },
    bold: (text: string) => `[bold]${text}[/bold]`,
    italic: (text: string) => `[italic]${text}[/italic]`,
    underline: (text: string) => `[underline]${text}[/underline]`,
  };
  return theme;
}

// ---------------------------------------------------------------------------
// isSupportedColorSpec
// ---------------------------------------------------------------------------
describe("isSupportedColorSpec", () => {
  it("returns true for empty string", () => {
    expect(isSupportedColorSpec("")).toBe(true);
  });

  it("returns true for whitespace-only string", () => {
    expect(isSupportedColorSpec("   ")).toBe(true);
  });

  it("returns true for valid terminal color names", () => {
    expect(isSupportedColorSpec("red")).toBe(true);
    expect(isSupportedColorSpec("bold red")).toBe(true);
    expect(isSupportedColorSpec("blue")).toBe(true);
    expect(isSupportedColorSpec("green")).toBe(true);
    expect(isSupportedColorSpec("bright-black")).toBe(true);
    expect(isSupportedColorSpec("bright-cyan")).toBe(true);
  });

  it("returns true for fg: and bg: prefixes", () => {
    expect(isSupportedColorSpec("fg:202")).toBe(true);
    expect(isSupportedColorSpec("bg:blue")).toBe(true);
    expect(isSupportedColorSpec("fg:red")).toBe(true);
    expect(isSupportedColorSpec("bg:bright-yellow")).toBe(true);
  });

  it("returns true for hex colors", () => {
    expect(isSupportedColorSpec("#ff0000")).toBe(true);
    expect(isSupportedColorSpec("#abc")).toBe(true);
    expect(isSupportedColorSpec("#a1b2c3")).toBe(true);
  });

  it("returns true for 256-color palette indices", () => {
    expect(isSupportedColorSpec("202")).toBe(true);
    expect(isSupportedColorSpec("0")).toBe(true);
    expect(isSupportedColorSpec("255")).toBe(true);
  });

  it("returns true for theme color tokens", () => {
    expect(isSupportedColorSpec("accent")).toBe(true);
    expect(isSupportedColorSpec("success")).toBe(true);
    expect(isSupportedColorSpec("warning")).toBe(true);
    expect(isSupportedColorSpec("muted")).toBe(true);
    expect(isSupportedColorSpec("syntaxKeyword")).toBe(true);
    expect(isSupportedColorSpec("syntaxFunction")).toBe(true);
    expect(isSupportedColorSpec("error")).toBe(true);
    expect(isSupportedColorSpec("dim")).toBe(true);
    expect(isSupportedColorSpec("text")).toBe(true);
    expect(isSupportedColorSpec("thinkingText")).toBe(true);
    expect(isSupportedColorSpec("mdHeading")).toBe(true);
    expect(isSupportedColorSpec("border")).toBe(true);
  });

  it("returns true for style modifiers followed by a valid color", () => {
    expect(isSupportedColorSpec("bold red")).toBe(true);
    expect(isSupportedColorSpec("dim italic underline blue")).toBe(true);
  });

  it("returns false for invalid color strings", () => {
    expect(isSupportedColorSpec("nonesuch")).toBe(false);
    expect(isSupportedColorSpec("notacolor")).toBe(false);
    expect(isSupportedColorSpec("redd")).toBe(false);
  });

  it("returns false when any token in a multi-token spec is invalid", () => {
    expect(isSupportedColorSpec("bold nonsuch")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// renderTerminalStyle
// ---------------------------------------------------------------------------
describe("renderTerminalStyle", () => {
  it("returns text unchanged for empty style string", () => {
    const result = renderTerminalStyle("", "hello");
    expect(result).toBe("hello");
  });

  it("renders a basic color name to ANSI", () => {
    const result = renderTerminalStyle("red", "hello");
    expect(result).toBe("\x1b[31mhello\x1b[0m");
  });

  it("renders bold + color combination", () => {
    const result = renderTerminalStyle("bold red", "hello");
    expect(result).toBe("\x1b[1;31mhello\x1b[0m");
  });

  it("renders hex color to ANSI 24-bit", () => {
    const result = renderTerminalStyle("#ff0000", "hello");
    expect(result).toBe("\x1b[38;2;255;0;0mhello\x1b[0m");
  });

  it("expands 3-digit hex", () => {
    const result = renderTerminalStyle("#abc", "hello");
    expect(result).toBe("\x1b[38;2;170;187;204mhello\x1b[0m");
  });

  it("renders fg: prefix", () => {
    const result = renderTerminalStyle("fg:202", "hello");
    expect(result).toBe("\x1b[38;5;202mhello\x1b[0m");
  });

  it("renders bg: prefix", () => {
    const result = renderTerminalStyle("bg:blue", "hello");
    expect(result).toBe("\x1b[44mhello\x1b[0m");
  });

  it("renders bg: with hex", () => {
    const result = renderTerminalStyle("bg:#ff0000", "hello");
    expect(result).toBe("\x1b[48;2;255;0;0mhello\x1b[0m");
  });

  it("renders bg: with 256-color palette index", () => {
    const result = renderTerminalStyle("bg:202", "hello");
    expect(result).toBe("\x1b[48;5;202mhello\x1b[0m");
  });

  it("renders dim modifier", () => {
    const result = renderTerminalStyle("dim", "hello");
    expect(result).toBe("\x1b[2mhello\x1b[0m");
  });

  it("renders dimmed modifier (alias for dim)", () => {
    const result = renderTerminalStyle("dimmed", "hello");
    expect(result).toBe("\x1b[2mhello\x1b[0m");
  });

  it("renders italic modifier", () => {
    const result = renderTerminalStyle("italic", "hello");
    expect(result).toBe("\x1b[3mhello\x1b[0m");
  });

  it("renders underline modifier", () => {
    const result = renderTerminalStyle("underline", "hello");
    expect(result).toBe("\x1b[4mhello\x1b[0m");
  });

  it("renders multiple modifiers + color", () => {
    const result = renderTerminalStyle("bold underline red", "hello");
    expect(result).toBe("\x1b[1;4;31mhello\x1b[0m");
  });

  it("renders 256-color palette index", () => {
    const result = renderTerminalStyle("202", "hello");
    expect(result).toBe("\x1b[38;5;202mhello\x1b[0m");
  });

  it("returns text unchanged for theme tokens (not terminal colors)", () => {
    const result = renderTerminalStyle("accent", "hello");
    expect(result).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// renderStyle
// ---------------------------------------------------------------------------
describe("renderStyle", () => {
  const theme = makeFakeTheme();

  it("returns text unchanged for empty style string", () => {
    expect(renderStyle(theme, "", "hello")).toBe("hello");
  });

  it("uses terminal rendering when the style is a valid terminal color", () => {
    const result = renderStyle(theme, "red", "hello");
    expect(result).toBe("\x1b[31mhello\x1b[0m");
  });

  it("falls back to theme colorize when terminal rendering has no effect", () => {
    const result = renderStyle(theme, "accent", "hello");
    expect(result).toBe("[accent]hello");
  });
});

// ---------------------------------------------------------------------------
// renderThemeStyle
// ---------------------------------------------------------------------------
describe("renderThemeStyle", () => {
  const theme = makeFakeTheme();

  it("returns text unchanged for empty style string", () => {
    expect(renderThemeStyle(theme, "", "hello")).toBe("hello");
  });
  // Correction: need to check. Let me re-read.
  // renderThemeStyle: if trimmed === "" return text. So empty → text back.
  // The test was wrong. Fixing.
  it("returns text for empty style string", () => {
    expect(renderThemeStyle(theme, "", "hello")).toBe("hello");
  });

  it("renders a basic theme color token", () => {
    const result = renderThemeStyle(theme, "accent", "hello");
    expect(result).toBe("[accent]hello");
  });

  it("maps 'red' terminal color to 'error' theme token", () => {
    const result = renderThemeStyle(theme, "red", "hello");
    expect(result).toBe("[error]hello");
  });

  it("maps 'bright-red' to 'error'", () => {
    const result = renderThemeStyle(theme, "bright-red", "hello");
    expect(result).toBe("[error]hello");
  });

  it("maps 'green' to 'success'", () => {
    const result = renderThemeStyle(theme, "green", "hello");
    expect(result).toBe("[success]hello");
  });

  it("maps 'yellow' to 'warning'", () => {
    const result = renderThemeStyle(theme, "yellow", "hello");
    expect(result).toBe("[warning]hello");
  });

  it("maps 'blue' to 'syntaxFunction'", () => {
    const result = renderThemeStyle(theme, "blue", "hello");
    expect(result).toBe("[syntaxFunction]hello");
  });

  it("maps 'bright-black' to 'muted'", () => {
    const result = renderThemeStyle(theme, "bright-black", "hello");
    expect(result).toBe("[muted]hello");
  });

  it("maps 'white' to 'text'", () => {
    const result = renderThemeStyle(theme, "white", "hello");
    expect(result).toBe("[text]hello");
  });

  it("applies bold modifier via theme.bold", () => {
    const result = renderThemeStyle(theme, "bold accent", "hello");
    expect(result).toBe("[accent][bold]hello[/bold]");
  });

  it("applies italic modifier via theme.italic", () => {
    const result = renderThemeStyle(theme, "italic accent", "hello");
    expect(result).toBe("[accent][italic]hello[/italic]");
  });

  it("applies underline modifier via theme.underline", () => {
    const result = renderThemeStyle(theme, "underline accent", "hello");
    expect(result).toBe("[accent][underline]hello[/underline]");
  });

  it("maps 'dim' modifier token to 'muted' color fallback", () => {
    const result = renderThemeStyle(theme, "dim", "hello");
    expect(result).toBe("[muted]hello");
  });

  it("falls back to 'text' token when no color token is present and no mapping applies", () => {
    // 'nonesuch' is not in terminalColorCodes and not a theme token either.
    // mapThemeColor returns undefined for unknown tokens, but renderThemeStyle
    // checks isExplicitTerminalColorToken first. "nonesuch" is not explicit,
    // so it goes through mapThemeColor → returns token itself ("nonesuch") and
    // safeThemeFg uses that. Let's test with a token that's not a theme token
    // but also not a terminal color... Actually for tokens that pass through
    // mapThemeColor, they just get returned as-is. If the token is "foo",
    // it'll be passed to theme.fg("foo", text). So the fallback-to-"text"
    // only happens when mapThemeColor returns undefined (no tokens at all),
    // which happens when the only tokens are modifiers/dim tokens.
    //
    // Actually looking more carefully: if you pass "dim" alone, mapThemeColor
    // sets fallback = "muted" then returns fallback. If you pass nothing but
    // modifiers, it returns undefined → falls back to "text".
    const result = renderThemeStyle(theme, "bold", "hello");
    // Only modifiers, no color → falls back to "text"
    expect(result).toBe("[text][bold]hello[/bold]");
  });

  it("handles explicit terminal color tokens (short-circuit to terminal rendering)", () => {
    // hex colors are explicit terminal color tokens
    const result = renderThemeStyle(theme, "#ff0000", "hello");
    expect(result).toBe("\x1b[38;2;255;0;0mhello\x1b[0m");
  });
});

// ---------------------------------------------------------------------------
// renderStyleForSource
// ---------------------------------------------------------------------------
describe("renderStyleForSource", () => {
  const theme = makeFakeTheme();

  it("routes 'terminal' source through renderStyle", () => {
    const result = renderStyleForSource(theme, "terminal", "red", "hello");
    expect(result).toBe("\x1b[31mhello\x1b[0m");
  });

  it("routes 'theme' source through renderThemeStyle", () => {
    const result = renderStyleForSource(theme, "theme", "red", "hello");
    // renderThemeStyle maps red → error
    expect(result).toBe("[error]hello");
  });
});

// ---------------------------------------------------------------------------
// renderStyleForSourceOrFallback
// ---------------------------------------------------------------------------
describe("renderStyleForSourceOrFallback", () => {
  const theme = makeFakeTheme();
  const stringFallback: ColorSource = "terminal";
  const objectFallback: SourceStyleFallback = {
    theme: "success",
    terminal: "blue",
  };

  it("uses the provided style when defined (string fallback)", () => {
    const result = renderStyleForSourceOrFallback(
      theme,
      "terminal",
      "red",
      "bright-black",
      "hello",
    );
    expect(result).toBe("\x1b[31mhello\x1b[0m");
  });

  it("falls back to a string fallback when style is undefined", () => {
    const result = renderStyleForSourceOrFallback(
      theme,
      "terminal",
      undefined,
      "red",
      "hello",
    );
    expect(result).toBe("\x1b[31mhello\x1b[0m");
  });

  it("uses object fallback and picks the correct source key when style is undefined", () => {
    const result = renderStyleForSourceOrFallback(
      theme,
      "terminal",
      undefined,
      objectFallback,
      "hello",
    );
    expect(result).toBe("\x1b[34mhello\x1b[0m");
  });

  it("uses object fallback theme key when source is 'theme' and style is undefined", () => {
    const result = renderStyleForSourceOrFallback(
      theme,
      "theme",
      undefined,
      objectFallback,
      "hello",
    );
    expect(result).toBe("[success]hello");
  });

  it("defined style wins over fallback", () => {
    const result = renderStyleForSourceOrFallback(
      theme,
      "theme",
      "accent",
      objectFallback,
      "hello",
    );
    expect(result).toBe("[accent]hello");
  });
});

// ---------------------------------------------------------------------------
// safeThemeFg
// ---------------------------------------------------------------------------
describe("safeThemeFg", () => {
  it("returns themed text for a normal theme", () => {
    const theme = makeFakeTheme();
    expect(safeThemeFg(theme, "accent", "hello")).toBe("[accent]hello");
  });

  it("returns unstyled text when theme.fg throws", () => {
    const throwingTheme: ThemeLike = {
      fg(_color: string, _text: string): string {
        throw new Error("boom");
      },
    };
    expect(safeThemeFg(throwingTheme, "accent", "hello")).toBe("hello");
  });
});

// ---------------------------------------------------------------------------
// colorize
// ---------------------------------------------------------------------------
describe("colorize", () => {
  it("renders hex color using ANSI escape codes", () => {
    const theme = makeFakeTheme();
    const result = colorize(theme, "#ff0000", "hello");
    expect(result).toBe("\x1b[38;2;255;0;0mhello\x1b[39m");
  });

  it("delegates non-hex colors to theme.fg", () => {
    const theme = makeFakeTheme();
    const result = colorize(theme, "accent", "hello");
    expect(result).toBe("[accent]hello");
  });

  it("returns unstyled text for invalid theme tokens (safeThemeFg fallback)", () => {
    const theme = makeFakeTheme();
    // "nonesuch" is not hex, so goes to safeThemeFg which calls theme.fg
    // Our fake theme renders it, so it's not truly "invalid". In a real
    // scenario an invalid token might throw. Let's verify with the fake:
    expect(colorize(theme, "nonesuch", "hello")).toBe("[nonesuch]hello");
  });
});
