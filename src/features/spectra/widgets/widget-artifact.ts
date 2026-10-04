import { codeFromSpec } from "../ai/harness/authoring/code";
import type { CodeContent } from "../code/model";
import { WIDGET_LIMITS, widgetFragment, widgetThemeCss } from "./widget-document";

/*
 * Saving a widget as work. A widget is live HTML, CSS and script, and the
 * only artifact type that keeps that runnable is code with the browser
 * runtime: a document, deck or whiteboard would freeze it into a picture or
 * drop the script. So a saved widget becomes a code artifact that opens on its
 * preview, and the choice and its reason are recorded on the artifact's
 * createdFrom.contextSummary.
 */

export type WidgetArtifactType = "code";

export type WidgetArtifactChoice = { type: WidgetArtifactType; runtime: "browser"; reason: string };

export function chooseWidgetArtifactType(html: string): WidgetArtifactChoice {
  const scripted = /<script\b/i.test(html) || /\son[a-z]+\s*=/i.test(html);
  return {
    type: "code",
    runtime: "browser",
    reason: scripted
      ? "Saved from a Spectra widget as code (browser runtime): only code keeps its script interactive."
      : "Saved from a Spectra widget as code (browser runtime): only code keeps its HTML and SVG exactly as drawn.",
  };
}

/** A standalone page with the Spectra theme, for the code runtime's own sandbox. */
export function widgetSourceDocument(title: string, html: string) {
  const safeTitle = title.replace(/[<>&]/g, "");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    `<title>${safeTitle}</title>`,
    `<style>${widgetThemeCss()}</style>`,
    "</head>",
    "<body>",
    widgetFragment(html),
    "</body>",
    "</html>",
    "",
  ].join("\n");
}

export type WidgetSaveArgs = {
  blueprintKey: WidgetArtifactType;
  title: string;
  summary: string;
  content: CodeContent;
  source: "chat";
  contextSummary: string;
};

/** The create call for spectraArtifacts.create; the caller adds the thread. */
export function widgetArtifactArgs(widget: { title: string; html: string }): WidgetSaveArgs {
  const title = widget.title.trim().slice(0, WIDGET_LIMITS.maxTitleChars) || "Widget";
  const choice = chooseWidgetArtifactType(widget.html);
  const content = codeFromSpec({
    files: [{ path: "index.html", source: widgetSourceDocument(title, widget.html) }],
    runtime: choice.runtime,
    entry: "index.html",
    title,
    description: "Saved from a Spectra widget.",
  });
  return {
    blueprintKey: choice.type,
    title,
    summary: `Interactive visual: ${title}`,
    content: { ...content, visualisation: { ...content.visualisation, enabled: true, openMode: "preview" } },
    source: "chat",
    contextSummary: choice.reason,
  };
}
