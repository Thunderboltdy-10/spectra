import { createContext, useContext } from "react";

/** Inside a showcase, works are edited on the page alone: no room, no token,
 * nothing written to this device. */
export const LocalOnlyCollaboration = createContext(false);

export function useLocalOnlyCollaboration() {
  return useContext(LocalOnlyCollaboration);
}
