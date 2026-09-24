import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";

async function fileHash(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

/** Call only within the coordinator's browser slot, after inspecting the visible export control. */
export async function captureWordDownload(page, { artifactId, expectedSavedVersion, linkedSourcePath, outputDirectory }) {
  if (!artifactId || !expectedSavedVersion || expectedSavedVersion === "unversioned") {
    throw new Error("Require the actual artifact ID and reloaded canonical saved version.");
  }
  if (!isAbsolute(linkedSourcePath ?? "") || !isAbsolute(outputDirectory ?? "")) {
    throw new Error("Require absolute disposable source and output paths.");
  }
  const directory = join(outputDirectory, `word-download-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const result = {
    status: "failed", artifactId, expectedSavedVersion, recordedAt: new Date().toISOString(),
    linkedSourcePath, sourceBefore: await fileHash(linkedSourcePath), sourceAfter: null,
    sourceUnchanged: null, downloadedPath: null, response: null, requestFailures: [],
    boundary: "Browser download only. SDK validation, installed Word readback and linked Bridge receipt are separate checks.",
  };
  const onFailed = (request) => {
    if (new URL(request.url()).pathname === "/api/spectra/lenses/docx") {
      result.requestFailures.push({ path: "/api/spectra/lenses/docx", error: request.failure()?.errorText });
    }
  };
  page.on("requestfailed", onFailed);
  const started = Date.now();
  try {
    const control = page.getByRole("button", { name: "Export Word copy", exact: true });
    if (await control.count() !== 1 || !await control.isVisible()) throw new Error("Expected one visible Export Word copy button.");
    await page.screenshot({ path: join(directory, "before.png") });
    // Observe before clicking; settle both promises so timeout evidence is retained.
    const observed = Promise.allSettled([
      page.waitForResponse((response) => {
        if (new URL(response.url()).pathname !== "/api/spectra/lenses/docx") return false;
        try {
          const input = response.request().postDataJSON();
          return input?.action === "download-copy" && input.artifactId === artifactId;
        } catch { return false; }
      }, { timeout: 45_000 }),
      page.waitForEvent("download", { timeout: 45_000 }),
    ]);
    const click = await control.click({ timeout: 10_000 }).then(() => null, (error) => String(error));
    const [responseEvent, downloadEvent] = await observed;
    if (responseEvent.status === "fulfilled") {
      const response = responseEvent.value;
      const headers = await response.allHeaders();
      result.response = {
        path: "/api/spectra/lenses/docx", status: response.status(),
        savedVersion: headers["x-spectra-saved-version"],
        contentLength: headers["content-length"], contentType: headers["content-type"],
        contentDisposition: headers["content-disposition"], cacheControl: headers["cache-control"],
      };
    } else result.responseError = String(responseEvent.reason);
    if (downloadEvent.status === "fulfilled") {
      const download = downloadEvent.value;
      result.downloadFailure = await download.failure();
      if (!result.downloadFailure) {
        result.downloadedPath = join(directory, "browser-copy.docx");
        await download.saveAs(result.downloadedPath);
        result.downloadedBytes = (await stat(result.downloadedPath)).size;
        result.downloadedSha256 = await fileHash(result.downloadedPath);
      }
    } else result.downloadError = String(downloadEvent.reason);
    if (click) throw new Error(click);
    if (!result.downloadedPath || result.response?.status !== 200) throw new Error("The actual export response and successful browser download are both required.");
    if (result.response.savedVersion !== expectedSavedVersion) throw new Error("Downloaded version differs from the reloaded canonical saved version.");
    if (Number(result.response.contentLength) !== result.downloadedBytes) throw new Error("Downloaded length differs from the export response.");
    result.status = "download-captured";
  } catch (error) {
    result.error = error instanceof Error ? error.message : String(error);
  } finally {
    page.off("requestfailed", onFailed);
    try {
      result.sourceAfter = await fileHash(linkedSourcePath);
      result.sourceUnchanged = result.sourceBefore === result.sourceAfter;
      if (!result.sourceUnchanged) { result.status = "failed"; result.error = "Linked source changed during copy export."; }
    } catch (error) { result.status = "failed"; result.sourceError = String(error); }
    result.elapsedMs = Date.now() - started;
    await page.screenshot({ path: join(directory, "after.png") }).catch((error) => { result.screenshotError = String(error); });
    await writeFile(join(directory, "capture.json"), `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}
