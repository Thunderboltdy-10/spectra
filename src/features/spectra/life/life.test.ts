import { describe, expect, it } from "vitest";
import { LifeEngine, type LifeEvent, type LifeSurface } from "./engine";
import { FieldLattice } from "./field-sim";
import { combine, outlineFigure, resample, rowsFigure } from "./figure";
import { Formation } from "./formation";
import { Particles } from "./particles";
import { PRISM_PALETTES, PrismBody, prismOps, prismSvg, REST_POSE, type Quat } from "./prism";
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

  it("turns while working and settles once the artifact ends", () => {
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

  it("shows the status as a dot in the top right corner, also in icons", () => {
    const body = new PrismBody();
    body.setStatus("done");
    run(body, 1);
    const pose = body.pose();
    expect(pose.status).toBeDefined();
    const ops = prismOps(pose, { x: 50, y: 50, size: 80, palette: PRISM_PALETTES.light });
    const dot = ops.find((op) => op.kind === "dot");
    expect(dot).toBeDefined();
    expect(dot!.points[0][0]).toBeGreaterThan(50);
    expect(dot!.points[0][1]).toBeLessThan(50);
    expect(prismSvg(pose, { size: 32, palette: PRISM_PALETTES.dark, detail: "mark" })).toContain("<circle");
    body.markSeen();
    run(body, 1.5);
    expect(body.pose().status).toBeUndefined();
  });

  it("renders a standalone SVG for icons", () => {
    const svg = prismSvg(REST_POSE, { size: 32, palette: PRISM_PALETTES.dark, detail: "mark" });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain("linearGradient");
    expect(svg).not.toContain("NaN");
  });
});

describe("figures", () => {
  it("puts a card's outline on its edge", () => {
    const [stroke] = outlineFigure({ x: 10, y: 20, width: 200, height: 80 }, { radius: 0 }).strokes;
    expect(stroke.closed).toBe(true);
    for (let i = 0; i < stroke.points.length; i += 2) {
      const x = stroke.points[i];
      const y = stroke.points[i + 1];
      const onEdge = Math.abs(x - 10) < 0.01 || Math.abs(x - 210) < 0.01 || Math.abs(y - 20) < 0.01 || Math.abs(y - 100) < 0.01;
      expect(onEdge).toBe(true);
    }
  });

  it("lays rows inside their area", () => {
    const { strokes } = rowsFigure({ x: 0, y: 0, width: 100, height: 40 }, [1, 0.5, 0.8, 0.9, 1]);
    expect(strokes.length).toBeGreaterThan(0);
    for (const stroke of strokes) expect(stroke.points[1]).toBeLessThanOrEqual(40);
  });

  it("resamples a line at an even spacing", () => {
    const points = resample([0, 0, 100, 0], false, 4);
    expect(points.length / 2).toBe(26);
    for (let i = 2; i < points.length; i += 2) expect(points[i] - points[i - 2]).toBeCloseTo(4, 5);
  });
});

function settle(formation: Formation, lattice: FieldLattice, seconds: number) {
  let time = 0;
  for (; time < seconds && !formation.done && formation.phase !== "formed"; time += 1 / 60) {
    formation.step(1 / 60, time, lattice);
    lattice.step(1 / 60);
  }
  return time;
}

describe("formations", () => {
  const card = () => outlineFigure({ x: 100, y: 100, width: 160, height: 90 }, { radius: 12, fill: [255, 255, 255] });

  it("rises out of the field and fuses into its figure", () => {
    const lattice = new FieldLattice(600, 400);
    const formation = new Formation(1, card());
    formation.riseFrom(lattice, 100, 100, [20, 19, 24]);
    const took = settle(formation, lattice, 3);
    expect(formation.phase).toBe("formed");
    expect(took).toBeLessThan(1.6);
    expect(formation.wholeness()).toBeGreaterThan(0.99);
    for (let i = 0; i < formation.n; i += 1) {
      expect(Math.hypot(formation.x[i] - formation.tx[i], formation.y[i] - formation.ty[i])).toBeLessThan(0.01);
    }
  });

  it("breaks into dots that sink into the field", () => {
    const lattice = new FieldLattice(600, 400);
    const formation = new Formation(1, card());
    formation.showWhole();
    formation.breakUp(lattice, { kind: "field" }, 100, 100);
    let sunk = 0;
    for (let t = 0; t < 3 && !formation.done; t += 1 / 60) sunk += formation.step(1 / 60, t, lattice);
    expect(formation.done).toBe(true);
    expect(sunk).toBe(formation.n);
  });

  it("morphs by taking the dots of the shape before it", () => {
    const lattice = new FieldLattice(600, 400);
    const before = new Formation(1, combine(card(), rowsFigure({ x: 100, y: 100, width: 160, height: 90 }, [0.8])));
    before.showWhole();
    const after = new Formation(2, outlineFigure({ x: 60, y: 60, width: 300, height: 60 }, { radius: 18 }));
    const used = after.takeFrom(before);
    // The outline takes the outline; the row is left to sink.
    expect([...used]).toEqual([0]);
    const old = before.strokes[0];
    for (let i = 0; i < after.n; i += 1) {
      let nearest = Infinity;
      for (let k = 0; k < old.count; k += 1) {
        const j = old.start + k;
        nearest = Math.min(nearest, Math.hypot(after.x[i] - before.x[j], after.y[i] - before.y[j]));
      }
      expect(nearest).toBeLessThan(1);
    }
    expect(settle(after, lattice, 3)).toBeLessThan(1.6);
    expect(after.phase).toBe("formed");
  });
});

