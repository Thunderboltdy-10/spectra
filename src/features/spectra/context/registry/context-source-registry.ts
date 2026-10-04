import type { SemanticAnchor } from "../../anchors";

export type ContextPermission = "allowed" | "denied" | "request_required";
export type ContextSourceRegistration = {
  id: string;
  anchor: SemanticAnchor;
  label: string;
  type: string;
  workspaceId?: string;
  parentId?: string;
  permissions: ContextPermission;
  element?: () => HTMLElement | null;
};

type Listener = () => void;

export class ContextSourceRegistry {
  private entries = new Map<string, ContextSourceRegistration>();
  private listeners = new Set<Listener>();

  register(registration: ContextSourceRegistration) {
    this.entries.set(registration.id, registration);
    this.notify();
    return () => {
      if (this.entries.get(registration.id) === registration) {
        this.entries.delete(registration.id);
        this.notify();
      }
    };
  }

  listEligible() {
    return [...this.entries.values()].filter((entry) => entry.permissions === "allowed");
  }

  get(id: string) { return this.entries.get(id); }

  resolveNested(ids: readonly string[]) {
    const candidates = ids.map((id) => this.entries.get(id)).filter((entry): entry is ContextSourceRegistration => Boolean(entry) && entry!.permissions === "allowed");
    return candidates.sort((left, right) => right.anchor.path.length - left.anchor.path.length)[0] ?? null;
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify() { for (const listener of this.listeners) listener(); }
}

export const contextSourceRegistry = new ContextSourceRegistry();
