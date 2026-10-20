"use client";

import { useMemo, type CSSProperties } from "react";
import { useQuery } from "convex/react";
import { api } from "../../../../convex/_generated/api";
import { classIdentities, classIdentity, type ClassIdentity } from "../../../../shared/class-identity";
import { useAuthedArgs } from "../data/use-authed-args";
import type { SchoolClass } from "./school-model";

/*
 * The student's classes and the identity each is drawn in (shared/class-identity.ts):
 * School keys them by ManageBac's class id; the Library and Home find a class
 * workspace by the name Spectra gave it, which is the same name.
 */

/** Every class the student has, with the identity it is drawn in. */
export function useClassBook() {
  const classes = useQuery(api.school.classes, useAuthedArgs({}));
  return useMemo(() => {
    const list = classes?.classes ?? [];
    const identities = classIdentities(list);
    const byName = new Map([...identities.values()].map((identity) => [identity.name, identity]));
    const idByName = new Map([...identities.entries()].map(([providerClassId, identity]) => [identity.name, providerClassId]));
    return {
      loading: classes === undefined,
      /** The class a workspace stands for, by the name Spectra gave the workspace. */
      named: (name: string) => byName.get(name) ?? null,
      /** ManageBac's id for the class a workspace stands for, by the same name. */
      idNamed: (name: string) => idByName.get(name) ?? null,
      classes: list as SchoolClass[],
      /** The identity of the class a task belongs to; a class Spectra does not list still gets one from its name. */
      of: (providerClassId: string | null, title: string | null): ClassIdentity | null =>
        (providerClassId && identities.get(providerClassId)) ||
        (title ? classIdentity({ providerClassId: providerClassId ?? title, title }) : null),
    };
  }, [classes]);
}

export type ClassBook = ReturnType<typeof useClassBook>;

export const inkStyle = (identity: ClassIdentity | null) => ({ "--class-ink": identity?.ink ?? "var(--text-tertiary)" }) as CSSProperties;
