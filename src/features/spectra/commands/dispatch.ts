import { capabilityForLocalId } from "../capabilities";
import type { WorkType } from "../work/registry";
import {
  commandContext,
  commandForBinding,
  executeCommand,
} from "./registry";
import type { CommandBinding, CommandContext, CommandParam } from "./types";

/**
 * One execute path for every studio input: workbar, keyboard, context menu,
 * inspector chrome, and the field format bar. Availability is decided by the
 * same function the person reads on the control (C1 / C2).
 */
export function dispatchStudioCommand(input: {
  type: WorkType;
  id: string;
  bindings: readonly CommandBinding[];
  ctx: CommandContext;
  params?: CommandParam;
}): boolean {
  const localId = input.id.startsWith(`${input.type}.`)
    ? input.id.slice(input.type.length + 1)
    : input.id;
  const index = input.bindings.findIndex(
    (binding) =>
      binding.id === localId ||
      binding.id === input.id ||
      binding.capabilityId === input.id ||
      binding.capabilityId === `${input.type}.${localId}`,
  );
  if (index < 0) return false;
  return executeCommand(
    commandForBinding(input.type, input.bindings[index]!, index),
    input.ctx,
    input.params,
  );
}

export function commandContextFromContract(
  type: WorkType,
  contract: Pick<
    CommandContext,
    "can" | "permissions" | "compatibilityProfile" | "fidelity" | "executeApplicationCommand"
  > & { role?: CommandContext["permissions"]["role"]; artifactId?: string },
  selectionKind?: string,
): CommandContext {
  return commandContext(
    type,
    contract.can,
    contract.role ?? contract.permissions.role,
    selectionKind,
    {
      compatibilityProfile: contract.compatibilityProfile,
      fidelity: contract.fidelity,
      ...(contract.artifactId ? { artifactId: contract.artifactId } : {}),
    },
    contract.executeApplicationCommand,
  );
}

/**
 * Split view mounts one workbar per artifact. A global keydown without a
 * studio check fires every listener (CMD-1). When two or more studios are
 * marked, only the focused one handles the shortcut.
 */
export function eventBelongsToFocusedStudio(
  event: KeyboardEvent,
  artifactId: string,
): boolean {
  if (typeof document === "undefined") return true;
  const studios = document.querySelectorAll("[data-spectra-studio]");
  if (studios.length === 0) return true;
  if (studios.length === 1) {
    return studios[0]!.getAttribute("data-spectra-studio") === artifactId;
  }
  const active =
    document.activeElement instanceof Element ? document.activeElement : null;
  const focused = active?.closest("[data-spectra-studio]");
  if (focused) {
    return focused.getAttribute("data-spectra-studio") === artifactId;
  }
  const target = event.target instanceof Element ? event.target : null;
  const fromEvent = target?.closest("[data-spectra-studio]");
  return fromEvent?.getAttribute("data-spectra-studio") === artifactId;
}

export function shortcutMatchesEvent(
  event: KeyboardEvent,
  shortcut: string | undefined,
): boolean {
  if (!shortcut) return false;
  const value = shortcut.toLowerCase();
  const needsModifier = value.includes("mod+");
  const needsShift = value.includes("shift+");
  const needsAlt = value.includes("alt+");
  const modified = event.metaKey || event.ctrlKey || event.altKey;
  // A shortcut without a modifier belongs to whatever has focus. Firing
  // "Bold" because someone typed the letter b is the worst kind of surprise.
  if (!needsModifier && !needsAlt && !modified) return false;
  const key = value.split("+").at(-1);
  return (
    (!needsModifier || event.metaKey || event.ctrlKey) &&
    event.shiftKey === needsShift &&
    (!needsAlt || event.altKey) &&
    event.key.toLowerCase() === key
  );
}

const FORMAT_CHROME_IDS: Readonly<Record<string, string>> = {
  Bold: "format.bold",
  Italic: "format.italic",
  Underline: "format.underline",
  Strikethrough: "format.strike",
  "Bullet list": "format.bulletList",
  "Numbered list": "format.orderedList",
  Quote: "format.quote",
  "Inline code": "format.code",
  Link: "insert.link",
  "Inline equation": "insert.equation",
  "Block equation": "insert.blockEquation",
};

/**
 * Field-attached format chrome (quiz, flashcards, planner description) used to
 * mint unregistered `format-bold` ids. Resolve the IR local id and execute
 * through the same availability the workbar uses.
 */
export function dispatchFormatChrome(input: {
  type: WorkType;
  label: string;
  run: () => void;
  can: CommandContext["can"];
  role: CommandContext["permissions"]["role"];
  compatibilityProfile?: CommandContext["compatibilityProfile"];
  fidelity?: CommandContext["fidelity"];
}): boolean {
  const localId =
    FORMAT_CHROME_IDS[input.label] ??
    `format.${input.label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}`;
  const definition = capabilityForLocalId(input.type, localId);
  const ctx = commandContext(input.type, input.can, input.role, undefined, {
    compatibilityProfile: input.compatibilityProfile ?? "spectra-native",
    fidelity: input.fidelity ?? { artifact: "NATIVE" },
  });
  const binding: CommandBinding = {
    id: localId,
    label: input.label,
    onSelect: input.run,
    ...(definition
      ? {
          capabilityId: definition.id,
          availability: definition.availability,
        }
      : { requires: "edit" as const }),
  };
  return executeCommand(commandForBinding(input.type, binding, 0), ctx);
}
