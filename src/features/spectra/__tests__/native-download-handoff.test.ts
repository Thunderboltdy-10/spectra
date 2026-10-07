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

it("is the only place that hands a made file to the browser", async () => {
  const { readdirSync, readFileSync, statSync } = await import("node:fs");
  const { join, relative } = await import("node:path");
  const root = join(__dirname, "../../..");
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) {
        if (name !== "__tests__" && name !== "node_modules") walk(path);
      } else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) {
        const source = readFileSync(path, "utf8");
        if (source.includes("createObjectURL") && /\.download = /.test(source)) offenders.push(relative(root, path).split("\\").join("/"));
      }
    }
  };
  walk(root);
  // Revoking a blob's address as the link is clicked can cancel the download; the helper keeps it alive.
  expect(offenders).toEqual(["features/spectra/components/artifact-studio-file-utils.ts"]);
});
