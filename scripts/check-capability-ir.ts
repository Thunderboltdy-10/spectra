import { ALL_CAPABILITIES } from "../src/features/spectra/capabilities/catalog";
import {
  assertCapabilityIrGate,
  connectorNativeWriteClaims,
} from "../src/features/spectra/capabilities/derivations";
import { connectorNativeWriteIssues } from "../src/features/spectra/lenses/registry";

assertCapabilityIrGate();
const connectorIssues = connectorNativeWriteIssues(
  connectorNativeWriteClaims(ALL_CAPABILITIES),
);
if (connectorIssues.length) {
  throw new Error(
    `Connector-native capability ghost gate failed:\n${connectorIssues.join("\n")}`,
  );
}
console.log("Capability IR ghost gate passed.");
