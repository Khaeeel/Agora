/**
 * Procedural pixel-art characters for the gym floor.
 *
 * The style is HD-2D: a hand-pixelled 2D sprite standing in a lit 3D diorama.
 * The sprite has to read as pixel art or the whole thing collapses into "a 3D
 * scene with a flat texture in it".
 *
 * Munder Difflin generates its avatars the same way, in portraitArt.ts, and for
 * the same reasons: agents whose colours come from a database cannot be served
 * by hand-drawn sheets, and a bought tileset cannot be redistributed.
 *
 * Everything is drawn at one device pixel per art pixel on a 44x44 grid and
 * magnified by the renderer with a nearest filter. Never draw larger to "get
 * more detail" — smooth edges are exactly what stops a sprite reading as one.
 *
 * ── two things this file learned the hard way ─────────────────────────────
 *
 * 1. EVERY LIMB IS DRAWN TWICE. The first version gave each part its own
 *    bordered box, so every part sat two pixels of outline away from its
 *    neighbour and the character read as a pile of rectangles — arms floating
 *    beside the torso, legs detached at the hip. Now the whole silhouette is
 *    stamped once in the outline colour, a pixel proud on each side, and the
 *    fills go on top of that. Parts overlap by a pixel on purpose.
 *
 * 2. FOUR EXERCISES, NOT ONE. A floor where everybody did the same overhead
 *    press read as a row of copies. The exercise comes from the machine the
 *    agent is standing at, so the floor looks like a gym rather than a drill.
 */

export const SPRITE_W = 44;
export const SPRITE_H = 44;

/** What an agent is doing, decided by the machine they own. */
export type Exercise = "press" | "squat" | "curl" | "run";

export type Pose =
  | "stand"
  | "sit"
  | "walkA"
  | "walkB"
  | "pressUp"
  | "pressDown"
  | "squatUp"
  | "squatDown"
  | "curlUp"
  | "curlDown"
  | "runA"
  | "runB";

/** The two frames that make up one repetition of each exercise. */
export const REP_FRAMES: Record<Exercise, [Pose, Pose]> = {
  press: ["pressUp", "pressDown"],
  squat: ["squatUp", "squatDown"],
  curl: ["curlUp", "curlDown"],
  run: ["runA", "runB"],
};

