/**
 * Procedural pixel-art characters for the gym floor.
 *
 * This is the piece HD-2D actually rests on. The style is a 2D pixel sprite
 * standing in a lit 3D diorama — the sprite has to read as hand-pixelled, or the
 * whole thing collapses into "3D scene with a flat texture in it".
 *
 * Munder Difflin generates its avatars the same way, in portraitArt.ts, and for
 * the same reason: nineteen agents whose colours come out of a database cannot
 * be served by hand-drawn sheets, and a bought tileset cannot be redistributed.
 *
 * Everything here is drawn at 1 device pixel per art pixel on a 32x44 grid and
 * then magnified by the renderer with a nearest-neighbour filter. Never draw at
 * a larger size to "get more detail" — smooth edges are exactly the thing that
 * makes a sprite stop looking like a sprite.
 */

/*
 * Wide enough for the largest body the bulk scale can produce.
 *
 * This was 32 and the growth was invisible: a Beast and a Rookie differed by a
 * single pixel of shoulder, because the widest torso the canvas could hold was
 * barely wider than the narrowest. The frame is now sized for the top of the
 * range, and the range itself is spread across most of it.
 */
export const SPRITE_W = 44;
export const SPRITE_H = 44;

export type Pose = "stand" | "pressUp" | "pressDown" | "walkA" | "walkB" | "sit";

