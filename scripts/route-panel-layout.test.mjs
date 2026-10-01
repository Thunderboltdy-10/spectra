import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

// This fixture uses the production CSS in an isolated browser, without the app
// or account data. Hosts without Chromium skip this optional layout probe.
const browser = [
  process.env.SPECTRA_LAYOUT_BROWSER,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "/usr/bin/chromium", "/usr/bin/google-chrome", "/usr/bin/chromium-browser",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find(candidate => candidate && existsSync(candidate));
const suite = browser ? describe : describe.skip;
let directory;
let widths;
const root = resolve(".spectra-local");
afterAll(() => {
  if (!directory) return;
  if (dirname(directory) !== root || !basename(directory).startsWith("LV038-layout-")) throw new Error("Unexpected layout fixture directory");
  rmSync(directory, {recursive:true,force:true,maxRetries:3,retryDelay:100});
});
suite("production split-panel layout", () => {
  beforeAll(() => {
    mkdirSync(root,{recursive:true}); directory = mkdtempSync(join(root,"LV038-layout-"));
    const css = pathToFileURL(resolve("src/styles/spectra-app.css")).href;
    const pane = (id,width,extra="") => '<aside id="'+id+'" data-studio-panel class="spectra-studio-split-panel '+extra+'" style="width:'+width+'px;flex:0 0 '+width+'px;min-width:0;contain:inline-size;height:20px"></aside>';
    const html = '<!doctype html><link rel="stylesheet" href="'+css+'"><body style="margin:0">'+
      '<div class="spectra-wave-y" style="display:flex;width:360px">'+pane("route360",360)+'</div>'+
      '<div class="spectra-wave-y" style="display:flex;width:520px">'+pane("route520",520)+'</div>'+
      '<div class="spectra-wave-y" style="display:flex;width:1000px">'+pane("routeWide",1000)+'</div>'+
      '<div class="spectra-workbench-frame" style="display:flex;width:1000px">'+pane("workbench",880)+'</div>'+
      '<div class="spectra-workbench-frame" style="display:flex;width:600px">'+pane("overlay",600,"spectra-studio-split-panel--overlay")+'</div>'+
      '<pre id="layout-result"></pre><script>document.getElementById("layout-result").textContent=JSON.stringify(Object.fromEntries(["route360","route520","routeWide","workbench","overlay"].map(id=>[id,document.getElementById(id).getBoundingClientRect().width])));</script>';
    const fixture = join(directory,"fixture.html"); writeFileSync(fixture,html);
    const output = execFileSync(browser,["--headless=new","--window-size=1280,720","--disable-gpu","--no-sandbox","--no-first-run","--disable-background-networking","--user-data-dir="+join(directory,"profile"),"--dump-dom","--virtual-time-budget=1000",pathToFileURL(fixture).href],{encoding:"utf8",windowsHide:true,timeout:30_000,maxBuffer:8*1024*1024,stdio:["ignore","pipe","pipe"]});
    const match = output.match(new RegExp('<pre id="layout-result">([^<]+)</pre>'));
    if (!match) throw new Error("Layout fixture did not report widths");
    widths = JSON.parse(match[1]);
  },35_000);
  it("keeps a route preview at its requested 360px width", () => { expect(widths.route360).toBe(360); });
  it("keeps a wider route preview at its requested 520px width", () => { expect(widths.route520).toBe(520); });
  it("retains the shared upper bound on standalone previews", () => { expect(widths.routeWide).toBe(880); });
  it("still reserves main-canvas space on the actual workbench row", () => { expect(widths.workbench).toBe(720); });
  it("lets an overlay fill its host without reserving a second canvas", () => { expect(widths.overlay).toBe(600); });
});
