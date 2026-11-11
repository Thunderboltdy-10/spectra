/// <reference types="vite/client" />
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

// Deploy-time invariants of the Convex module graph. Each failure here is a
// production failure that the type checker cannot see:
// - a module missing from _generated/api.d.ts silently loses `api.x.y` typing;
// - a load-time import cycle can evaluate a function wrapper (orgNodeMutation,
//   internalMutation, ...) before it is initialised, which once broke module
//   loading with "internalMutation is not a function";
// - a string reference ("module:fn") to a function that does not exist, or to
//   an internal function from outside Convex, only fails when it is called.

const repoRoot = path.resolve(__dirname, "..");
const convexDir = __dirname;
const modules = import.meta.glob(["./*.ts", "!./*.test.ts", "!./schema.ts", "!./*.config.ts"]);

function entryPointModules() {
  // Mirrors the Convex bundler's entry-point rules for a flat functions dir.
  return readdirSync(convexDir)
    .filter((name) => /^[^.]+\.ts$/.test(name) && name !== "schema.ts")
    .map((name) => name.slice(0, -3))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function sourceFile(file: string, text = readFileSync(file, "utf8")) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
}

/** Relative module imports that execute at load time (type-only imports and
 * dynamic `import()` never do). */
function loadTimeImports(file: string, text?: string) {
  const imports: string[] = [];
  for (const statement of sourceFile(file, text).statements) {
    let specifier: ts.Expression | undefined;
    if (ts.isImportDeclaration(statement)) {
      const clause = statement.importClause;
      if (clause?.isTypeOnly) continue;
      const bindings = clause?.namedBindings;
      if (clause && !clause.name && bindings && ts.isNamedImports(bindings) &&
          bindings.elements.length > 0 && bindings.elements.every((element) => element.isTypeOnly)) continue;
      specifier = statement.moduleSpecifier;
    } else if (ts.isExportDeclaration(statement) && statement.moduleSpecifier && !statement.isTypeOnly) {
      specifier = statement.moduleSpecifier;
    }
    if (!specifier || !ts.isStringLiteral(specifier) || !specifier.text.startsWith("./")) continue;
    const target = specifier.text.slice(2).replace(/\.(js|ts)$/, "");
    if (!target.startsWith("_generated/")) imports.push(target);
  }
  return imports;
}

function loadTimeCycles() {
  const names = new Set(entryPointModules());
  const graph = new Map([...names].map((name) => [name,
    loadTimeImports(path.join(convexDir, `${name}.ts`)).filter((target) => names.has(target))]));
  const cycles: string[][] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];
  const visit = (name: string) => {
    state.set(name, "visiting");
    stack.push(name);
    for (const next of graph.get(name) ?? []) {
      if (state.get(next) === "visiting") cycles.push([...stack.slice(stack.indexOf(next)), next]);
      else if (!state.has(next)) visit(next);
    }
    stack.pop();
    state.set(name, "done");
  };
  for (const name of names) if (!state.has(name)) visit(name);
  return cycles.map((cycle) => cycle.join(" -> "));
}

const referenceRoots = ["src", "convex", "shared", "scripts"];
const skippedDirectories = new Set(["node_modules", "_generated", "__tests__", "test-fixtures", "fixtures", ".spectra-local"]);

function productionSources(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) {
      if (!skippedDirectories.has(name)) productionSources(file, out);
    } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.(test|spec|node)\.[a-z]+$/.test(name) &&
        !name.endsWith(".d.ts")) {
      out.push(file);
    }
  }
  return out;
}

type Reference = { file: string; line: number; module: string; name: string };

// Server helpers that take a Convex function path as their first argument.
const functionPathCallees = new Set([
  "makeFunctionReference", "convexQuery", "convexMutation", "convexAction",
  "query", "mutate", "action", "spectraQuery", "spectraMutation",
]);

function calleeName(node: ts.Node) {
  const call = node.parent;
  if (!call || !ts.isCallExpression(call) || call.arguments[0] !== node) return null;
  const callee = call.expression;
  return ts.isIdentifier(callee) ? callee.text : ts.isPropertyAccessExpression(callee) ? callee.name.text : null;
}

