"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { heroState, damp, phases } from "../scene/heroState";
import {
  CONTACT_ANCHORS_LOCAL,
  ENTRY_COLORS,
  OUTPUT_ANCHOR_LOCAL,
} from "./anchors";

/**
 * Surface-and-exit effects for the prism (Phase 15.2 detail pass):
 *   - contact sparkles bloom exactly where each wavelength meets the glass;
 *   - the output channel glows warm as the field compresses, then releases
 *     a coherent beam below the output face;
 *   - a one-shot release flash punctuates convergence.
 *
 * Rendered INSIDE the prism's group, so every effect stays welded to the
 * real orientation — dragging the glass moves the light with it.
 */

function makeGlowTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.6)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function makeBeamTexture(): THREE.Texture {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 128;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createLinearGradient(0, 0, 0, 128);
  grad.addColorStop(0, "rgba(255,250,238,0.95)");
  grad.addColorStop(0.3, "rgba(255,246,224,0.55)");
  grad.addColorStop(1, "rgba(255,246,224,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 16, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export function PrismFx({ quality }: { quality: "high" | "medium" | "low" }) {
  const glowTex = useMemo(() => makeGlowTexture(), []);
  const beamTex = useMemo(() => makeBeamTexture(), []);

  const sparkles = useMemo(
    () =>
      CONTACT_ANCHORS_LOCAL.map((anchor, i) => ({
        anchor: anchor.clone().multiplyScalar(1.0),
        color: ENTRY_COLORS[i]!,
      })),
    [],
  );

  const spriteRefs = useRef<(THREE.Sprite | null)[]>([]);
  const beamMat = useRef<THREE.MeshBasicMaterial>(null);
  const beamGroup = useRef<THREE.Mesh>(null);
  const flashRef = useRef<THREE.Sprite>(null);
  const releasePrev = useRef(0);
  const flash = useRef(0);
  const beamPower = useRef(0);

  useFrame((state, dt) => {
    const d = Math.min(dt, 0.05);
    const t = heroState.fixedTime ?? state.clock.elapsedTime;
    const p = heroState.progress;
    const ph = phases(p);

    /* contact sparkles: follow ingestion weights with a live flicker */
    for (let i = 0; i < sparkles.length; i++) {
      const sprite = spriteRefs.current[i];
      if (!sprite) continue;
      const w = heroState.entryPower[i] ?? 0;
      const flicker = 0.84 + 0.16 * Math.sin(t * 6.4 + i * 2.17);
      const target = w * flicker;
      const cur = sprite.material.opacity;
      sprite.material.opacity = damp(cur, target * 0.92, 8, d);
      const s = 0.1 + 0.22 * target + heroState.pulse * 0.08;
      sprite.scale.setScalar(s);
    }

    /* output channel + beam: compression warms the exit, release fires it */
    const beamTarget = ph.compression * 0.34 + ph.release * 0.62;
    beamPower.current = damp(beamPower.current, beamTarget, 4.5, d);
    if (beamMat.current) {
      beamMat.current.opacity = beamPower.current;
    }
    if (beamGroup.current) {
      const breathe = 1 + Math.sin(t * 2.1) * 0.04 + heroState.pulse * 0.12;
      beamGroup.current.scale.set(
        breathe * (0.7 + beamPower.current * 0.6),
        1,
        breathe * (0.7 + beamPower.current * 0.6),
      );
    }

    /* release flash: one shot when release crosses its midpoint upward */
    const release = ph.release;
    if (release > 0.5 && releasePrev.current <= 0.5) flash.current = 1;
    releasePrev.current = release;
    flash.current = damp(flash.current, 0, 2.4, d);
    if (flashRef.current) {
      flashRef.current.material.opacity = flash.current * 0.9;
      const fs = 0.4 + flash.current * 1.7;
      flashRef.current.scale.setScalar(fs);
    }
  });

  if (quality === "low") return null;

  return (
    <>
      {/* wavelength contact points */}
      {sparkles.map(({ anchor, color }, i) => (
        <sprite
          key={i}
          ref={(node) => {
            spriteRefs.current[i] = node;
          }}
          position={anchor}
          renderOrder={4}
        >
          <spriteMaterial
            map={glowTex}
            color={color}
            transparent
            opacity={0}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}

      {/* coherent output beam below the exit face */}
      <mesh
        ref={beamGroup}
        position={[
          OUTPUT_ANCHOR_LOCAL.x,
          OUTPUT_ANCHOR_LOCAL.y - 1.05,
          OUTPUT_ANCHOR_LOCAL.z,
        ]}
        renderOrder={3}
      >
        <cylinderGeometry args={[0.055, 0.34, 2.1, 12, 1, true]} />
        <meshBasicMaterial
          ref={beamMat}
          map={beamTex}
          color="#fff5e2"
          transparent
          opacity={0}
          side={THREE.DoubleSide}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>

      {/* convergence flash at the exit point */}
      <sprite ref={flashRef} position={OUTPUT_ANCHOR_LOCAL} renderOrder={5}>
        <spriteMaterial
          map={glowTex}
          color="#fff8ea"
          transparent
          opacity={0}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </sprite>
    </>
  );
}
