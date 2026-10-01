import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { cn } from "../utils";

const tokenCss = readFileSync("src/styles/spectra-tokens.css", "utf8");
const typeRoles = [...tokenCss.matchAll(/--text-([a-z]+): var\(--text-\1\);/g)].map(match => match[1]!);

describe("Spectra class merging", () => {
  it.each(typeRoles)("keeps the %s size independent from text colour in either order", role => {
    const size = `text-${role}`;
    const colour = "text-[var(--text-secondary)]";
    expect(cn(size, colour)).toBe(`${size} ${colour}`);
    expect(cn(colour, size)).toBe(`${colour} ${size}`);
  });

  it("lets a caller override one semantic size with another", () => {
    expect(cn("text-caption text-[var(--text-secondary)]", "text-body")).toBe("text-[var(--text-secondary)] text-body");
    expect(cn("text-sm text-caption", "text-ui")).toBe("text-ui");
    expect(cn("text-caption", "text-sm")).toBe("text-sm");
  });

  it("merges variant sizes without losing variant colours", () => {
    expect(cn("hover:text-caption hover:text-[var(--text-secondary)]", "hover:text-body")).toBe("hover:text-[var(--text-secondary)] hover:text-body");
  });

  it("retains font-size line-height overrides", () => {
    expect(cn("leading-6 text-caption/5 text-[var(--text-secondary)]", "text-body/7")).toBe("text-[var(--text-secondary)] text-body/7");
  });

  it("still replaces conflicting text colours independently of size", () => {
    expect(cn("text-caption text-[var(--text-secondary)]", "text-[var(--text-primary)]")).toBe("text-caption text-[var(--text-primary)]");
  });

  it("preserves the existing conditional and layout merging behavior", () => {
    expect(cn("px-2 font-semibold", false && "hidden", { "px-3": true, "font-normal": true })).toBe("px-3 font-normal");
  });
});
