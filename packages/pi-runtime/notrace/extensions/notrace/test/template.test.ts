import { describe, it, expect } from "vitest";
import { DEFAULT_TEMPLATE } from '../template.js';

describe("DEFAULT_TEMPLATE", () => {
  it("is a well-formed HTML document", () => {
    expect(DEFAULT_TEMPLATE).toContain("<!doctype html>");
    expect(DEFAULT_TEMPLATE).toContain("<html");
    expect(DEFAULT_TEMPLATE).toContain("<head>");
    expect(DEFAULT_TEMPLATE).toContain("<body>");
    expect(DEFAULT_TEMPLATE).toContain("</html>");
  });

  it("contains required placeholders", () => {
    expect(DEFAULT_TEMPLATE).toContain("{{title}}");
    expect(DEFAULT_TEMPLATE).toContain("{{subtitle}}");
    expect(DEFAULT_TEMPLATE).toContain("{{stats}}");
    expect(DEFAULT_TEMPLATE).toContain("{{sections}}");
    expect(DEFAULT_TEMPLATE).toContain("{{footer}}");
  });

  it("contains CSS styles", () => {
    expect(DEFAULT_TEMPLATE).toContain("<style>");
    expect(DEFAULT_TEMPLATE).toContain("--bg:");
    expect(DEFAULT_TEMPLATE).toContain("--accent:");
  });

  it("is a string", () => {
    expect(typeof DEFAULT_TEMPLATE).toBe("string");
  });
});