export const ALL_POSES: Pose[] = [
  "stand",
  "sit",
  "walkA",
  "walkB",
  "pressUp",
  "pressDown",
  "squatUp",
  "squatDown",
  "curlUp",
  "curlDown",
  "runA",
  "runB",
];

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
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, "0")}`;
}

interface Palette {
  base: string;
  light: string;
  dark: string;
  outline: string;
  skin: string;
  skinShade: string;
  hair: string;
  steel: string;
  steelDark: string;
}

function paletteFor(color: string): Palette {
  return {
    base: color,
    light: shift(color, 0.3),
    dark: shift(color, -0.34),
    // Not pure black: a black edge on a near-black scene punches a hole in the
    // sprite rather than outlining it.
    outline: shift(color, -0.76),
    skin: "#e9bd94",
    skinShade: "#c1906a",
    hair: shift(color, -0.5),
    steel: "#cdd6e6",
    steelDark: "#79839a",
  };
}

const CX = SPRITE_W / 2;
/** Where the feet land. Everything is measured up from here. */
const GROUND = 42;

type Rect = [x: number, y: number, w: number, h: number];

function stamp(ctx: CanvasRenderingContext2D, p: Palette, rs: Rect[]): void {
  ctx.fillStyle = p.outline;
  for (const [x, y, w, h] of rs) ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
}

function fill(ctx: CanvasRenderingContext2D, color: string, rs: Rect[]): void {
  ctx.fillStyle = color;
  for (const [x, y, w, h] of rs) ctx.fillRect(x, y, w, h);
}

/**
 * One body's measurements, all derived from bulk.
 *
 * Every limb scales, not just the chest — widening the torso alone gives a
 * barrel with twigs attached, which reads as a fault rather than as size. The
 * head is the exception: it barely grows, and that is exactly what makes the
 * rest of the body look bigger.
 */
function build(b: number) {
  return {
    torsoHalf: 4 + Math.round(b * 9), // 4..13
    armW: 3 + Math.round(b * 3), // 3..6
    legW: 4 + Math.round(b * 3), // 4..7
    headHalf: 6 + Math.round(b * 1),
    plateH: 5 + Math.round(b * 11),
    barHalf: 12 + Math.round(b * 6),
    bellR: 2 + Math.round(b * 3),
  };
}

function drawBar(
  ctx: CanvasRenderingContext2D,
  p: Palette,
  y: number,
  plateH: number,
  half: number,
): void {
  stamp(ctx, p, [[CX - half, y, half * 2, 3]]);
  fill(ctx, p.steel, [[CX - half, y, half * 2, 2]]);
  fill(ctx, p.steelDark, [[CX - half, y + 2, half * 2, 1]]);

  const top = y + 1 - Math.floor(plateH / 2);
  const plates: Rect[] = [
    [CX - half - 3, top, 4, plateH],
    [CX + half - 1, top, 4, plateH],
  ];
  stamp(ctx, p, plates);
  fill(ctx, p.dark, plates);
  // A lit top edge, so a plate reads as a disc and not a slab.
  fill(ctx, p.base, [
    [CX - half - 3, top, 4, 1],
    [CX + half - 1, top, 4, 1],
  ]);
}

function drawBell(ctx: CanvasRenderingContext2D, p: Palette, x: number, y: number, r: number): void {
  const parts: Rect[] = [
    [x - 1, y - r, 3, r * 2],
    [x - 3, y - 1, 7, 2],
  ];
  stamp(ctx, p, parts);
  fill(ctx, p.dark, [parts[0]!]);
  fill(ctx, p.steel, [parts[1]!]);
}

export function drawCharacter(
  ctx: CanvasRenderingContext2D,
  opts: { color: string; bulk: number; pose: Pose },
): void {
  const { color, bulk, pose } = opts;
  const p = paletteFor(color);
  const b = Math.max(0, Math.min(1, bulk));
  const d = build(b);

  ctx.clearRect(0, 0, SPRITE_W, SPRITE_H);
  ctx.imageSmoothingEnabled = false;

  const pressing = pose === "pressUp" || pose === "pressDown";
  const squatting = pose === "squatUp" || pose === "squatDown";
  const curling = pose === "curlUp" || pose === "curlDown";
  const running = pose === "runA" || pose === "runB";
  const straining = pressing || squatting || curling;

  // How far the whole body sits below its standing height. A squat is the only
  // exercise that moves the torso; everything else moves limbs.
  const drop = pose === "sit" ? 7 : pose === "squatDown" ? 6 : 0;

  const headTop = 4 + drop;
  const headBottom = 17 + drop;
  const neckTop = 16 + drop;
  const shoulderY = 19 + drop;
  const hipY = 30 + drop;
  const footY = pose === "sit" ? GROUND - 1 : GROUND;

  // Leg stride: walking and running swap which leg leads.
  const swing =
    pose === "walkA" || pose === "runA" ? 3 : pose === "walkB" || pose === "runB" ? -3 : 0;

  /* ── anything drawn BEHIND the body ─────────────────────────────────── */
  if (pose === "pressUp") drawBar(ctx, p, 2, d.plateH, d.barHalf);
  // A squat bar rests across the traps, not across the face. At shoulderY - 1
  // the plates sat level with the ears; it belongs just below the shoulder line.
  if (squatting) drawBar(ctx, p, shoulderY + 2, d.plateH, d.barHalf);

  /* ── silhouette ─────────────────────────────────────────────────────── */

  const legInner = 1;
  const legH = Math.max(4, footY - hipY - 2);
  const legL: Rect = [CX - legInner - d.legW - swing, hipY - 1, d.legW, legH];
  const legR: Rect = [CX + legInner + swing, hipY - 1, d.legW, legH];
  const bootL: Rect = [legL[0] - 1, footY - 3, d.legW + 2, 3];
  const bootR: Rect = [legR[0] - 1, footY - 3, d.legW + 2, 3];

  const waistHalf = Math.max(3, d.torsoHalf - 2 - Math.round(b * 2));
  const chest: Rect = [CX - d.torsoHalf, shoulderY, d.torsoHalf * 2, 8];
  const waist: Rect = [CX - waistHalf, shoulderY + 7, waistHalf * 2, Math.max(2, hipY - shoulderY - 6)];

  // ── arms, per exercise ────────────────────────────────────────────────
  // Every variant starts at the shoulder and stays flush to the torso, so the
  // arm never floats. Only where it ENDS changes.
  let armTop: number;
  let armBot: number;
  let armOut = d.torsoHalf;

  if (pose === "pressUp") {
    armTop = 4;
    armBot = shoulderY + 3;
    armOut = Math.min(d.torsoHalf, d.barHalf - 3);
  } else if (pose === "pressDown") {
    armTop = 15;
    armBot = shoulderY + 3;
    armOut = Math.min(d.torsoHalf, d.barHalf - 3);
  } else if (pose === "curlUp") {
    armTop = shoulderY + 2;
    armBot = shoulderY + 9;
  } else if (pose === "curlDown") {
    armTop = shoulderY + 1;
    armBot = hipY + 2;
  } else if (running) {
    // bent, pumping — one arm forward reads as the opposite leg leading
    armTop = shoulderY + (swing > 0 ? 1 : 4);
    armBot = shoulderY + (swing > 0 ? 8 : 11);
  } else {
    armTop = shoulderY + 1;
    armBot = hipY - 1;
  }

  const armH = Math.max(3, armBot - armTop);
  const armL: Rect = [CX - armOut - d.armW + 1, armTop, d.armW, armH];
  const armR: Rect = [
    CX + armOut - 1,
    running ? shoulderY + (swing > 0 ? 4 : 1) : armTop,
    d.armW,
    armH,
  ];

  const neck: Rect = [CX - 3, neckTop, 6, shoulderY - neckTop + 2];
  const head: Rect = [CX - d.headHalf, headTop, d.headHalf * 2, headBottom - headTop];

  stamp(ctx, p, [legL, legR, bootL, bootR, waist, chest, armL, armR, neck, head]);

  /* ── fills ──────────────────────────────────────────────────────────── */

  fill(ctx, p.dark, [legL, legR]);
  fill(ctx, p.outline, [bootL, bootR]);
  fill(ctx, p.skinShade, [neck]);

  fill(ctx, p.base, [chest, waist]);
  // Key light from the upper left.
  fill(ctx, p.light, [
    [chest[0], chest[1], 2, chest[3]],
    [waist[0], waist[1], 2, Math.max(1, waist[3] - 1)],
  ]);
  fill(ctx, p.dark, [
    [chest[0] + chest[2] - 2, chest[1] + 1, 2, chest[3] - 1],
    [waist[0] + waist[2] - 2, waist[1], 2, waist[3]],
  ]);
  // The singlet, so a wide chest is not one flat slab of colour.
  fill(ctx, p.dark, [[CX - 1, shoulderY + 2, 2, Math.max(2, hipY - shoulderY - 4)]]);

  fill(ctx, p.skin, [armL, armR]);
  fill(ctx, p.skinShade, [
    [armL[0] + armL[2] - 1, armL[1], 1, armL[3]],
    [armR[0] + armR[2] - 1, armR[1], 1, armR[3]],
  ]);

  fill(ctx, p.skin, [head]);
  fill(ctx, p.skinShade, [[head[0] + head[2] - 2, headTop + 4, 2, head[3] - 4]]);

  // hair — the agent's own colour, and the main thing telling two apart
  fill(ctx, p.hair, [
    [head[0], headTop, head[2], 5],
    [head[0] - 1, headTop + 2, 1, 4],
    [head[0] + head[2], headTop + 2, 1, 4],
  ]);
  fill(ctx, p.base, [[head[0] + 1, headTop, Math.max(1, head[2] - 5), 1]]);

  // face
  const eyeY = headTop + 7;
  if (straining) {
    fill(ctx, p.outline, [
      [CX - 4, eyeY + 1, 3, 1],
      [CX + 1, eyeY + 1, 3, 1],
    ]);
    fill(ctx, p.skinShade, [[CX - 2, eyeY + 4, 4, 2]]);
  } else {
    fill(ctx, p.outline, [
      [CX - 4, eyeY, 2, 2],
      [CX + 2, eyeY, 2, 2],
    ]);
    fill(ctx, p.skinShade, [[CX - 1, eyeY + 4, 3, 1]]);
  }

  /* ── anything drawn IN FRONT of the body ────────────────────────────── */
  if (pose === "pressDown") drawBar(ctx, p, 13, d.plateH, d.barHalf);
  if (curling) {
    const y = pose === "curlUp" ? armTop + 1 : armBot - 1;
    drawBell(ctx, p, armL[0] + 1, y, d.bellR);
    drawBell(ctx, p, armR[0] + d.armW - 1, y, d.bellR);
  }
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
 * Drawn rather than loaded, for the same reason as the characters, and kept to
 * a 64px tile so the rubber grain stays crisp where the floor plane repeats it.
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

  for (let i = 0; i < 220; i++) {
    const x = Math.floor(Math.random() * S);
    const y = Math.floor(Math.random() * S);
    ctx.fillStyle = i % 3 === 0 ? line : ink;
    ctx.globalAlpha = 0.35;
    ctx.fillRect(x, y, 1, 1);
  }
  ctx.globalAlpha = 1;

  ctx.strokeStyle = line;
  ctx.globalAlpha = 0.5;
  ctx.strokeRect(0.5, 0.5, S - 1, S - 1);
  ctx.globalAlpha = 1;

  return c;
}
