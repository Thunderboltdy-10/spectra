import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

/** Where a link in an editor may go: web pages and mail, nothing that runs. */
function openableHref(href: string | null) {
  if (!href) return null;
  const value = href.trim();
  if (/^www\./i.test(value)) return `https://${value}`;
  return /^(https?:|mailto:)/i.test(value) ? value : null;
}

/**
 * Links in an editor open as links do in Word and Docs: a click while reading,
 * Ctrl (or ⌘) and click while editing, so a plain click can still put the caret
 * in the link's words. Each opens in a new tab.
 */
export const LinkOpener = Extension.create({
  name: "spectraLinkOpener",
  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey("spectraLinkOpener"),
        props: {
          handleDOMEvents: {
            mouseover(view, event) {
              const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
              if (anchor && view.editable && !anchor.getAttribute("title"))
                anchor.setAttribute("title", `${/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl"} + click to open`);
              return false;
            },
          },
          handleClick(view, _pos, event) {
            if (event.button !== 0) return false;
            const anchor = (event.target as HTMLElement | null)?.closest?.("a[href]");
            const href = openableHref(anchor?.getAttribute("href") ?? null);
            if (!href) return false;
            if (view.editable && !(event.ctrlKey || event.metaKey)) return false;
            event.preventDefault();
            window.open(href, "_blank", "noopener,noreferrer");
            return true;
          },
        },
      }),
    ];
  },
});
