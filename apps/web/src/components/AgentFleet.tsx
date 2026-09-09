import { useEffect, useMemo, useRef } from "react";
import type { Agent } from "../lib/types.ts";

/**
 * The fleet, drawn as teams.
 *
 * Ported from Dominic's `agent-teams-graph.html`. The structure is the point:
 * each room is its own block with the orchestrator as a hub and its members
 * fanning below on real drawn links. The previous version put every agent in
 * one flat row, which said nothing about who works with whom and left two
 * unrelated teams interleaved alphabetically.
 *
 * The brain above each agent is a cut stone, and the orchestrator wears a
 * gauntlet with one empty socket per report. Every time a report finishes a
 * turn its stone travels up the link and seats in its socket; when the whole
 * team has reported, the setting fires and the sockets clear for the next
 * round. That is the run loop drawn literally — work only ever flows up to
 * the orchestrator, which is exactly how this system schedules turns.
 *
 * Fitted to live data rather than the mock's fixtures:
 *  - mote count per stone comes from that agent's real memory count,
 *  - socket colours are the agents' own, from their .md frontmatter,
 *  - a stone lights when its agent is actually generating, not on a timer,
 *  - stones only travel a link while that room has a run in flight.
 */

const TAU = Math.PI * 2;
const clamp = (v: number, a: number, b: number): number => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

