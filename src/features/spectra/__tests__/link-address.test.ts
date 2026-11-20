import { describe, expect, it } from "vitest";
import { linkAddress } from "../editor/link-address";

describe("a typed link address", () => {
  it("becomes a link Word can hold", () => {
    expect(linkAddress(" https://example.com/a?b=1 ")).toBe("https://example.com/a?b=1");
    expect(linkAddress("example.com/path")).toBe("https://example.com/path");
    expect(linkAddress("sub.example.co.uk:8080")).toBe("https://sub.example.co.uk:8080");
    expect(linkAddress("ana@example.com")).toBe("mailto:ana@example.com");
    expect(linkAddress("mailto:ana@example.com")).toBe("mailto:ana@example.com");
    expect(linkAddress("#_Spx0123abcd")).toBe("#_Spx0123abcd");
  });

  it("refuses what Word can't hold or a page shouldn't run", () => {
    for (const typed of ["javascript:alert(1)", "data:text/html,x", "ftp://example.com", "just words", "#", "# x", "http://", "file:///c:/x"])
      expect(linkAddress(typed)).toBeUndefined();
  });
});
