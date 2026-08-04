import * as THREE from "three";

/**
 * Optical anchors for the landing prism: where wavelengths make contact with
 * the glass, their colours, and where the coherent output exits. Prism-local
 * coordinates; the effects layer and the prism's shader uniforms both read
 * from here so surface events and interior volume always agree.
 */
export const CONTACT_ANCHORS_LOCAL: THREE.Vector3[] = [
  new THREE.Vector3(-0.52, 0.3, 0.44),
  new THREE.Vector3(0.5, 0.3, 0.44),
  new THREE.Vector3(-0.62, 0.12, -0.44),
  new THREE.Vector3(0.6, 0.02, -0.44),
  new THREE.Vector3(-0.08, -0.62, 0.42),
  new THREE.Vector3(0.16, -0.6, -0.42),
];

/** Wavelength colours, index-matched to the anchors above. */
export const ENTRY_COLORS = [
  new THREE.Color("#ff5f7e"),
  new THREE.Color("#ffa63f"),
  new THREE.Color("#ffe066"),
  new THREE.Color("#48dfa8"),
  new THREE.Color("#4fa8ff"),
  new THREE.Color("#9a7cff"),
];

export const OUTPUT_ANCHOR_LOCAL = new THREE.Vector3(0.02, -0.66, 0.06);
