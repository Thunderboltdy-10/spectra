"use client";

import { useEffect, useRef } from "react";

// ── Asset paths ────────────────────────────────────────────────────────────────
const MASK_URL = "/brand/ribbon-mask.png";
const SHADOW_URL = "/brand/ribbon-shadow.png";
const HIGHLIGHT_URL = "/brand/ribbon-highlight.png";

const DEFAULT_PRIMARY = "#2c92eb";
const DEFAULT_ACCENT = "#67dacc";

// Ribbon bounding box (fraction of container)
const RX = 0.2041;
const RY = 0.1279;
const RW = 0.6084;
const RH = 0.7363;

// ── Color utilities ────────────────────────────────────────────────────────────
function clamp(v: number, lo = 0, hi = 255) {
  return Math.max(lo, Math.min(hi, v));
}
function hexToRgb(hex: string) {
  const n = hex.replace("#", "").trim();
  const x = n.length === 3 ? n.split("").map((c) => c + c).join("") : n;
  if (!/^[0-9a-fA-F]{6}$/.test(x)) return { r: 44, g: 146, b: 235 };
  const i = parseInt(x, 16);
  return { r: (i >> 16) & 255, g: (i >> 8) & 255, b: i & 255 };
}
function rgbHex(r: number, g: number, b: number) {
  return (
    "#" +
    [r, g, b]
      .map((v) => clamp(Math.round(v)).toString(16).padStart(2, "0"))
      .join("")
  );
}
function mixC(a: string, b: string, t: number) {
  const c1 = hexToRgb(a),
    c2 = hexToRgb(b);
  return rgbHex(
    c1.r + (c2.r - c1.r) * t,
    c1.g + (c2.g - c1.g) * t,
    c1.b + (c2.b - c1.b) * t,
  );
}
function rgbaS(hex: string, alpha: number) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${alpha})`;
}

// ── Image loading (module-level cache) ─────────────────────────────────────────
type Images = {
  mask: HTMLImageElement;
  shadow: HTMLImageElement;
  highlight: HTMLImageElement;
};

let _cache: Images | null = null;
let _promise: Promise<Images> | null = null;

function loadImg(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function loadAllImages(): Promise<Images> {
  if (_cache) return Promise.resolve(_cache);
  if (_promise) return _promise;
  _promise = Promise.all([
    loadImg(MASK_URL),
    loadImg(SHADOW_URL),
    loadImg(HIGHLIGHT_URL),
  ]).then(([mask, shadow, highlight]) => {
    _cache = { mask, shadow, highlight };
    return _cache;
  });
  return _promise;
}

// ── Grayscale-as-alpha masking ─────────────────────────────────────────────────
// The mask PNGs are 8-bit grayscale: white = visible, black = hidden.
// Canvas compositing only uses the alpha channel, but grayscale PNGs render as
// RGBA(V,V,V,255) — fully opaque everywhere. So we manually read the mask's
// luminance (R channel) and apply it as the source canvas's alpha channel.

function applyGrayscaleMask(
  srcCtx: CanvasRenderingContext2D,
  maskImg: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
) {
  // Draw the mask into a temp canvas at the target size
  const mC = document.createElement("canvas");
  mC.width = w;
  mC.height = h;
  const mCtx = mC.getContext("2d")!;
  mCtx.drawImage(maskImg, 0, 0, w, h);
  const maskData = mCtx.getImageData(0, 0, w, h);

  // Read the source region
  const srcData = srcCtx.getImageData(x, y, w, h);

  // Multiply source alpha by mask luminance (R channel)
  for (let i = 0; i < srcData.data.length; i += 4) {
    const maskLuminance = maskData.data[i]; // R = G = B for grayscale
    srcData.data[i + 3] = (srcData.data[i + 3] * maskLuminance) / 255;
  }

  // Write back
  srcCtx.putImageData(srcData, x, y);
}

// ── Canvas rendering ───────────────────────────────────────────────────────────
function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function renderIcon(
  ctx: CanvasRenderingContext2D,
  S: number,
  primary: string,
  secondary: string,
  images: Images,
  showTile: boolean,
) {
  ctx.clearRect(0, 0, S, S);

  // ── Tile background ──
  if (showTile) {
    ctx.save();
    roundedRect(ctx, 0, 0, S, S, S * 0.166);
    ctx.clip();
    const tileGrad = ctx.createLinearGradient(0, 0, S, S);
    tileGrad.addColorStop(0, "#f6f2eb");
    tileGrad.addColorStop(1, "#f3eee6");
    ctx.fillStyle = tileGrad;
    ctx.fillRect(0, 0, S, S);
    const glow = ctx.createRadialGradient(
      S * 0.5, S * 0.45, 0,
      S * 0.5, S * 0.45, S * 0.7,
    );
    glow.addColorStop(0, "rgba(255,255,255,0.18)");
    glow.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, S, S);
    ctx.restore();
  }

  // ── Ribbon position ──
  const rx = Math.round(S * RX);
  const ry = Math.round(S * RY);
  const rw = Math.round(S * RW);
  const rh = Math.round(S * RH);

  // ── Derived colors ──
  const pMid = mixC(primary, secondary, 0.32);
  const aMid = mixC(primary, secondary, 0.56);
  const pBright = mixC(primary, "#ffffff", 0.12);
  const sBright = mixC(secondary, "#ffffff", 0.18);
  const shadowColor = mixC("#031f39", primary, 0.08);

  // ── Main ribbon layer ──
  const ribbonC = document.createElement("canvas");
  ribbonC.width = S;
  ribbonC.height = S;
  const rCtx = ribbonC.getContext("2d")!;

  // 150° gradient
  const ang = (150 * Math.PI) / 180;
  const cx = rx + rw / 2;
  const cy = ry + rh / 2;
  const d = Math.max(rw, rh);
  const grad = rCtx.createLinearGradient(
    cx - Math.cos(ang) * (d / 2),
    cy - Math.sin(ang) * (d / 2),
    cx + Math.cos(ang) * (d / 2),
    cy + Math.sin(ang) * (d / 2),
  );
  grad.addColorStop(0, primary);
  grad.addColorStop(0.4, pMid);
  grad.addColorStop(0.67, aMid);
  grad.addColorStop(1, secondary);
  rCtx.fillStyle = grad;
  rCtx.fillRect(rx, ry, rw, rh);

  // Radial highlights
  const rg1 = rCtx.createRadialGradient(
    rx + rw * 0.64, ry + rh * 0.1, 0,
    rx + rw * 0.64, ry + rh * 0.1, rw * 0.42,
  );
  rg1.addColorStop(0, rgbaS(pBright, 0.35));
  rg1.addColorStop(1, "rgba(0,0,0,0)");
  rCtx.fillStyle = rg1;
  rCtx.fillRect(rx, ry, rw, rh);

  const rg2 = rCtx.createRadialGradient(
    rx + rw * 0.26, ry + rh * 0.82, 0,
    rx + rw * 0.26, ry + rh * 0.82, rw * 0.36,
  );
  rg2.addColorStop(0, rgbaS(sBright, 0.4));
  rg2.addColorStop(1, "rgba(0,0,0,0)");
  rCtx.fillStyle = rg2;
  rCtx.fillRect(rx, ry, rw, rh);

  // Apply grayscale mask → alpha
  applyGrayscaleMask(rCtx, images.mask, rx, ry, rw, rh);

  ctx.drawImage(ribbonC, 0, 0);

  // ── Shadow layer ──
  const shadowC = document.createElement("canvas");
  shadowC.width = S;
  shadowC.height = S;
  const sCtx = shadowC.getContext("2d")!;
  sCtx.fillStyle = shadowColor;
  sCtx.fillRect(rx, ry, rw, rh);
  applyGrayscaleMask(sCtx, images.shadow, rx, ry, rw, rh);

  ctx.globalAlpha = 0.4;
  ctx.drawImage(shadowC, 0, 0);
  ctx.globalAlpha = 1;

  // ── Highlight layer ──
  const hlC = document.createElement("canvas");
  hlC.width = S;
  hlC.height = S;
  const hCtx = hlC.getContext("2d")!;
  hCtx.fillStyle = "#ffffff";
  hCtx.fillRect(rx, ry, rw, rh);
  applyGrayscaleMask(hCtx, images.highlight, rx, ry, rw, rh);

  ctx.globalAlpha = 0.18;
  ctx.drawImage(hlC, 0, 0);
  ctx.globalAlpha = 1;
}

// ── SpectraLogo ────────────────────────────────────────────────────────────────
type SpectraLogoProps = {
  size?: number;
  className?: string;
  showTile?: boolean;
  style?: React.CSSProperties;
};

export function SpectraLogo({
  size = 32,
  className,
  showTile = false,
  style,
}: SpectraLogoProps) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;

    const dpr = window.devicePixelRatio || 1;
    const S = Math.round(size * dpr);
    canvas.width = S;
    canvas.height = S;

    let cancelled = false;

    function paint() {
      loadAllImages().then((images) => {
        if (cancelled) return;
        const ctx = canvas!.getContext("2d")!;

        const styles = getComputedStyle(document.documentElement);
        const primary =
          styles.getPropertyValue("--brand-primary").trim() || DEFAULT_PRIMARY;
        const accent =
          styles.getPropertyValue("--brand-accent").trim() || DEFAULT_ACCENT;

        renderIcon(ctx, S, primary, accent, images, showTile);
      });
    }

    paint();

    // Re-paint when brand colors change (school branding applied/removed)
    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === "attributes" &&
          (m.attributeName === "style" ||
            m.attributeName === "data-theme-palette")
        ) {
          paint();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [size, showTile]);

  return (
    <canvas
      ref={ref}
      className={className}
      role="img"
      aria-label="Spectra"
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        display: "block",
        ...style,
      }}
    />
  );
}

// ── DynamicFavicon ─────────────────────────────────────────────────────────────
export function DynamicFavicon() {
  useEffect(() => {
    let cancelled = false;

    async function update() {
      const images = await loadAllImages();
      if (cancelled) return;

      const styles = getComputedStyle(document.documentElement);
      const primary =
        styles.getPropertyValue("--brand-primary").trim() || DEFAULT_PRIMARY;
      const accent =
        styles.getPropertyValue("--brand-accent").trim() || DEFAULT_ACCENT;

      const S = 64;
      const canvas = document.createElement("canvas");
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext("2d")!;

      renderIcon(ctx, S, primary, accent, images, false);

      const url = canvas.toDataURL("image/png");

      let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
      if (!link) {
        link = document.createElement("link");
        link.rel = "icon";
        document.head.appendChild(link);
      }
      link.type = "image/png";
      link.href = url;
    }

    update();

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (
          m.type === "attributes" &&
          (m.attributeName === "style" ||
            m.attributeName === "data-theme-palette")
        ) {
          update();
          break;
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, []);

  return null;
}
