import { describe, expect, it } from "vitest";
import { Particles } from "./particles";
import { PRISM_PALETTES, PrismBody, prismOps, prismSvg, REST_POSE, type Quat } from "./prism";
import { sampleOutline, sampleRows } from "./shapes";
import { spectrumAt } from "./spectrum";

const TURN_Z = (k: number): Quat => [Math.cos((k * Math.PI) / 3), 0, 0, Math.sin((k * Math.PI) / 3)];

/** How close an orientation is to the rest pose, allowing for the prism's symmetries (1 is identical). */
function restLikeness(q: Quat) {
  const r = REST_POSE.orientation;
  const mul = (a: Quat, b: Quat): Quat => [
    a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3],
    a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
    a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1],
    a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0],
  ];
  const flip: Quat = [0, 0, 1, 0];
  let best = 0;
  for (let k = 0; k < 3; k += 1) {
    for (const copy of [mul(r, TURN_Z(k)), mul(mul(r, TURN_Z(k)), flip)]) {
      best = Math.max(best, Math.abs(copy[0] * q[0] + copy[1] * q[1] + copy[2] * q[2] + copy[3] * q[3]));
    }
  }
  return best;
}

function run(body: PrismBody, seconds: number) {
  for (let t = 0; t < seconds; t += 1 / 60) body.step(1 / 60);
}

describe("PrismBody", () => {
  it("is settled at rest and needs no frames", () => {
    expect(new PrismBody().isLively()).toBe(false);
  });

  it("spins on hover and settles on a symmetric copy of its rest pose", () => {
    const body = new PrismBody();
    body.hover(true);
    expect(body.isLively()).toBe(true);
    run(body, 0.3);
    expect(restLikeness(body.pose().orientation)).toBeLessThan(0.99);
    run(body, 4);
    expect(body.isLively()).toBe(false);
    expect(restLikeness(body.pose().orientation)).toBeGreaterThan(0.9999);
    expect(body.pose().scale).toBeCloseTo(1.06, 3);
  });

  it("keeps momentum after a drag and still comes to rest", () => {
    const body = new PrismBody();
    body.press();
    for (let i = 0; i < 6; i += 1) body.drag(0.12, 0.05, 1 / 60);
    body.release();
    run(body, 0.2);
    expect(body.isLively()).toBe(true);
    run(body, 6);
    expect(body.isLively()).toBe(false);
    expect(restLikeness(body.pose().orientation)).toBeGreaterThan(0.9999);
  });

  it("turns while working and settles once the work ends", () => {
    const body = new PrismBody();
    body.setMode("working");
    run(body, 2);
    expect(body.isLively()).toBe(true);
    body.setMode("rest");
    run(body, 6);
    expect(body.isLively()).toBe(false);
  });

  it("never moves in still mode, but its colour still changes", () => {
    const body = new PrismBody();
    body.still = true;
    body.hover(true);
    body.setMode("needs");
    run(body, 2);
    expect(restLikeness(body.pose().orientation)).toBeLessThan(1);
    expect(body.pose().warm).toBeGreaterThan(0.95);
  });
});

describe("prism drawing", () => {
  it("draws back faces before front faces and ends with the outline", () => {
    const ops = prismOps(REST_POSE, { x: 50, y: 50, size: 80, palette: PRISM_PALETTES.light });
    expect(ops.length).toBeGreaterThan(10);
    expect(ops.at(-1)?.kind).toBe("stroke");
    for (const op of ops) for (const [x, y] of op.points) expect(Math.hypot(x - 50, y - 50)).toBeLessThan(50);
  });

  it("renders a standalone SVG for icons", () => {
    const svg = prismSvg(REST_POSE, { size: 32, palette: PRISM_PALETTES.dark, detail: "mark" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("linearGradient");
    expect(svg).not.toContain("NaN");
  });
});

describe("shapes", () => {
  it("puts outline dots on the rectangle's edge", () => {
    const rect = { x: 10, y: 20, width: 200, height: 80 };
    const points = sampleOutline(rect, { radius: 0, spacing: 4 });
    expect(points.length % 6).toBe(0);
    for (let i = 0; i < points.length; i += 6) {
      const x = points[i];
      const y = points[i + 1];
      const onEdge =
        Math.abs(x - rect.x) < 0.01 ||
        Math.abs(x - rect.x - rect.width) < 0.01 ||
        Math.abs(y - rect.y) < 0.01 ||
        Math.abs(y - rect.y - rect.height) < 0.01;
      expect(onEdge).toBe(true);
    }
  });

  it("lays rows inside their area", () => {
    const points = sampleRows({ x: 0, y: 0, width: 100, height: 40 }, [1, 0.5, 0.8, 0.9, 1]);
    for (let i = 0; i < points.length; i += 6) expect(points[i + 1]).toBeLessThanOrEqual(40);
  });
});

describe("particles", () => {
  it("returns drifting particles to the field with their light", () => {
    const particles = new Particles(8);
    const landed: number[] = [];
    particles.onReturn = (x) => landed.push(x);
    const index = particles.spawn(5, 5, [255, 0, 0], 1);
    particles.release(index, 0.2);
    for (let i = 0; i < 30; i += 1) particles.step(1 / 60);
    expect(particles.live).toBe(0);
    expect(landed).toHaveLength(1);
  });

  it("brings seeking particles to their targets", () => {
    const particles = new Particles(4);
    const index = particles.spawn(0, 0, [0, 0, 0], 1, 7);
    particles.seek(index, 100, 40, 1);
    for (let i = 0; i < 240; i += 1) particles.step(1 / 60);
    expect(particles.arrival(7)).toBe(1);
  });
});

describe("spectrum", () => {
  it("is one continuous loop with no seam", () => {
    let worst = 0;
    for (let i = 0; i < 512; i += 1) {
      const a = spectrumAt(i / 512);
      const b = spectrumAt((i + 1) / 512);
      worst = Math.max(worst, Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]));
    }
    expect(worst).toBeLessThan(24);
  });
});
