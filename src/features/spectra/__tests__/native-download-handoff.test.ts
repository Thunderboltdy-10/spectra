// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { downloadDocumentBlob } from "../components/artifact-studio-file-utils";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("keeps an Office blob available until after the browser download handoff", () => {
  vi.useFakeTimers();
  const revoke = vi.fn();
  const create = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:office-copy");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(revoke);
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    expect(this.isConnected).toBe(true);
    expect(this.href).toBe("blob:office-copy");
    expect(this.download).toBe("Physics IA.docx");
    expect(revoke).not.toHaveBeenCalled();
  });

  downloadDocumentBlob("Physics IA.docx", new Blob(["package bytes"]));
  expect(create).toHaveBeenCalledOnce();
  expect(click).toHaveBeenCalledOnce();
  expect(document.querySelector('a[href="blob:office-copy"]')).toBeNull();
  vi.advanceTimersByTime(59_999);
  expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:office-copy");
});