function stringFunctionReferences(moduleNames: Set<string>) {
  const references: Reference[] = [];
  for (const file of referenceRoots.flatMap((root) => productionSources(path.join(repoRoot, root)))) {
    const source = sourceFile(file);
    const visit = (node: ts.Node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        const match = /^([a-zA-Z][A-Za-z0-9_]*):([A-Za-z_][A-Za-z0-9_]*)$/.exec(node.text);
        // Tool concurrency domains reuse the "area:scope" shape but are lock
        // keys, not function paths.
        const lockKey = ts.isPropertyAssignment(node.parent) && node.parent.name.getText() === "concurrencyDomain";
        const pathArgument = match !== null && functionPathCallees.has(calleeName(node) ?? "");
        if (match && (moduleNames.has(match[1]) || pathArgument) && !lockKey) {
          references.push({
            file: path.relative(repoRoot, file).split(path.sep).join("/"),
            line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1,
            module: match[1],
            name: match[2],
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return references;
}

type Registered = { isQuery?: boolean; isMutation?: boolean; isAction?: boolean; isPublic?: boolean; isInternal?: boolean };

describe("Convex module graph", () => {
  it("lists every Convex module in the generated api types", () => {
    const api = readFileSync(path.join(convexDir, "_generated", "api.d.ts"), "utf8");
    const listed = [...api.matchAll(/import type \* as \w+ from "\.\.\/(.+?)\.js";/g)].map((match) => match[1]);
    // `npx convex codegen` needs a deployment; see the P2 ops report for the
    // regeneration step. Keep the list sorted the way Convex codegen sorts it.
    expect(listed).toEqual(entryPointModules());
  });

  it("has no load-time import cycles between Convex modules", () => {
    expect(loadTimeCycles()).toEqual([]);
  });

  it("defines every function with the worded-error builders in ./functions", () => {
    // Production redacts a plain Error's message; ./functions keeps the words.
    const builders = new Set(["query", "mutation", "action", "internalQuery", "internalMutation", "internalAction"]);
    const bypasses: string[] = [];
    for (const name of entryPointModules().filter((module) => module !== "functions")) {
      for (const statement of sourceFile(path.join(convexDir, `${name}.ts`)).statements) {
        if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) ||
            statement.moduleSpecifier.text.replace(/\.js$/, "") !== "./_generated/server") continue;
        const clause = statement.importClause;
        const bindings = clause?.namedBindings;
        if (clause?.isTypeOnly || !bindings || !ts.isNamedImports(bindings)) continue;
        for (const element of bindings.elements)
          if (!element.isTypeOnly && builders.has((element.propertyName ?? element.name).text))
            bypasses.push(`${name}: ${element.name.text}`);
      }
    }
    expect(bypasses).toEqual([]);
  });

  it("detects a load-time cycle but ignores type-only and dynamic imports", () => {
    const text = [
      'import type { Doc } from "./_generated/dataModel";',
      'import { internalMutation } from "./_generated/server";',
      'import type { OrgNodeCtx } from "./orgTreeShared";',
      'import { type Capability } from "./authority";',
      'import { orgNodeMutation } from "./orgNodeMutation";',
      'export { evaluateRetainedPinAccess } from "./authorityShared";',
      'export type { RetainedPinAccess } from "./retainedPinAccess";',
      'const lazy = () => import("./spectraArtifacts");',
    ].join("\n");
    expect(loadTimeImports("fixture.ts", text)).toEqual(["orgNodeMutation", "authorityShared"]);
  });

  it("resolves every string function reference to a registered function callers may reach", async () => {
    const names = entryPointModules();
    const exports = new Map<string, Record<string, unknown>>();
    for (const name of names) exports.set(name, await modules[`./${name}.ts`]() as Record<string, unknown>);
    const problems: string[] = [];
    const references = stringFunctionReferences(new Set(names));
    for (const reference of references) {
      const fn = exports.get(reference.module)?.[reference.name] as Registered | undefined;
      const where = `${reference.file}:${reference.line} ${reference.module}:${reference.name}`;
      if (!fn || !(fn.isQuery || fn.isMutation || fn.isAction)) problems.push(`${where} is not a registered function`);
      // Next routes, the gateway and workers call through ConvexHttpClient,
      // which can only reach public functions.
      else if (!reference.file.startsWith("convex/") && !fn.isPublic) problems.push(`${where} is internal`);
    }
    expect(references.length).toBeGreaterThan(300);
    expect(problems).toEqual([]);
  }, 120_000);
});
