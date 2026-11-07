"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from "react";
import { createPortal } from "react-dom";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { formatBarClicks } from "../editor/format-menu";
import type { GlyphIcon } from "@/components/icons/glyph-icons";

export type StudioMenuItem = {
  key: string;
  label: string;
  icon?: GlyphIcon;
  /** Shown right-aligned: a shortcut, usually. */
  hint?: string;
  disabled?: boolean;
  danger?: boolean;
  onSelect: () => void;
};

export type StudioMenuGroup = readonly StudioMenuItem[];

/** What was right-clicked. The selection is read before the menu takes focus. */
export type StudioMenuContext = {
  target: Element;
  x: number;
  y: number;
  selection: string;
};

export type StudioMenuProvider = (context: StudioMenuContext) => readonly StudioMenuGroup[] | null | undefined;

type ProviderRef = MutableRefObject<StudioMenuProvider>;

const StudioMenuRegistry = createContext<{ add: (provider: ProviderRef) => () => void } | null>(null);

/** The latest of a value, for a menu item that runs after the render that built it. */
export function useLatest<T>(value: T): MutableRefObject<T> {
  const ref = useRef(value);
  useLayoutEffect(() => {
    ref.current = value;
  });
  return ref;
}

/**
 * A work's own entries for the menu at the place right-clicked. Entries from
 * the innermost part come first; the studio's common ones always come last.
 */
export function useStudioContextItems(provider: StudioMenuProvider): void {
  const registry = useContext(StudioMenuRegistry);
  const latest = useLatest(provider);
  useEffect(() => registry?.add(latest), [latest, registry]);
}

const NOT_OURS = 'input, textarea, select, .studio-pane, [role="menu"], [role="dialog"], [role="listbox"]';

/** The studio's right-click: `common` closes every menu, whatever else the place offers. */
export function useStudioContextMenu(common: StudioMenuProvider) {
  const providers = useRef(new Set<ProviderRef>());
  const latestCommon = useLatest(common);
  const pending = useRef<(() => void) | null>(null);
  const restore = useRef<(() => void) | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; groups: readonly StudioMenuGroup[] } | null>(null);

  const registry = useMemo(
    () => ({
      add: (provider: ProviderRef) => {
        providers.current.add(provider);
        return () => {
          providers.current.delete(provider);
        };
      },
    }),
    [],
  );

  const onContextMenu = useCallback(
    (event: ReactMouseEvent) => {
      // A native menu held back on purpose (Shift), and places that keep their own.
      if ((event.defaultPrevented && !formatBarClicks.has(event.nativeEvent)) || event.shiftKey) return;
      if (!(event.target instanceof Element) || event.target.closest(NOT_OURS)) return;
      const domSelection = window.getSelection();
      const context: StudioMenuContext = {
        target: event.target,
        x: event.clientX,
        y: event.clientY,
        selection: domSelection?.toString().trim() ?? "",
      };
      const groups: StudioMenuGroup[] = [];
      for (const provider of providers.current) groups.push(...(provider.current(context) ?? []));
      groups.push(...(latestCommon.current(context) ?? []));
      const visible = groups.filter((group) => group.length > 0);
      if (!visible.length) return;
      event.preventDefault();
      // The menu takes focus; a verb on the text has to find it where it was.
      const focused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const range = domSelection?.rangeCount ? domSelection.getRangeAt(0).cloneRange() : null;
      restore.current = () => {
        focused?.focus({ preventScroll: true });
        if (range && focused?.contains(range.commonAncestorContainer)) {
          const now = window.getSelection();
          now?.removeAllRanges();
          now?.addRange(range);
        }
      };
      setMenu({ x: event.clientX, y: event.clientY, groups: visible });
    },
    [latestCommon],
  );

  const element = menu
    ? createPortal(
        <DropdownMenu modal={false} open onOpenChange={(open) => !open && setMenu(null)}>
          <DropdownMenuTrigger asChild>
            <span aria-hidden style={{ position: "fixed", left: menu.x, top: menu.y, width: 0, height: 0 }} />
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            side="bottom"
            sideOffset={2}
            className="w-[232px]"
            layer="composer-dock"
            data-studio-context-menu=""
            onCloseAutoFocus={(event) => {
              event.preventDefault();
              const run = pending.current;
              pending.current = null;
              if (!run) return;
              restore.current?.();
              run();
            }}
          >
            {menu.groups.map((group, index) => (
              <div key={group[0]?.key ?? index} role="none">
                {index > 0 ? <DropdownMenuSeparator /> : null}
                {group.map((item) => {
                  const ItemIcon = item.icon;
                  return (
                    <DropdownMenuItem
                      key={item.key}
                      disabled={item.disabled}
                      className={cn(item.danger && "text-[var(--danger,var(--status-error))]")}
                      onSelect={() => {
                        pending.current = item.onSelect;
                      }}
                    >
                      <span className="grid size-4 shrink-0 place-items-center text-[var(--text-secondary)]">
                        {ItemIcon ? <ItemIcon className="size-3.5" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {item.hint ? <span className="shrink-0 text-micro text-[var(--text-secondary)]">{item.hint}</span> : null}
                    </DropdownMenuItem>
                  );
                })}
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>,
        // The panel moves on a transform, which would carry a fixed anchor with it.
        document.body,
      )
    : null;

  return { onContextMenu, element, registry };
}

export { StudioMenuRegistry };

/** Runs the browser's own verb on the place the menu came from, and says if it could. */
export function editorVerb(verb: "cut" | "copy"): boolean {
  try {
    return document.execCommand(verb);
  } catch {
    return false;
  }
}

/** Paste as text at the caret: through the editor when there is one, so its model stays in step. */
export async function pasteAtCaret(place?: Element | null): Promise<boolean> {
  try {
    const text = await navigator.clipboard.readText();
    if (!text) return false;
    const view = (place as (Element & { editor?: { view?: { pasteText?: (text: string) => boolean } } }) | null | undefined)?.editor?.view;
    if (view?.pasteText) return view.pasteText(text);
    return document.execCommand("insertText", false, text);
  } catch {
    return false;
  }
}
