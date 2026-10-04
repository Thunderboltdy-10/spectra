import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ALL_CAPABILITIES } from "../capabilities";
import { APP_COMMANDS } from "../commands/app-registry";
import {
  COMMAND_AREAS,
  COMMAND_CATALOG,
  SERVER_PLUMBING,
  aiAuthorityForApp,
  artifactCapabilityReach,
  catalogCommandForApp,
  serverFunctionCoverage,
} from "../commands/ai-reach";
import { AUTHORED_TYPES } from "../ai/harness/authoring";
import { COMMAND_TABS } from "../commands/registry";

/*
 * Parity: a user-facing action with no AI path and no written reason fails
 * here. Three surfaces are checked: the app commands behind buttons, menus
 * and the command bar; the editor commands (artifact capabilities); and every
 * public Convex mutation and action.
 */

const CONVEX_DIR = join(process.cwd(), "convex");

function publicConvexWrites() {
  const names: string[] = [];
  for (const file of readdirSync(CONVEX_DIR)) {
    if (!file.endsWith(".ts") || file.endsWith(".test.ts") || file.endsWith(".d.ts")) continue;
    const moduleName = file.slice(0, -3);
    const source = readFileSync(join(CONVEX_DIR, file), "utf8");
    for (const match of source.matchAll(/^export const (\w+) = (?:mutation|action)\b/gm)) names.push(`${moduleName}:${match[1]}`);
  }
  return names;
}

describe("command parity", () => {
  it("registers every action once, with a reason wherever the AI has no path", () => {
    const ids = COMMAND_CATALOG.map((command) => command.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const command of COMMAND_CATALOG) {
      expect(COMMAND_AREAS).toContain(command.area);
      expect(command.id.startsWith(`${command.area}.`)).toBe(true);
      expect(command.description.length).toBeGreaterThan(15);
      if (command.reach.kind === "user") expect(command.reach.reason.length).toBeGreaterThan(20);
    }
  });

  it("gives every app command (buttons, menus, the command bar) exactly one catalog entry", () => {
    const unregistered: string[] = [];
    for (const command of APP_COMMANDS) {
      const owners = COMMAND_CATALOG.filter((entry) => entry.ui?.includes(command.id as `app.${string}`));
      if (owners.length !== 1) unregistered.push(`${command.id} (${owners.length} entries)`);
    }
    expect(unregistered).toEqual([]);
    const appIds = new Set(APP_COMMANDS.map((command) => command.id));
    const dangling = COMMAND_CATALOG.flatMap((entry) => entry.ui ?? []).filter((id) => !appIds.has(id));
    expect(dangling).toEqual([]);
  });

  it("shows the bar the catalog's AI authority and reason", () => {
    for (const command of APP_COMMANDS) {
      const authority = aiAuthorityForApp(command.id);
      expect(command.aiAuthority).toBe(authority.aiAuthority);
      if (authority.aiAuthority === "prohibited") expect(command.prohibitionReason).toBe(authority.prohibitionReason);
    }
  });

  it("never lets the AI change its own permissions, credentials or account", () => {
    for (const id of ["app.security.authority-mode", "app.bridge.policy.change", "app.security.credentials", "app.security.delete-account", "app.bridge.pair"]) {
      const entry = catalogCommandForApp(id);
      expect(entry?.reach.kind, id).toBe("user");
    }
    expect(COMMAND_CATALOG.filter((entry) => entry.area === "permissions").every((entry) => entry.reach.kind === "user")).toBe(true);
  });

  it("covers every public Convex mutation and action with a command or a written reason", () => {
    const writes = publicConvexWrites();
    expect(writes.length).toBeGreaterThan(250);
    const uncovered = writes.filter((name) => !serverFunctionCoverage(name));
    expect(uncovered, "Add these to COMMAND_CATALOG (server) or SERVER_PLUMBING with a reason").toEqual([]);
    for (const reason of Object.values(SERVER_PLUMBING)) expect(reason.length).toBeGreaterThan(8);
  });

  it("names only Convex functions that exist", () => {
    const writes = new Set(publicConvexWrites());
    const modules = new Set([...writes].map((name) => name.split(":")[0]));
    const named = [...COMMAND_CATALOG.flatMap((entry) => entry.server ?? []), ...Object.keys(SERVER_PLUMBING)];
    const missing = named.filter((name) => (name.endsWith(":*") ? !modules.has(name.slice(0, -2)) : !writes.has(name)));
    expect(missing).toEqual([]);
  });

  it("reaches every editor command through edit_artifact or says why only the user can", () => {
    const counts = { edit: 0, user: 0 };
    for (const capability of ALL_CAPABILITIES) {
      if (capability.id.startsWith("app.")) continue;
      const reach = artifactCapabilityReach(capability.id);
      if (reach.kind === "tool") {
        expect(reach.tool).toBe("edit_artifact");
        counts.edit += 1;
      } else {
        expect(reach.reason.length).toBeGreaterThan(20);
        counts.user += 1;
      }
    }
    expect(counts.edit).toBeGreaterThan(counts.user);
    // Content edits are not mistaken for view-only commands.
    for (const id of ["document.navigate.replace", "presentation.image.fit", "code.format", "document.table.merge", "presentation.insert.shape"])
      expect(artifactCapabilityReach(id).kind, id).toBe("tool");
    for (const id of ["sheets.view.zoom.in", "document.export.print", "quiz.attempt.submit", "whiteboard.tool.hand", "presentation.history.undo", "sheets.protect.sheet"])
      expect(artifactCapabilityReach(id).kind, id).toBe("user");
  });

  it("can create and edit every work type", () => {
    expect([...AUTHORED_TYPES].sort()).toEqual(Object.keys(COMMAND_TABS).sort());
    expect(COMMAND_CATALOG.find((entry) => entry.id === "work.create")?.reach).toMatchObject({ tool: "create_artifact" });
    expect(COMMAND_CATALOG.find((entry) => entry.id === "work.edit")?.reach).toMatchObject({ tool: "edit_artifact" });
  });
});
