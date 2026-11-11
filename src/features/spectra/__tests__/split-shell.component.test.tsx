// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { StudioSplitShell, useArtifactStudioState } from "../components/artifact-studio-shell";
import { useSpectraContextStore } from "@/stores/spectra-context-store";
import type { SpectraArtifact } from "../data/api";
beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.spyOn(window,"requestAnimationFrame").mockImplementation(callback => { callback(0); return 1; });
  vi.spyOn(window,"cancelAnimationFrame").mockImplementation(() => {});
  vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockImplementation(function(this:HTMLElement) {
    return this.matches(".spectra-global-stage, [data-split-host]") ? 1000 : 420;
  });
  vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLElement) {
    return {left:this.matches(".spectra-global-stage, [data-split-host]") ? 0 : 580,right:1000,width:this.clientWidth,top:0,bottom:720,height:720,x:0,y:0,toJSON:()=>({})};
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("leaves the studio when closing a side work without activating a retained tab", () => {
  useSpectraContextStore.setState({ openObjects: [], activeOpenObjectKey: null, dirtyArtifactIds: [] });
  const works: SpectraArtifact[] = ["tab", "side"].map((_id) => ({
    _id, blueprintKey: "document", title: _id, tags: [], status: "active", createdAt: 1, updatedAt: 1,
  }));
  const { result } = renderHook(() => useArtifactStudioState("test", works));
  act(() => result.current.openTab(works[0]!));
  act(() => result.current.openSplit(works[1]!));
  act(() => result.current.closeStudio());
  expect(result.current.mode).toBe("closed");
  expect(result.current.tabs.map((tab) => tab.artifactId)).toEqual(["tab"]);
  act(() => result.current.openTab(works[1]!));
  act(() => result.current.closeTab("side"));
  expect(result.current.activeArtifactId).toBe("tab");
  act(() => result.current.closeStudio());
  expect(result.current.mode).toBe("closed");
  useSpectraContextStore.setState({ openObjects: [], activeOpenObjectKey: null });
});
function route(onWidthChange:(width:number)=>void, width = 420, padding = 0) {
  return <div className="spectra-global-stage" style={{paddingLeft:padding,paddingRight:padding}}><main/><div className="spectra-wave-y"><StudioSplitShell width={width} onWidthChange={onWidthChange} ariaLabel="Live chat"><p>Conversation</p></StudioSplitShell></div></div>;
}
it("fits a route panel against the canvas instead of its own wrapper", () => {
  const changed = vi.fn(); render(route(changed)); expect(changed).not.toHaveBeenCalled();
});
it("allows a route panel drag to grow within the actual canvas budget", () => {
  const changed = vi.fn(); render(route(changed)); changed.mockClear();
  fireEvent.pointerDown(screen.getByRole("button",{name:"Resize Live chat"}));
  fireEvent.pointerMove(document,{clientX:560});
  expect(changed).toHaveBeenLastCalledWith(440);
});
it("retains the workbench row's existing responsive first-fit budget", () => {
  const changed = vi.fn(); render(<div className="spectra-wave-y" data-split-host><StudioSplitShell width={700} onWidthChange={changed} ariaLabel="Work"><p>Work</p></StudioSplitShell></div>);
  expect(changed).toHaveBeenLastCalledWith(500);
});

it("keeps canvas padding out of the available panel budget", () => {
  const changed = vi.fn(); render(route(changed,600,32));
  expect(changed).toHaveBeenLastCalledWith(468);
});
it("uses the content edge when dragging beside a padded route canvas", () => {
  const changed = vi.fn(); render(route(changed,420,32)); changed.mockClear();
  fireEvent.pointerDown(screen.getByRole("button",{name:"Resize Live chat"}));
  fireEvent.pointerMove(document,{clientX:528});
  expect(changed).toHaveBeenLastCalledWith(440);
});

it("promotes a padded workbench when the content box cannot hold both minimums", () => {
  vi.spyOn(HTMLElement.prototype,"clientWidth","get").mockReturnValue(782);
  render(<div className="spectra-wave-y" data-split-host style={{paddingLeft:32,paddingRight:32}}><StudioSplitShell width={360} onWidthChange={vi.fn()} ariaLabel="Work"><p>Work</p></StudioSplitShell></div>);
  expect(screen.getByRole("complementary",{name:"Work"}).hasAttribute("data-split-overlay")).toBe(true);
});
