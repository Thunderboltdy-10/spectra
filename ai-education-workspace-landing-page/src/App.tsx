import { useEffect, useRef, useState } from "react";
import { engine, markDirty } from "./engine/ticker";
import { stage, prism, field } from "./webgl/stage";
import Open from "./scenes/Open";
import PrismWork from "./scenes/PrismWork";
import Connected from "./scenes/Connected";
import Collab from "./scenes/Collab";
import Undercurrent from "./scenes/Undercurrent";
import Reveal from "./scenes/Reveal";
import { PrismMark } from "./components/kit";

export default function App() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if ("scrollRestoration" in history) history.scrollRestoration = "manual";
    window.scrollTo(0, 0);

    const mobile = window.innerWidth < 860;
    const ok = canvas.current ? stage.init(canvas.current, mobile) : false;
    if (!ok) setFallback(true);
    engine.start();

    if (ok) {
      stage.resize(window.innerWidth, window.innerHeight);
      const onResize = () => {
        stage.resize(window.innerWidth, window.innerHeight);
        markDirty();
      };
      window.addEventListener("resize", onResize, { passive: true });
      const unsub = engine.subscribe((c) => {
        if (document.hidden) return;
        stage.frame(c);
      }, 100);
      return () => {
        window.removeEventListener("resize", onResize);
        unsub();
        engine.stop();
        stage.dispose();
      };
    }
    // fallback: keep the DOM systems alive, no WebGL
    prism.opacity = 0;
    field.intensity = 0;
    return () => engine.stop();
  }, []);

  return (
    <>
      <canvas
        ref={canvas}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          width: "100%",
          height: "100%",
          zIndex: 0,
          pointerEvents: "none",
          display: "block",
        }}
      />
      {fallback && (
        <div
          aria-hidden="true"
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 0,
            pointerEvents: "none",
            background:
              "radial-gradient(70% 55% at 72% 30%, rgba(224,173,99,0.10), transparent 60%), radial-gradient(60% 50% at 20% 80%, rgba(124,201,180,0.06), transparent 60%)",
          }}
        >
          <div
            className="dots dots-drift"
            style={{
              position: "absolute",
              inset: 0,
              opacity: 0.22,
              ["--dot-s" as string]: "11px",
              ["--dot-r" as string]: "0.9px",
              WebkitMaskImage: "radial-gradient(circle at 60% 40%, #000, transparent 78%)",
              maskImage: "radial-gradient(circle at 60% 40%, #000, transparent 78%)",
            }}
          />
          <div style={{ position: "absolute", right: "12vw", top: "18vh", opacity: 0.8 }}>
            <PrismMark size={240} state="work" />
          </div>
        </div>
      )}

      <main style={{ position: "relative", zIndex: 1 }} id="top">
        <h1 className="sr-only" style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0 0 0 0)" }}>
          Verso — an AI-native workspace for study, research and teaching
        </h1>
        <Open />
        <PrismWork />
        <Connected />
        <Collab />
        <Undercurrent />
        <Reveal />
      </main>

      <div className="grain" aria-hidden="true" />
    </>
  );
}