function fakeSurface(): LifeSurface {
  const context = new Proxy({} as Record<string | symbol, unknown>, {
    get: (target, key) => (key in target ? target[key] : key === "createLinearGradient" ? () => ({ addColorStop() {} }) : () => undefined),
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return { canvas: { width: 1, height: 1 }, context } as unknown as LifeSurface;
}

describe("life engine", () => {
  function engine() {
    const events: LifeEvent[] = [];
    let pending: ((now: number) => void) | null = null;
    let now = 0;
    const life = new LifeEngine(
      fakeSurface(),
      fakeSurface(),
      "full",
      (event) => events.push(event),
      (frame) => {
        pending = frame;
      },
      () => now,
    );
    life.handle({ type: "resize", width: 800, height: 600, ratio: 1 });
    const run = (seconds: number) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        now += 1000 / 60;
        const frame = pending;
        pending = null;
        frame?.(now);
      }
    };
    const of = (id: number) => events.filter((e) => "id" in e && e.id === id).map((e) => e.type);
    return { life, events, run, of };
  }

  it("carries a figure through the field to a far place and forms it there", () => {
    const { life, run, of } = engine();
    const from = outlineFigure({ x: 40, y: 480, width: 120, height: 60 });
    const to = outlineFigure({ x: 560, y: 60, width: 160, height: 90 });
    life.handle({ type: "travel", id: 7, from, to, colour: "spectrum", hold: false });
    run(3);
    expect(of(7)).toContain("formed");
  });

  it("pours something close by straight into what takes it in", () => {
    const { life, run, of } = engine();
    const words = { strokes: [{ points: [300, 500, 420, 500], closed: false, width: 5, colour: [20, 19, 24] as [number, number, number], alpha: 0.2 }] };
    life.handle({ type: "travel", id: 9, from: words, absorb: { x: 380, y: 520, width: 34, height: 34 }, colour: "spectrum", hold: false });
    run(1.5);
    expect(of(9)).toContain("arrived");
    expect(of(9)).toContain("gone");
  });

  it("travels from a point, as light leaving the prism", () => {
    const { life, run, of } = engine();
    life.handle({ type: "travel", id: 3, from: [400, 560], to: outlineFigure({ x: 300, y: 200, width: 200, height: 100 }), colour: [246, 190, 64], hold: false });
    run(3);
    expect(of(3)).toContain("formed");
  });

  it("falls asleep when nothing moves", () => {
    const { life, events, run } = engine();
    life.handle({ type: "pulse", x: 200, y: 200, strength: 1 });
    run(8);
    expect(events.at(-1)?.type).toBe("asleep");
  });

  /** An engine whose every frame takes `cost` ms by its own clock. */
  function timed(cost: number) {
    const events: LifeEvent[] = [];
    let pending: ((now: number) => void) | null = null;
    let clock = 0;
    const life = new LifeEngine(fakeSurface(), fakeSurface(), "full", (event) => events.push(event), (frame) => {
      pending = frame;
    }, () => (clock += cost / 2));
    life.handle({ type: "resize", width: 800, height: 600, ratio: 1 });
    const run = (seconds: number, active = true) => {
      for (let t = 0; t < seconds; t += 1 / 60) {
        if (active && t % 0.5 < 1 / 60) life.handle({ type: "pulse", x: 200 + t * 40, y: 200, strength: 1 });
        const frame = pending;
        pending = null;
        frame?.(clock);
      }
    };
    return { life, events, run };
  }

  it("settles on the light tier, between moments, when a device cannot keep the full field within budget", () => {
    const { events, run } = timed(14);
    run(3);
    expect(events.some((event) => event.type === "tier")).toBe(false);
    run(10, false);
    const tier = events.find((event) => event.type === "tier");
    expect(tier).toEqual({ type: "tier", tier: "light" });
    // It changed while the field was asleep, never in the middle of a moment.
    expect(events[events.indexOf(tier!) + 1]?.type).toBe("asleep");
  });

  it("stays full on a device that keeps within budget", () => {
    const { events, run } = timed(1);
    run(3);
    run(10, false);
    expect(events.some((event) => event.type === "tier")).toBe(false);
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
