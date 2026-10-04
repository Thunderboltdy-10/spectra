/// <reference lib="webworker" />
import { LifeEngine, type LifeCommand, type LifeTier } from "./engine";

/*
 * The life engine's thread. The page hands over its two canvases once, then
 * sends commands; this worker simulates and draws, and reports when it wakes,
 * sleeps or settles a group.
 */

type Init = { type: "init"; back: OffscreenCanvas; front: OffscreenCanvas; tier: LifeTier };

const scope = self as unknown as DedicatedWorkerGlobalScope;
let engine: LifeEngine | null = null;

const schedule =
  typeof scope.requestAnimationFrame === "function"
    ? (frame: (now: number) => void) => scope.requestAnimationFrame(frame)
    : (frame: (now: number) => void) => setTimeout(() => frame(performance.now()), 16);

scope.onmessage = (event: MessageEvent<Init | LifeCommand>) => {
  const message = event.data;
  if (message.type === "init") {
    const back = message.back.getContext("2d");
    const front = message.front.getContext("2d");
    if (!back || !front) return;
    engine = new LifeEngine(
      { canvas: message.back, context: back },
      { canvas: message.front, context: front },
      message.tier,
      (lifeEvent) => scope.postMessage(lifeEvent),
      schedule,
      () => performance.now(),
    );
    return;
  }
  engine?.handle(message);
};
