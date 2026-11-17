// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ImageViewerHost, isImageHref } from "../image-viewer-host";

describe("ImageViewerHost", () => {
  it("opens a marked picture in Spectra instead of a new tab", () => {
    render(
      <>
        <ImageViewerHost />
        <a href="https://example.com/cat.png" target="_blank" data-view-image="https://example.com/cat.png">cat</a>
      </>,
    );
    fireEvent.click(screen.getByText("cat"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("cat.png")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Expand" })).toBeTruthy();
  });

  it("knows a picture link from a page link", () => {
    expect(isImageHref("https://example.com/a/photo.JPG?x=1")).toBe(true);
    expect(isImageHref("https://example.com/article")).toBe(false);
  });
});