/** Shift a hex colour's lightness. Amount is -1..1. */
function shift(hex: string, amount: number): string {
  const m = /^#?([\da-f]{6})$/i.exec(hex.trim());
  if (!m || !m[1]) return hex;
  const n = parseInt(m[1], 16);
  const to = amount < 0 ? 0 : 255;
  const k = Math.abs(amount);
  const ch = (s: number): number => {
    const v = (n >> s) & 0xff;
    return Math.round(v + (to - v) * k);
  };
  const r = ch(16);
  const g = ch(8);
  const b = ch(0);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

interface Palette {
  base: string;
  light: string;
  dark: string;
  outline: string;
  skin: string;
  skinDark: string;
  steel: string;
  steelDark: string;
}

function paletteFor(color: string): Palette {
  return {
    base: color,
    light: shift(color, 0.34),
    dark: shift(color, -0.4),
    // Not pure black: a black outline on a near-black scene punches a hole in
    // the sprite instead of edging it.
    outline: shift(color, -0.78),
    skin: "#e8b98f",
    skinDark: "#b3855f",
    steel: "#c3ccdd",
    steelDark: "#7c8699",
  };
}

/**
 * The bar, drawn behind or in front of the body depending on the pose.
 * `plates` is bulk-driven — a bigger agent is not just wider, it is moving more.
 */
function bar(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  y: number,
  plateH: number,
  half: number,
): void {
  const cx = SPRITE_W / 2;
  ctx.fillStyle = p.steel;
  ctx.fillRect(cx - half, y, half * 2, 2);
  ctx.fillStyle = p.steelDark;
  ctx.fillRect(cx - half, y + 2, half * 2, 1);
  const top = y + 1 - Math.floor(plateH / 2);
  ctx.fillStyle = p.dark;
  ctx.fillRect(cx - half - 1, top, 3, plateH);
  ctx.fillRect(cx + half - 2, top, 3, plateH);
  ctx.fillStyle = p.base;
  ctx.fillRect(cx - half - 1, top, 3, 1);
  ctx.fillRect(cx + half - 2, top, 3, 1);
}

/**
 * One character, one pose.
 *
 * `bulk` is 0..1 and widens the torso, arms, legs and plates together. Sizing
 * one part alone reads as a deformity rather than as training.
 */
export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  opts: { color: string; bulk: number; pose: Pose },
): void {
  const { color, bulk, pose } = opts;
  const p = paletteFor(color);
  const b = Math.max(0, Math.min(1, bulk));

  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  ctx.imageSmoothingEnabled = false;

  const cx = SPRITE_W / 2;
  // The spread is the point. A Rookie is a stick and a Beast is nearly three
  // times the shoulder width — anything subtler and the panel stops answering
  // the question it exists to answer.
  const torsoHalf = 3 + Math.round(b * 11);
  const armW = 2 + Math.round(b * 4);
  const legW = 2 + Math.round(b * 4);
  const plateH = 4 + Math.round(b * 11);

  const lifting = pose === "pressUp" || pose === "pressDown";
  const barY = pose === "pressUp" ? 3 : 15;
  const barHalf = 13 + Math.round(b * 5);
  const sitting = pose === "sit";
  const yOff = sitting ? 5 : 0;

  // The bar goes down first when it is overhead, so the hands cover it.
  if (pose === "pressUp") bar(ctx, p, barY, plateH, barHalf);

  // ── legs ────────────────────────────────────────────────────────────────
  const legTop = 31 + yOff;
  const legBottom = sitting ? 38 : 42;
  const swing = pose === "walkA" ? 1 : pose === "walkB" ? -1 : 0;

  ctx.fillStyle = p.dark;
  ctx.fillRect(cx - torsoHalf + 1 - (swing > 0 ? 1 : 0), legTop, legW, legBottom - legTop);
  ctx.fillRect(cx + torsoHalf - legW - 1 + (swing < 0 ? 1 : 0), legTop, legW, legBottom - legTop);

  // boots
  ctx.fillStyle = p.outline;
  ctx.fillRect(cx - torsoHalf + 1 - (swing > 0 ? 1 : 0), legBottom - 2, legW, 2);
  ctx.fillRect(cx + torsoHalf - legW - 1 + (swing < 0 ? 1 : 0), legBottom - 2, legW, 2);

  // ── torso ───────────────────────────────────────────────────────────────
  const shoulderY = 20 + yOff;
  const hipY = 31 + yOff;

  // Outline first, body over it — one pixel of dark on every side, which is what
  // separates the sprite from the diorama behind it.
  ctx.fillStyle = p.outline;
  ctx.fillRect(cx - torsoHalf - 1, shoulderY - 1, torsoHalf * 2 + 2, hipY - shoulderY + 2);

  ctx.fillStyle = p.base;
  ctx.fillRect(cx - torsoHalf, shoulderY, torsoHalf * 2, hipY - shoulderY);

  // Key light from the upper left: highlight that edge, shade the other.
  ctx.fillStyle = p.light;
  ctx.fillRect(cx - torsoHalf, shoulderY, 2, hipY - shoulderY - 2);
  ctx.fillStyle = p.dark;
  ctx.fillRect(cx + torsoHalf - 2, shoulderY + 1, 2, hipY - shoulderY - 1);

  // A singlet stripe, so the torso is not a flat slab at this size.
  ctx.fillStyle = p.dark;
  ctx.fillRect(cx - 1, shoulderY + 2, 2, hipY - shoulderY - 4);

  // ── arms ────────────────────────────────────────────────────────────────
  const armTop = lifting ? barY + 2 : shoulderY;
  const armBottom = lifting ? shoulderY + 2 : shoulderY + 9;

  ctx.fillStyle = p.outline;
  ctx.fillRect(cx - torsoHalf - armW - 1, armTop - 1, armW + 2, armBottom - armTop + 2);
  ctx.fillRect(cx + torsoHalf - 1, armTop - 1, armW + 2, armBottom - armTop + 2);

  ctx.fillStyle = p.skin;
  ctx.fillRect(cx - torsoHalf - armW, armTop, armW, armBottom - armTop);
  ctx.fillRect(cx + torsoHalf, armTop, armW, armBottom - armTop);
  ctx.fillStyle = p.skinDark;
  ctx.fillRect(cx + torsoHalf + armW - 1, armTop, 1, armBottom - armTop);

  if (pose === "pressDown") bar(ctx, p, barY, plateH, barHalf);

  // ── head ────────────────────────────────────────────────────────────────
  const headTop = 7 + yOff;
  ctx.fillStyle = p.outline;
  ctx.fillRect(cx - 6, headTop - 1, 12, 13);
  ctx.fillStyle = p.skin;
  ctx.fillRect(cx - 5, headTop, 10, 11);
  ctx.fillStyle = p.skinDark;
  ctx.fillRect(cx + 3, headTop + 1, 2, 10);

  // hair, in the agent's colour — it is what makes two characters tellable apart
  ctx.fillStyle = p.dark;
  ctx.fillRect(cx - 5, headTop, 10, 3);
  ctx.fillRect(cx - 6, headTop + 1, 1, 4);
  ctx.fillRect(cx + 5, headTop + 1, 1, 4);
  ctx.fillStyle = p.base;
  ctx.fillRect(cx - 4, headTop, 6, 1);

  // eyes
  ctx.fillStyle = p.outline;
  if (lifting) {
    // squeezed shut under load
    ctx.fillRect(cx - 4, headTop + 6, 3, 1);
    ctx.fillRect(cx + 1, headTop + 6, 3, 1);
  } else {
    ctx.fillRect(cx - 4, headTop + 5, 2, 2);
    ctx.fillRect(cx + 2, headTop + 5, 2, 2);
  }

  // mouth — open and straining while lifting
  ctx.fillStyle = p.skinDark;
  if (lifting) ctx.fillRect(cx - 1, headTop + 9, 3, 2);
  else ctx.fillRect(cx - 1, headTop + 9, 3, 1);

  // ── neck ────────────────────────────────────────────────────────────────
  ctx.fillStyle = p.skinDark;
  ctx.fillRect(cx - 2, headTop + 12, 4, 2);
}

/** A ready-to-upload canvas for one pose. */
export function characterCanvas(color: string, bulk: number, pose: Pose): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = SPRITE_W;
  c.height = SPRITE_H;
  const ctx = c.getContext("2d");
  if (ctx) drawCharacter(ctx, { color, bulk, pose });
  return c;
}

/**
 * The gym mat, as a tileable texture.
 *
 * Drawn rather than loaded for the same reason as the characters, and kept to a
 * 64px tile so the rubber grain stays crisp when the floor plane repeats it.
 */
export function matCanvas(ink: string, line: string): HTMLCanvasElement {
  const S = 64;
  const c = document.createElement("canvas");
  c.width = S;
  c.height = S;
  const ctx = c.getContext("2d");
  if (!ctx) return c;

  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, S, S);

  // Speckle, so the floor is not a flat colour under the lights.
  for (let i = 0; i < 220; i++) {
    const x = Math.floor(Math.random() * S);
    const y = Math.floor(Math.random() * S);
    ctx.fillStyle = i % 3 === 0 ? line : ink;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = line;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 0.5;
  ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  ctx.globalAlpha = 1;

  return c;
}
