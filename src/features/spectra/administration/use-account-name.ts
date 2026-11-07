"use client";

import { useEffect, useState } from "react";
import { readIdentity } from "./identity";

/** The account holder's name, for greetings; `null` until read or when it cannot be. */
export function useAccountName() {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void readIdentity()
      .then((identity) => live && setName(identity?.account.name ?? null))
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, []);
  return name;
}
