import { TypedSpectraBus } from "./bus";
import type { SpectraCommands, SpectraEvents, SpectraQueries } from "./contracts";

export const spectraBus = new TypedSpectraBus<
  SpectraCommands,
  SpectraEvents,
  SpectraQueries
>();

export * from "./bus";
export * from "./contracts";
