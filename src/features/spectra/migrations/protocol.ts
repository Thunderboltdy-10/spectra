export const SPECTRA_PROTOCOL_VERSIONS = {
  collaboration: 1,
  runItems: 2,
  preferences: 1,
  schoolSource: 2,
} as const;

export type SpectraProtocolName = keyof typeof SPECTRA_PROTOCOL_VERSIONS;

export function supportsProtocol(
  protocol: SpectraProtocolName,
  version: number,
) {
  return version === SPECTRA_PROTOCOL_VERSIONS[protocol];
}