function mulberry(seed: number): () => number {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

interface BrainNode {
  bx: number;
  by: number;
  d: number;
  ph: number;
  x: number;
  y: number;
}

/** One knuckle on an orchestrator's gauntlet: the seat for one report's stone. */
interface Socket {
  rgb: [number, number, number];
  /** What is drawn. Eased toward `target` so seating and clearing both read. */
  charge: number;
  target: number;
}

interface Brain {
  id: string;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  eyes: SVGGElement | null;
  rgb: [number, number, number];
  /** Motes suspended inside the stone. Density is the memory count. */
  nodes: BrainNode[];
  a0: number;
  hot: number;
  thot: number;
  /** Facets on the cut. The orchestrator's stone is the finer one. */
  facets: number;
  /** One per report, in member order. null on anyone who directs nobody. */
  sockets: Socket[] | null;
  /** Decays from 1 the moment every socket is full. */
  flare: number;
  /** A charge running up the stem, set when a stone seats. */
  spark: { t0: number; rgb: [number, number, number] } | null;
  look: { x: number; y: number };
  g: { w: number; h: number; cx: number; cy: number; r: number };
  measure: () => void;
  draw: (t: number) => void;
}

/** Memory count → node count. Sub-linear so a busy agent stays readable. */
function nodeCount(memories: number): number {
  return clamp(Math.round(4 + Math.pow(memories, 0.86) * 2.1), 5, 66);
}

export interface FleetRoom {
  id: string;
  name: string;
  members: string[];
  orchestratorId: string;
}

/* ── chassis ───────────────────────────────────────────────────────────── */

function Chassis({ variant, colour }: { variant: number; colour: string }) {
  const v = variant % 8;
  const halo = `${colour}22`;
  const head = [
    <rect key="h" className="bot__shell" x="26" y="26" width="74" height="58" rx="16" />,
    <rect key="h" className="bot__shell" x="28" y="24" width="70" height="60" rx="30" />,
    <path
      key="h"
      className="bot__shell"
      d="M34 26h58a10 10 0 0 1 10 10v36a10 10 0 0 1-10 10H34a10 10 0 0 1-10-10V36a10 10 0 0 1 10-10z"
    />,
    <path
      key="h"
      className="bot__shell"
      d="M26 84V52a37 37 0 0 1 74 0v32a6 6 0 0 1-6 6H32a6 6 0 0 1-6-6z"
    />,
    <path key="h" className="bot__shell" d="M63 22 96 40v32L63 88 30 72V40z" />,
    <g key="h">
      <rect className="bot__shell" x="26" y="28" width="74" height="54" rx="14" />
      <rect className="bot__soft" x="34" y="38" width="58" height="34" rx="10" />
    </g>,
    <path key="h" className="bot__shell" d="M32 26h62l8 14v30l-8 14H32l-8-14V40z" />,
    <g key="h">
      <rect className="bot__shell" x="24" y="30" width="78" height="50" rx="10" />
      <path className="bot__detail" d="M24 40h78" />
    </g>,
  ][v];

  const eyes = [
    <g key="e">
      <circle cx="49" cy="56" r="12" fill={halo} />
      <circle cx="77" cy="56" r="12" fill={halo} />
      <circle cx="49" cy="56" r="6.5" fill={colour} />
      <circle cx="77" cy="56" r="6.5" fill={colour} />
    </g>,
    <g key="e">
      <rect x="37" y="49" width="24" height="14" rx="7" fill={halo} />
      <rect x="65" y="49" width="24" height="14" rx="7" fill={halo} />
      <rect x="41" y="52" width="16" height="7" rx="3.5" fill={colour} />
      <rect x="69" y="52" width="16" height="7" rx="3.5" fill={colour} />
    </g>,
    <g key="e">
      <circle cx="49" cy="54" r="12" fill={halo} />
      <circle cx="77" cy="54" r="12" fill={halo} />
      <path d="M49 47l6 7-6 7-6-7z" fill={colour} />
      <path d="M77 47l6 7-6 7-6-7z" fill={colour} />
    </g>,
    <g key="e">
      <circle cx="49" cy="58" r="12" fill={halo} />
      <circle cx="77" cy="58" r="12" fill={halo} />
      <circle cx="49" cy="58" r="7" fill={colour} />
      <circle cx="77" cy="58" r="7" fill={colour} />
    </g>,
    <g key="e">
      <circle cx="50" cy="55" r="11" fill={halo} />
      <circle cx="76" cy="55" r="11" fill={halo} />
      <path d="M44 58a6 6 0 0 1 12 0z" fill={colour} />
      <path d="M70 58a6 6 0 0 1 12 0z" fill={colour} />
    </g>,
    <g key="e">
      <circle cx="49" cy="55" r="12" fill={halo} />
      <circle cx="77" cy="55" r="12" fill={halo} />
      <circle cx="49" cy="55" r="7" fill="none" stroke={colour} strokeWidth="2.6" />
      <circle cx="77" cy="55" r="7" fill="none" stroke={colour} strokeWidth="2.6" />
    </g>,
    <g key="e">
      <circle cx="50" cy="55" r="11" fill={halo} />
      <circle cx="76" cy="55" r="11" fill={halo} />
      <rect x="46" y="48" width="8" height="14" rx="4" fill={colour} />
      <rect x="72" y="48" width="8" height="14" rx="4" fill={colour} />
    </g>,
    <g key="e">
      <rect x="34" y="48" width="58" height="18" rx="9" fill={halo} />
      <rect x="40" y="53" width="14" height="6" rx="3" fill={colour} />
      <rect x="72" y="53" width="14" height="6" rx="3" fill={colour} />
    </g>,
  ][v];

  const antenna = [
    <g key="a">
      <path className="bot__wire" d="M63 26V8" />
      <circle cx="63" cy="6" r="2.6" fill={colour} />
    </g>,
    <path key="a" className="bot__wire" d="M52 25l-6-13M74 25l6-13" />,
    <g key="a">
      <rect className="bot__soft" x="55" y="16" width="16" height="10" rx="4" />
      <path className="bot__wire" d="M63 16v-8" />
    </g>,
    <g key="a">
      <path className="bot__wire" d="M63 15V6" />
      <circle cx="63" cy="4" r="3" fill="none" stroke={colour} strokeWidth="1.3" />
    </g>,
    <g key="a">
      <path className="bot__wire" d="M63 22V6" />
      <path className="bot__wire" d="M57 6h12" />
    </g>,
    <g key="a">
      <path className="bot__wire" d="M63 24V9" />
      <circle cx="63" cy="7" r="2.2" fill={colour} />
    </g>,
    <g key="a">
      <path className="bot__wire" d="M45 27l-4-12M81 27l4-12" />
      <circle cx="41" cy="13" r="2" fill={colour} />
      <circle cx="85" cy="13" r="2" fill={colour} />
    </g>,
    <g key="a">
      <path className="bot__wire" d="M63 28V12" />
      <rect x="59" y="6" width="8" height="6" rx="2" fill="none" className="bot__wire" />
    </g>,
  ][v];

  const panel = [
    <rect key="p" className="bot__soft" x="42" y="106" width="42" height="10" rx="5" />,
    <path key="p" className="bot__detail" d="M44 104h38M44 111h38M44 118h26" />,
    <g key="p">
      <rect className="bot__soft" x="46" y="102" width="34" height="22" rx="6" />
      <path className="bot__detail" d="M52 108h22M52 114h14" />
    </g>,
    <g key="p">
      <circle className="bot__soft" cx="63" cy="112" r="11" />
      <circle cx="63" cy="112" r="4" fill={colour} opacity=".55" />
    </g>,
    <path key="p" className="bot__detail" d="M50 104v18M63 100v22M76 104v18" />,
    <g key="p">
      <rect className="bot__soft" x="40" y="104" width="46" height="16" rx="8" />
      <circle cx="52" cy="112" r="2.4" fill={colour} opacity=".8" />
      <circle cx="63" cy="112" r="2.4" fill={colour} opacity=".55" />
      <circle cx="74" cy="112" r="2.4" fill={colour} opacity=".35" />
    </g>,
    <path key="p" className="bot__detail" d="M44 106h38l-6 12H50z" />,
    <g key="p">
      <rect className="bot__soft" x="44" y="103" width="38" height="18" rx="9" />
      <path className="bot__detail" d="M52 112h22" />
    </g>,
  ][v];

  return (
    <svg className="bot" viewBox="0 0 126 132" fill="none" aria-hidden="true">
      {antenna}
      <rect className="bot__soft" x="8" y="98" width="13" height="26" rx="6.5" />
      <rect className="bot__soft" x="105" y="98" width="13" height="26" rx="6.5" />
      <rect className="bot__soft" x="9" y="46" width="12" height="20" rx="5" />
      <rect className="bot__soft" x="105" y="46" width="12" height="20" rx="5" />
      <rect className="bot__soft" x="57" y="82" width="12" height="12" rx="3" />
      <rect className="bot__shell" x="20" y="92" width="86" height="38" rx="13" />
      {panel}
      {head}
      <g className="bot__eyes">{eyes}</g>
    </svg>
  );
}

/* ── one agent ─────────────────────────────────────────────────────────── */

function AgentCard({
  agent,
  variant,
  memories,
  lead,
  leadName,
  speaking,
  register,
}: {
  agent: Agent;
  variant: number;
  memories: number;
  lead: boolean;
  leadName: string | null;
  speaking: boolean;
  register: (id: string, brain: Brain | null) => void;
}) {
  const cardRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const card = cardRef.current;
    if (!canvas || !card) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rnd = mulberry(agent.id.length * 131 + memories * 17 + 7);
    const count = nodeCount(memories);
    const nodes: BrainNode[] = [];
    for (let k = 0; k < count; k++) {
      const ang = rnd() * TAU;
      const rr = Math.sqrt(rnd());
      nodes.push({
        bx: Math.cos(ang) * rr,
        by: Math.sin(ang) * rr * 0.95,
        d: rnd(),
        ph: rnd() * TAU,
        x: 0,
        y: 0,
      });
    }
    const brain: Brain = {
      id: agent.id,
      canvas,
      ctx,
      eyes: card.querySelector<SVGGElement>(".bot__eyes"),
      rgb: hexToRgb(agent.color),
      nodes,
      a0: rnd() * TAU,
      hot: 0,
      thot: 0,
      facets: lead ? 8 : 6,
      sockets: null,
      flare: 0,
      spark: null,
      look: { x: 0, y: 0 },
      g: { w: 0, h: 0, cx: 0, cy: 0, r: 0 },
      measure: () => {
        const r = canvas.getBoundingClientRect();
        if (!r.width) return;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = Math.round(r.width * dpr);
        canvas.height = Math.round(r.height * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        brain.g = {
          w: r.width,
          h: r.height,
          cx: r.width / 2,
          cy: r.height * 0.36,
          // Smaller than the mock's .53/.46 — Dominic asked for a smaller
          // brain. The lead gets a little back because the gauntlet's own
          // stone is only half this radius; the rest is knuckles and cuff.
          r: lead
            ? Math.min(r.width * 0.5, r.height * 0.42)
            : Math.min(r.width * 0.42, r.height * 0.36),
        };
      },
      draw: (t: number) => {
        const g = brain.g;
        if (!g.w) return;
        const cx = g.cx;
        const cy = g.cy;
        const hot = brain.hot;
        ctx.clearRect(0, 0, g.w, g.h);

        brain.flare = Math.max(0, brain.flare - 0.011);
        const flare = brain.flare;
        const breathe = 0.5 + 0.5 * Math.sin(t * 1.05 + brain.a0);
        const rot = t * 0.1 + brain.a0;
        const light = t * 0.55 + brain.a0;

        const trace = (pts: Array<[number, number]>): void => {
          ctx.beginPath();
          pts.forEach((q, i) => (i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])));
          ctx.closePath();
        };

        /**
         * One cut stone. The same routine draws an agent's own memory and the
         * orchestrator's, so a seated stone is visibly the same object that
         * travelled up the link.
         */
        const gem = (
          gx: number,
          gy: number,
          gr: number,
          facets: number,
          col: [number, number, number],
          motes: BrainNode[] | null,
          boost: number,
        ): void => {
          const [r0, g0, b0] = col;
          const out: Array<[number, number]> = [];
          const inn: Array<[number, number]> = [];
          for (let i = 0; i < facets; i++) {
            const a = rot + (i / facets) * TAU;
            const b = rot + ((i + 0.5) / facets) * TAU;
            out.push([gx + Math.cos(a) * gr, gy + Math.sin(a) * gr * 0.98]);
            inn.push([gx + Math.cos(b) * gr * 0.44, gy + Math.sin(b) * gr * 0.44 * 0.98]);
          }

          const bl = ctx.createRadialGradient(gx, gy, gr * 0.15, gx, gy, gr * 1.8);
          bl.addColorStop(0, `rgba(${r0},${g0},${b0},${0.2 + breathe * 0.08 + boost})`);
          bl.addColorStop(0.45, `rgba(${r0},${g0},${b0},${0.07 + boost * 0.5})`);
          bl.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
          ctx.fillStyle = bl;
          ctx.beginPath();
          ctx.arc(gx, gy, gr * 1.8, 0, TAU);
          ctx.fill();

          trace(out);
          const bd = ctx.createRadialGradient(gx, gy, gr * 0.04, gx, gy, gr);
          bd.addColorStop(0, `rgba(255,255,255,${0.26 + breathe * 0.12 + boost})`);
          bd.addColorStop(0.38, `rgba(${r0},${g0},${b0},0.46)`);
          bd.addColorStop(1, `rgba(${r0},${g0},${b0},0.15)`);
          ctx.fillStyle = bd;
          ctx.fill();

          // Facets catch a light that travels round the stone, so a still
          // agent still reads as a solid object rather than a flat polygon.
          for (let i = 0; i < facets; i++) {
            const tip = out[i]!;
            const a = inn[i]!;
            const b = inn[(i - 1 + facets) % facets]!;
            ctx.beginPath();
            ctx.moveTo(b[0], b[1]);
            ctx.lineTo(tip[0], tip[1]);
            ctx.lineTo(a[0], a[1]);
            ctx.closePath();
            const lit = Math.max(0, Math.cos(rot + (i / facets) * TAU - light));
            ctx.fillStyle = `rgba(255,255,255,${0.02 + lit * lit * 0.16 + boost * 0.35})`;
            ctx.fill();
            ctx.strokeStyle = `rgba(${r0},${g0},${b0},${0.22 + lit * 0.45})`;
            ctx.lineWidth = 0.85;
            ctx.stroke();
          }

          if (motes) {
            ctx.save();
            trace(out);
            ctx.clip();
            ctx.globalCompositeOperation = "lighter";
            const cs = Math.cos(rot * 1.6);
            const sn = Math.sin(rot * 1.6);
            for (const n of motes) {
              n.x = gx + (n.bx * cs - n.by * sn) * gr * 0.86;
              n.y = gy + (n.bx * sn + n.by * cs) * gr * 0.84;
              const tw = 0.5 + 0.5 * Math.sin(t * 2.2 + n.ph);
              ctx.fillStyle = `rgba(255,${Math.min(255, g0 + 70)},${Math.min(255, b0 + 70)},${0.2 + tw * 0.42 + boost})`;
              ctx.beginPath();
              ctx.arc(n.x, n.y, 0.8 + n.d * 1.5 + tw * 0.7, 0, TAU);
              ctx.fill();
            }
            ctx.globalCompositeOperation = "source-over";
            ctx.restore();
          }

          trace(inn);
          const tb = ctx.createRadialGradient(gx, gy, 1, gx, gy, gr * 0.48);
          tb.addColorStop(0, `rgba(255,255,255,${0.55 + breathe * 0.28 + boost})`);
          tb.addColorStop(0.5, `rgba(${r0},${g0},${b0},0.58)`);
          tb.addColorStop(1, `rgba(${r0},${g0},${b0},0.18)`);
          ctx.fillStyle = tb;
          ctx.fill();
          ctx.strokeStyle = `rgba(255,255,255,${0.18 + hot * 0.22})`;
          ctx.lineWidth = 0.9;
          ctx.stroke();

          const co = ctx.createRadialGradient(gx, gy, 0, gx, gy, gr * 0.28 + boost * gr * 0.5);
          co.addColorStop(0, `rgba(255,255,255,${0.8 + breathe * 0.2})`);
          co.addColorStop(0.45, `rgba(${r0},${g0},${b0},0.55)`);
          co.addColorStop(1, `rgba(${r0},${g0},${b0},0)`);
          ctx.fillStyle = co;
          ctx.beginPath();
          ctx.arc(gx, gy, gr * 0.28 + boost * gr * 0.5, 0, TAU);
          ctx.fill();

          trace(out);
          ctx.strokeStyle = `rgba(255,255,255,${0.3 + hot * 0.32 + boost})`;
          ctx.lineWidth = 1.3;
          ctx.stroke();
        };

        /** The stem down to the bot, and the charge that runs up it. */
        const stem = (y0: number, col: [number, number, number]): void => {
          const [r0, g0, b0] = col;
          ctx.strokeStyle = `rgba(${r0},${g0},${b0},${0.32 + hot * 0.3})`;
          ctx.lineWidth = 1.1;
          ctx.beginPath();
          ctx.moveTo(cx, y0);
          ctx.lineTo(cx, g.h);
          ctx.stroke();
          if (brain.spark && t - brain.spark.t0 < 0.55) {
            const p = (t - brain.spark.t0) / 0.55;
            const y = lerp(g.h, y0, p);
            const [pr, pg, pb] = brain.spark.rgb;
            ctx.strokeStyle = `rgba(${pr},${pg},${pb},${1 - p})`;
            ctx.lineWidth = 2.4;
            ctx.beginPath();
            ctx.moveTo(cx, Math.min(g.h, y + 11));
            ctx.lineTo(cx, y);
            ctx.stroke();
            ctx.fillStyle = `rgba(${pr},${pg},${pb},${1 - p})`;
            ctx.beginPath();
            ctx.arc(cx, y, 2.6, 0, TAU);
            ctx.fill();
          }
        };

        // ── an agent: the stone alone ──────────────────────────────────────
        if (!brain.sockets) {
          gem(cx, cy, g.r, brain.facets, brain.rgb, brain.nodes, hot * 0.16);
          stem(cy + g.r * 0.98 + 3, brain.rgb);
          return;
        }

        // ── the orchestrator: a gauntlet holding every report's stone ──────
        const S = g.r * 0.58;
        const sockets = brain.sockets;
        const n = sockets.length;

        const plate = (
          x: number, y: number, w: number, h: number, rT: number, rB: number,
        ): void => {
          ctx.beginPath();
          ctx.moveTo(x + rT, y);
          ctx.lineTo(x + w - rT, y);
          ctx.quadraticCurveTo(x + w, y, x + w, y + rT);
          ctx.lineTo(x + w, y + h - rB);
          ctx.quadraticCurveTo(x + w, y + h, x + w - rB, y + h);
          ctx.lineTo(x + rB, y + h);
          ctx.quadraticCurveTo(x, y + h, x, y + h - rB);
          ctx.lineTo(x, y + rT);
          ctx.quadraticCurveTo(x, y, x + rT, y);
          ctx.closePath();
        };
        const brass = (y0: number, y1: number, lift: number): CanvasGradient => {
          const gr = ctx.createLinearGradient(0, y0, 0, y1);
          gr.addColorStop(0, `rgba(226,194,128,${0.32 + lift + flare * 0.45})`);
          gr.addColorStop(0.42, `rgba(132,100,52,${0.62 + flare * 0.3})`);
          gr.addColorStop(1, "rgba(50,37,20,.9)");
          return gr;
        };
        const edge = (a: number): string => `rgba(238,208,148,${a})`;

        const amb = ctx.createRadialGradient(cx, cy, S * 0.2, cx, cy, S * 2.2);
        amb.addColorStop(0, `rgba(${brain.rgb[0]},${brain.rgb[1]},${brain.rgb[2]},${0.12 + flare * 0.35})`);
        amb.addColorStop(1, `rgba(${brain.rgb[0]},${brain.rgb[1]},${brain.rgb[2]},0)`);
        ctx.fillStyle = amb;
        ctx.beginPath();
        ctx.arc(cx, cy, S * 2.2, 0, TAU);
        ctx.fill();

        // wrist cuff
        plate(cx - S * 0.74, cy + S * 0.96, S * 1.48, S * 0.44, S * 0.12, S * 0.2);
        ctx.fillStyle = brass(cy + S * 0.96, cy + S * 1.4, 0);
        ctx.fill();
        ctx.strokeStyle = edge(0.32 + flare * 0.4);
        ctx.lineWidth = 1;
        ctx.stroke();
        for (let i = -1; i <= 1; i++) {
          ctx.fillStyle = edge(0.28);
          ctx.beginPath();
          ctx.arc(cx + i * S * 0.42, cy + S * 1.18, S * 0.05, 0, TAU);
          ctx.fill();
        }

        // back plate of the hand
        plate(cx - S * 0.88, cy - S * 0.52, S * 1.76, S * 1.52, S * 0.3, S * 0.36);
        ctx.fillStyle = brass(cy - S * 0.52, cy + S, 0.06);
        ctx.fill();
        ctx.strokeStyle = edge(0.38 + flare * 0.4);
        ctx.lineWidth = 1.2;
        ctx.stroke();
        ctx.strokeStyle = edge(0.14);
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        ctx.moveTo(cx - S * 0.7, cy + S * 0.74);
        ctx.lineTo(cx + S * 0.7, cy + S * 0.74);
        ctx.stroke();

        // knuckles — one plate and one socket per report
        sockets.forEach((sk, i) => {
          sk.charge = lerp(sk.charge, sk.target, 0.08);
          const u = n === 1 ? 0 : (i / (n - 1) - 0.5) * 2;
          const kx = cx + u * S * 0.94;
          const ky = cy - S * 1.02 + u * u * S * 0.3;
          const kw = S * 0.42;
          const kh = S * 0.68;
          const ch = sk.charge;
          const [sr, sg, sb] = sk.rgb;
          const sy = ky - kh * 0.06;

          if (ch > 0.03) {
            // a seated stone feeding the setting below it
            const fg = ctx.createLinearGradient(kx, sy, cx, cy + S * 0.12);
            fg.addColorStop(0, `rgba(${sr},${sg},${sb},${ch * 0.5})`);
            fg.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
            ctx.strokeStyle = fg;
            ctx.lineWidth = 1.4;
            ctx.beginPath();
            ctx.moveTo(kx, sy);
            ctx.lineTo(cx, cy + S * 0.12);
            ctx.stroke();
          }

          ctx.save();
          ctx.translate(kx, ky);
          ctx.rotate(u * 0.2);
          plate(-kw / 2, -kh / 2, kw, kh, kw * 0.46, kw * 0.3);
          ctx.fillStyle = brass(ky - kh / 2, ky + kh / 2, 0.05);
          ctx.fill();
          ctx.strokeStyle = edge(0.34 + ch * 0.4);
          ctx.lineWidth = 1;
          ctx.stroke();
          ctx.restore();

          if (ch > 0.02) {
            const sgd = ctx.createRadialGradient(kx, sy, 0, kx, sy, kw * 0.95);
            sgd.addColorStop(0, `rgba(${sr},${sg},${sb},${ch * 0.55})`);
            sgd.addColorStop(1, `rgba(${sr},${sg},${sb},0)`);
            ctx.fillStyle = sgd;
            ctx.beginPath();
            ctx.arc(kx, sy, kw * 0.95, 0, TAU);
            ctx.fill();
          }
          ctx.strokeStyle = edge(0.26 + ch * 0.45);
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.arc(kx, sy, kw * 0.34, 0, TAU);
          ctx.stroke();

          const gs = kw * 0.13 + ch * kw * 0.2;
          ctx.beginPath();
          ctx.moveTo(kx, sy - gs);
          ctx.lineTo(kx + gs, sy);
          ctx.lineTo(kx, sy + gs);
          ctx.lineTo(kx - gs, sy);
          ctx.closePath();
          ctx.fillStyle = `rgba(${sr},${sg},${sb},${0.14 + ch * 0.82})`;
          ctx.fill();
          if (ch > 0.45) {
            ctx.strokeStyle = `rgba(255,255,255,${(ch - 0.45) * 0.8})`;
            ctx.lineWidth = 0.7;
            ctx.stroke();
          }
        });

        // prongs gripping the orchestrator's own stone
        const gr0 = S * 0.5;
        const gy0 = cy + S * 0.12;
        ctx.lineCap = "round";
        for (let i = 0; i < 6; i++) {
          const a = rot * 0.4 + (i / 6) * TAU;
          ctx.strokeStyle = edge(0.32 + flare * 0.4);
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(cx + Math.cos(a) * gr0 * 1.18, gy0 + Math.sin(a) * gr0 * 1.18);
          ctx.lineTo(cx + Math.cos(a) * gr0 * 0.88, gy0 + Math.sin(a) * gr0 * 0.88);
          ctx.stroke();
        }
        ctx.lineCap = "butt";
        gem(cx, gy0, gr0, brain.facets, brain.rgb, brain.nodes, hot * 0.16 + flare * 0.55);

        if (flare > 0) {
          ctx.strokeStyle = `rgba(255,255,255,${flare * 0.55})`;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.arc(cx, cy, S * 0.9 + (1 - flare) * S * 1.6, 0, TAU);
          ctx.stroke();
        }
        stem(cy + S * 1.4, brain.rgb);
      },
    };

    brain.measure();
    register(agent.id, brain);
    const ro = new ResizeObserver(() => brain.measure());
    ro.observe(canvas);

    const onMove = (e: PointerEvent): void => {
      const r = card.getBoundingClientRect();
      brain.look.x = clamp((e.clientX - (r.left + r.width / 2)) / 70, -1, 1);
      brain.look.y = clamp((e.clientY - (r.top + r.height * 0.5)) / 90, -1, 1);
    };
    card.addEventListener("pointermove", onMove);

    return () => {
      ro.disconnect();
      card.removeEventListener("pointermove", onMove);
      register(agent.id, null);
    };
  }, [agent.id, agent.color, memories, lead, register]);

  return (
    <div
      className={`agentcard${lead ? " agentcard--lead" : ""}${speaking ? " agentcard--live" : ""}`}
      ref={cardRef}
    >
      <div className="agentcard__stage">
        <canvas ref={canvasRef} />
        <Chassis variant={variant} colour={agent.color} />
      </div>
      <div className="agentcard__id">
        <span className="agentcard__nm">{agent.name}</span>
        <span className="agentcard__role">{agent.role}</span>
        <span className="agentcard__mem" style={{ color: agent.color }}>
          <b>{memories}</b>
          <span>{memories === 1 ? "memory" : "memories"}</span>
        </span>
      </div>
      <span className="agentcard__reports">
        {lead ? "directs this room" : `reports to ${leadName ?? "—"}`}
      </span>
    </div>
  );
}

