import { STATUS_COLOURS } from "../life/prism";

/*
 * The colour the island lights in when something happens: a thread finished
 * or stopped, a notification arrived. The words themselves go to the toaster.
 */

export type NoticeTone = "done" | "problem" | "needs" | "info";

export const NOTICE_COLOUR = {
  done: STATUS_COLOURS.done,
  problem: STATUS_COLOURS.problem,
  needs: STATUS_COLOURS.needs,
  info: STATUS_COLOURS.info,
} as const;