/* ── the fleet ─────────────────────────────────────────────────────────── */

/**
 * One stone travelling up its link to the orchestrator.
 *
 * There is no downward packet any more, and that is not a simplification —
 * it is what actually happens. Every turn in this system ends by handing a
 * result back to the orchestrator, which is the only participant that ever
 * decides what happens next. Drawing an instruction flowing back down would
 * be inventing a second channel the run loop does not have.
 */
interface Signal {
  member: number;
  t0: number;
  dur: number;
  /** A real finished turn, versus ambient chatter while the room works. */
  strong: boolean;
}

export function AgentFleet({
  agents,
  rooms,
  memories,
  speaking,
  activeRooms,
  connected,
}: {
  agents: Agent[];
  rooms: FleetRoom[];
  memories: Map<string, number>;
  speaking: string | null;
  /** Room ids with a run in flight — the rooms that should look busy. */
  activeRooms: Set<string>;
  connected: boolean;
}) {
  const brains = useRef<Map<string, Brain>>(new Map());
  const hostRef = useRef<HTMLDivElement>(null);
  const teamRefs = useRef<Map<string, HTMLElement>>(new Map());
  /** Last speaker per room, so a change can be animated as a handoff. */
  const prevSpeaker = useRef<Map<string, string | null>>(new Map());

  const register = useMemo(
    () => (id: string, brain: Brain | null) => {
      if (brain) brains.current.set(id, brain);
      else brains.current.delete(id);
    },
    [],
  );

  const byId = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);

  const teams = useMemo(
    () =>
      rooms
        .map((room) => {
          const lead = byId.get(room.orchestratorId) ?? null;
          const members = room.members
            .filter((id) => id !== room.orchestratorId)
            .map((id) => byId.get(id))
            .filter((a): a is Agent => a !== undefined);
          const total =
            (lead ? (memories.get(lead.id) ?? 0) : 0) +
            members.reduce((n, m) => n + (memories.get(m.id) ?? 0), 0);
          return { room, lead, members, total };
        })
        .filter((t) => t.lead !== null),
    [rooms, byId, memories],
  );

  // One loop drives every brain and every team's link traffic.
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const layout = (): void => {
      for (const team of teams) {
        const sec = teamRefs.current.get(team.room.id);
        if (!sec) continue;
        const svg = sec.querySelector<SVGSVGElement>(".team__links");
        const leadEl = sec.querySelector<HTMLElement>(".agentcard--lead");
        if (!svg || !leadEl) continue;
        const box = sec.getBoundingClientRect();
        svg.setAttribute("viewBox", `0 0 ${box.width} ${box.height}`);
        const lb = leadEl.getBoundingClientRect();
        const x1 = lb.left - box.left + lb.width / 2;
        const y1 = lb.bottom - box.top - 6;
        const kids = sec.querySelectorAll<HTMLElement>(".team__members .agentcard");
        const paths = svg.querySelectorAll<SVGPathElement>("path");
        kids.forEach((kid, i) => {
          const path = paths[i];
          if (!path) return;
          const kb = kid.getBoundingClientRect();
          const x2 = kb.left - box.left + kb.width / 2;
          const y2 = kb.top - box.top + 6;
          const k1 = clamp((y2 - y1) * 0.55, 26, 80);
          path.setAttribute("d", `M ${x1} ${y1} C ${x1} ${y1 + k1}, ${x2} ${y2 - k1}, ${x2} ${y2}`);
        });
      }
    };

    const refresh = (): void => {
      for (const b of brains.current.values()) b.measure();
      layout();
    };

    refresh();
    const t0 = setTimeout(refresh, 200);
    window.addEventListener("resize", refresh);
    const ro = hostRef.current ? new ResizeObserver(layout) : null;
    if (ro && hostRef.current) ro.observe(hostRef.current);

    const signals = new Map<string, Signal[]>();
    const next = new Map<string, number>();

    let raf = 0;
    const frame = (now: number): void => {
      raf = requestAnimationFrame(frame);
      const t = now / 1000;

      for (const b of brains.current.values()) {
        b.thot = b.id === speaking ? 1 : 0;
        b.hot = lerp(b.hot, b.thot, 0.09);
        b.look.x = lerp(b.look.x, b.thot ? b.look.x : 0, 0.12);
        if (b.eyes) {
          b.eyes.style.transform = `translate(${(b.look.x * 3).toFixed(2)}px, ${(b.look.y * 2.2).toFixed(2)}px)`;
        }
        b.draw(t);
      }

      for (const team of teams) {
        const sec = teamRefs.current.get(team.room.id);
        if (!sec) continue;
        const busy = activeRooms.has(team.room.id);
        const list = signals.get(team.room.id) ?? [];
        signals.set(team.room.id, list);

        // A finished turn: the baton just passed back through the
        // orchestrator, so that agent's stone is on its way up to the socket
        // waiting for it. Nothing travels agent-to-agent in this system.
        const prev = prevSpeaker.current.get(team.room.id) ?? null;
        if (busy && speaking !== prev) {
          const from = team.members.findIndex((m) => m.id === prev);
          if (from >= 0) list.push({ member: from, t0: t, dur: 0.9, strong: true });
          prevSpeaker.current.set(team.room.id, speaking);
        }
        if (!busy && prev !== null) prevSpeaker.current.set(team.room.id, null);

        const leadBrain = brains.current.get(team.lead!.id);
        // Sockets are rebuilt whenever the roster changes, so a member added
        // or removed does not leave a stale seat charged on the gauntlet.
        if (leadBrain && leadBrain.sockets?.length !== team.members.length) {
          // An orchestrator with nobody to direct is drawn as a plain stone,
          // not an empty gauntlet — a hand of unfilled sockets would read as
          // \"waiting on five reports\" in a room that has none.
          leadBrain.sockets =
            team.members.length === 0
              ? null
              : team.members.map((m) => ({ rgb: hexToRgb(m.color), charge: 0, target: 0 }));
        }
        const sockets = leadBrain?.sockets ?? null;

        // Ambient chatter while the room works, so a long turn still reads as
        // a room thinking rather than a frozen diagram. Only agents whose seat
        // is still empty send — a filled socket has already had its say.
        if (busy && sockets && t > (next.get(team.room.id) ?? 0)) {
          next.set(team.room.id, t + 0.5 + Math.random() * 0.5);
          const free = sockets
            .map((sk, i) => i)
            .filter((i) => sockets[i]!.target < 0.5 && !list.some((sig) => sig.member === i));
          if (free.length) {
            list.push({
              member: free[Math.floor(Math.random() * free.length)]!,
              t0: t,
              dur: 1 + Math.random() * 0.4,
              strong: false,
            });
          }
        }
        // A room that stops working clears its gauntlet rather than holding a
        // half-full set forever.
        if (!busy && sockets) for (const sk of sockets) sk.target = 0;

        const svg = sec.querySelector<SVGSVGElement>(".team__links");
        const paths = svg?.querySelectorAll<SVGPathElement>("path");
        const dots = svg?.querySelectorAll<SVGCircleElement>(".team__dot");
        const halos = svg?.querySelectorAll<SVGCircleElement>(".team__halo");
        if (!paths || !dots || !halos) continue;

        // Links themselves warm up while the room is working.
        paths.forEach((path, i) => {
          const onDuty = busy && team.members[i]?.id === speaking;
          path.setAttribute("stroke-opacity", busy ? (onDuty ? "1" : "0.55") : "0.35");
          path.setAttribute("stroke-width", onDuty ? "1.8" : "1.2");
        });

        for (let sIdx = list.length - 1; sIdx >= 0; sIdx--) {
          const sig = list[sIdx]!;
          if (t < sig.t0) continue;
          const p = (t - sig.t0) / sig.dur;
          const dot = dots[sig.member];
          const halo = halos[sig.member];
          const path = paths[sig.member];
          if (!dot || !halo || !path || !path.getAttribute("d")) {
            list.splice(sIdx, 1);
            continue;
          }
          if (p >= 1) {
            // The stone seats. The socket lights and a charge runs up the
            // orchestrator's stem to say the result landed.
            list.splice(sIdx, 1);
            dot.setAttribute("opacity", "0");
            halo.setAttribute("opacity", "0");
            const sk = sockets?.[sig.member];
            if (sk && leadBrain) {
              sk.target = 1;
              leadBrain.spark = { t0: t, rgb: sk.rgb };
            }
            continue;
          }
          const L = path.getTotalLength();
          if (!L) continue;
          // 1 - p: the path is drawn orchestrator → member, so travelling up
          // means walking it backwards.
          const pt = path.getPointAtLength(L * (1 - p));
          const colour = team.members[sig.member]?.color ?? team.lead!.color;
          const a = Math.min(1, Math.sin(p * Math.PI) * 1.7) * (sig.strong ? 1 : 0.6);
          dot.setAttribute("cx", String(pt.x));
          dot.setAttribute("cy", String(pt.y));
          dot.setAttribute("r", sig.strong ? "3.4" : "2.4");
          dot.setAttribute("fill", colour);
          dot.setAttribute("opacity", String(a));
          halo.setAttribute("cx", String(pt.x));
          halo.setAttribute("cy", String(pt.y));
          halo.setAttribute("fill", colour);
          halo.setAttribute("opacity", String(a * 0.22));
        }

        // Every report in: the setting fires and the sockets clear for the
        // next round. `charge` not `target`, so the flare waits for the last
        // stone to finish easing in rather than firing on intent.
        if (sockets && sockets.length > 0 && leadBrain && !leadBrain.flare) {
          if (sockets.every((sk) => sk.charge > 0.93)) {
            leadBrain.flare = 1;
            for (const sk of sockets) sk.target = 0;
            next.set(team.room.id, t + 2);
          }
        }
      }
    };

    if (reduced) refresh();
    else raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t0);
      window.removeEventListener("resize", refresh);
      ro?.disconnect();
    };
  }, [teams, speaking, activeRooms]);

  let variant = 0;
  return (
    <div className={`fleet${connected ? "" : " fleet--off"}`} ref={hostRef}>
      <div className="fleetkey">
        <span>
          <i style={{ background: "rgba(255,255,255,.22)" }} />
          reports to
        </span>
        <span>
          <i style={{ background: "#F0B429" }} />
          stone in transit
        </span>
        <span>
          <i style={{ background: "#FFFFFF" }} />
          every report in
        </span>
        <span className="fleetkey__note">stone density is the memory count</span>
      </div>

      {teams.map((team) => {
        const leadColour = team.lead!.color;
        return (
          <section
            className={`team${activeRooms.has(team.room.id) ? " team--busy" : ""}`}
            key={team.room.id}
            ref={(el) => {
              if (el) teamRefs.current.set(team.room.id, el);
              else teamRefs.current.delete(team.room.id);
            }}
          >
            <div className="team__head">
              <span className="team__swatch" style={{ background: leadColour }} />
              <span>{team.room.name}</span>
              <span className="team__rule" />
              <span>
                {activeRooms.has(team.room.id) ? (
                  <span className="team__busy">working</span>
                ) : null}
                {team.members.length + 1} agents · {team.total} memories
              </span>
            </div>

            <svg className="team__links" aria-hidden="true">
              {team.members.map((m) => (
                <path key={`p-${m.id}`} />
              ))}
              {/* Halo first so the dot rides on top of its own bloom. Both are
                  queried by class, so the two groups must not be interleaved. */}
              {team.members.map((m) => (
                <circle className="team__halo" key={`h-${m.id}`} r="7" opacity="0" />
              ))}
              {team.members.map((m) => (
                <circle
                  className="team__dot"
                  key={`d-${m.id}`}
                  r="3"
                  opacity="0"
                  fill={m.color}
                />
              ))}
            </svg>

            <div className="team__hub">
              <AgentCard
                agent={team.lead!}
                variant={variant++}
                memories={memories.get(team.lead!.id) ?? 0}
                lead
                leadName={null}
                speaking={speaking === team.lead!.id}
                register={register}
              />
            </div>

            <div className="team__members">
              {team.members.map((m) => (
                <AgentCard
                  key={m.id}
                  agent={m}
                  variant={variant++}
                  memories={memories.get(m.id) ?? 0}
                  lead={false}
                  leadName={team.lead!.name}
                  speaking={speaking === m.id}
                  register={register}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
