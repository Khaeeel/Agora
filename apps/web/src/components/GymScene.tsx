import { useEffect, useRef } from "react";
import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { Agent, AgentMemory, AgentStatus } from "../lib/types.ts";
import { bulkOf, compactCount, tierOf } from "../lib/memory.ts";
import { SPRITE_H, SPRITE_W, characterCanvas, matCanvas, type Pose } from "../lib/spriteArt.ts";

/**
 * The gym floor, HD-2D.
 *
 * HD-2D means one specific thing: hand-pixelled 2D sprites standing inside a
 * lit 3D diorama, shot on a long lens so the set reads as a model on a table.
 * Three parts, and dropping any one of them loses the look —
 *
 *   1. the characters are sprites, drawn pixel by pixel (see spriteArt.ts) and
 *      magnified with a nearest filter, never 3D models;
 *   2. the set is real 3D geometry with real lights and real shadows;
 *   3. bloom and a tilt-shift blur sell the miniature.
 *
 * The set is built from primitives rather than downloaded. Meshy's free models
 * ship with no stated licence, which is a fine risk to take on a sketch and the
 * wrong one to bake into a tool that gets shared.
 *
 * Every visual choice is also a reading of live state, not decoration:
 *   - a character's SIZE is that agent's accumulated memory;
 *   - a character being ON their platform means that agent is mid-turn;
 *   - a station's LIGHT rises with the agent working at it, so the lit corner of
 *     the room is where the work is happening.
 */

/* ── stage ─────────────────────────────────────────────────────────────── */

/*
 * The room and the layout are separate numbers on purpose.
 *
 * They were the same one, and that coupled two things that want to move in
 * opposite directions: the camera frames the CAST, so the room has to be large
 * enough that its far edge is never in shot — but if the station spacing is
 * derived from the room size, making the room bigger also flings the characters
 * apart. Splitting them means the set can be oversized and the cast stays tight.
 */
const FLOOR_W = 74;
const FLOOR_D = 64;
/** Distance between neighbouring stations, in world units. */
const CELL_X = 11;
const CELL_Z = 10.5;
/** A sprite is 44 art pixels tall and stands this many world units. */
const CHAR_H = 2.8;
const CHAR_W = (SPRITE_W / SPRITE_H) * CHAR_H;

type Kind = "bench" | "squat" | "dumbbell" | "tread";
const KINDS: Kind[] = ["squat", "bench", "tread", "dumbbell", "squat", "bench", "tread", "dumbbell", "squat"];

interface Station {
  x: number;
  z: number;
  kind: Kind;
  light: THREE.PointLight;
}

interface Actor {
  id: string;
  name: string;
  color: string;
  bulk: number;
  sprite: THREE.Sprite;
  textures: Record<Pose, THREE.Texture>;
  station: Station;
  /** Where the character rests when not working. */
  restX: number;
  restZ: number;
  /** 0 at the rest spot, 1 at the platform. */
  t: number;
  phase: number;
  label: HTMLDivElement;
}

/**
 * Tilt-shift and vignette in one pass.
 *
 * This is what turns "a 3D room" into "a model of a room". The blur is a cheap
 * nine-tap vertical smear whose radius grows with distance from a horizontal
 * focus band — the same trick a tilt-shift lens plays, and the reason miniature
 * photography reads as miniature.
 */
const TiltShift = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    focus: { value: 0.5 },
    span: { value: 0.3 },
    strength: { value: 0.0013 },
    vignette: { value: 0.72 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float focus;
    uniform float span;
    uniform float strength;
    uniform float vignette;
    varying vec2 vUv;

    void main() {
      float d = clamp((abs(vUv.y - focus) - span) / (1.0 - span), 0.0, 1.0);
      float r = d * d * strength * 40.0;

      vec4 sum = vec4(0.0);
      sum += texture2D(tDiffuse, vUv + vec2(0.0, -4.0 * r)) * 0.051;
      sum += texture2D(tDiffuse, vUv + vec2(0.0, -3.0 * r)) * 0.0918;
      sum += texture2D(tDiffuse, vUv + vec2(0.0, -2.0 * r)) * 0.12245;
      sum += texture2D(tDiffuse, vUv + vec2(0.0, -1.0 * r)) * 0.1531;
      sum += texture2D(tDiffuse, vUv) * 0.1633;
      sum += texture2D(tDiffuse, vUv + vec2(0.0,  1.0 * r)) * 0.1531;
      sum += texture2D(tDiffuse, vUv + vec2(0.0,  2.0 * r)) * 0.12245;
      sum += texture2D(tDiffuse, vUv + vec2(0.0,  3.0 * r)) * 0.0918;
      sum += texture2D(tDiffuse, vUv + vec2(0.0,  4.0 * r)) * 0.051;

      vec2 p = vUv - 0.5;
      float v = smoothstep(0.85, vignette * 0.35, length(p));
      gl_FragColor = vec4(sum.rgb * mix(0.55, 1.0, v), sum.a);
    }
  `,
};

/** One machine, from primitives. Metal frame, coloured pads, real shadows. */
function buildStation(kind: Kind, frame: THREE.Material, pad: THREE.Material): THREE.Group {
  const g = new THREE.Group();
  const post = (x: number, h: number, z = 0): THREE.Mesh => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.28, h, 0.28), frame);
    m.position.set(x, h / 2, z);
    m.castShadow = true;
    return m;
  };

  if (kind === "bench") {
    const seat = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.3, 4.2), pad);
    seat.position.y = 1.2;
    seat.castShadow = true;
    seat.receiveShadow = true;
    g.add(seat, post(-0.5, 1.2, -1.7), post(0.5, 1.2, 1.7));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.09, 4.6, 8), frame);
    b.rotation.z = Math.PI / 2;
    b.position.set(0, 2.6, -1.5);
    b.castShadow = true;
    g.add(b, post(-2, 2.6, -1.5), post(2, 2.6, -1.5));
  } else if (kind === "squat") {
    g.add(post(-2.1, 4.4), post(2.1, 4.4), post(-2.1, 4.4, -1.4), post(2.1, 4.4, -1.4));
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 5.4, 8), frame);
    b.rotation.z = Math.PI / 2;
    b.position.y = 3.6;
    b.castShadow = true;
    g.add(b);
    const top = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 0.24), frame);
    top.position.y = 4.4;
    g.add(top);
  } else if (kind === "dumbbell") {
    const rack = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.28, 1.1), frame);
    rack.position.y = 1.1;
    rack.castShadow = true;
    g.add(rack, post(-2, 1.1), post(2, 1.1));
    for (let i = 0; i < 4; i++) {
      const d = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.26, 1.0, 8), pad);
      d.rotation.z = Math.PI / 2;
      d.position.set(-1.6 + i * 1.05, 1.45, 0);
      d.castShadow = true;
      g.add(d);
    }
  } else {
    const belt = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.3, 3.6), pad);
    belt.position.y = 0.6;
    belt.castShadow = true;
    belt.receiveShadow = true;
    g.add(belt);
    const console_ = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.1, 0.22), frame);
    console_.position.set(0, 2.3, -1.8);
    console_.castShadow = true;
    g.add(console_, post(-0.9, 2.3, -1.8), post(0.9, 2.3, -1.8));
  }
  return g;
}

/**
 * How many columns to lay the cast out in.
 *
 * Headcount alone is not enough. The same five agents go into a 920px-wide view
 * and a 348px-wide sidebar, and three columns in the narrow one forces the
 * camera so far back to fit the width that the characters become specks with
 * empty floor above and below them. A tall box gets a tall arrangement.
 */
function columnsFor(n: number, aspect: number): number {
  if (n <= 1) return 1;
  if (aspect < 0.95) return n <= 4 ? 1 : 2;
  return n <= 4 ? 2 : 3;
}

/** Stations on a grid that sizes itself to the cast and to the viewport. */
function stationSpots(n: number, aspect: number): Array<{ x: number; z: number }> {
  const cols = columnsFor(n, aspect);
  const rows = Math.max(1, Math.ceil(n / cols));
  const out: Array<{ x: number; z: number }> = [];
  for (let i = 0; i < n; i++) {
    const r = Math.floor(i / cols);
    const c = i % cols;
    // A short last row is centred under the ones above it rather than left-aligned.
    const inRow = Math.min(cols, n - r * cols);
    out.push({
      x: (c - (inRow - 1) / 2) * CELL_X,
      z: (r - (rows - 1) / 2) * CELL_Z,
    });
  }
  return out;
}

export function GymScene({
  members,
  agents,
  statuses,
  memory,
  roomName,
  compact = false,
}: {
  members: string[];
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
  memory: Record<string, AgentMemory>;
  roomName: string;
  /** Sidebar mode: no HUD (the panel header already says it), smaller labels. */
  compact?: boolean;
}) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  // Status changes every few seconds. Rebuilding a WebGL scene that often would
  // drop every light and texture on the floor, so the loop reads the latest
  // props from here instead of taking them as effect dependencies.
  const liveRef = useRef({ members, agents, statuses, memory });
  liveRef.current = { members, agents, statuses, memory };

  useEffect(() => {
    const mount = mountRef.current;
    const overlay = overlayRef.current;
    if (!mount || !overlay) return;

    const css = getComputedStyle(mount);
    const tok = (n: string, f: string): string => css.getPropertyValue(n).trim() || f;
    const VOID = new THREE.Color(tok("--void", "#06080f"));
    const PANEL = new THREE.Color(tok("--panel", "#0b0f1c"));
    const EDGE = new THREE.Color(tok("--edge-hot", "#2e3a57"));
    const ACCENT = new THREE.Color(tok("--accent", "#a78bfa"));

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    } catch {
      // No WebGL — say so rather than leaving an unexplained black rectangle.
      const note = document.createElement("p");
      note.className = "gymscene__nogl";
      note.textContent = "This browser has no WebGL, so the floor cannot draw.";
      mount.appendChild(note);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = VOID;
    scene.fog = new THREE.Fog(VOID, 62, 120);

    // A long lens is half the HD-2D read — a wide fov turns the diorama back
    // into a room you are standing in.
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
    const TARGET = new THREE.Vector3(0, 1.5, -3);

    /*
     * What the camera has to fit.
     *
     * Framing the whole 40x30 room was right for a full-width view and wrong in
     * a 348px sidebar: five agents standing in the middle of a room built for
     * nine became five specks with the empty half of the gym around them. The
     * camera now frames the ground the cast actually occupies, so a small room
     * gets a close shot and a full one gets a wide shot, in the same component.
     */
    const fit = { halfW: FLOOR_W / 2, depth: FLOOR_D, cx: 0, cz: -3 };
    /** Camera elevation. Shallow enough to see the sprites face-on, steep
     *  enough that the floor reads as a floor. */
    const ELEV = (33 * Math.PI) / 180;

    /*
     * Frame the whole set for whatever box we are given.
     *
     * Hardcoding a camera position worked for the full-width view and broke the
     * moment the same scene went into a 348px sidebar: the room is 40 units wide
     * and a narrow viewport crops it long before the vertical fov runs out. So
     * the distance is solved from BOTH axes and the larger one wins.
     */
    const frameCamera = (aspect: number): void => {
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
      const forWidth = (fit.halfW + 3.5) / Math.tan(hFov / 2);
      // The floor is seen at an angle, so its apparent depth is foreshortened.
      const seenDepth = fit.depth * Math.sin(ELEV) + (CHAR_H + 3) * Math.cos(ELEV);
      const forDepth = (seenDepth / 2) / Math.tan(vFov / 2);
      const d = Math.max(forWidth, forDepth);
      TARGET.set(fit.cx, 1.4, fit.cz);
      camera.position.set(
        TARGET.x,
        TARGET.y + d * Math.sin(ELEV),
        TARGET.z + d * Math.cos(ELEV),
      );
      camera.lookAt(TARGET);
    };
    frameCamera(1);

    /* ── set ─────────────────────────────────────────────────────────── */

    const mat = new THREE.CanvasTexture(matCanvas("#12182a", "#2e3a57"));
    mat.wrapS = THREE.RepeatWrapping;
    mat.wrapT = THREE.RepeatWrapping;
    mat.repeat.set(18, 16);
    mat.magFilter = THREE.NearestFilter;
    mat.colorSpace = THREE.SRGBColorSpace;

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_W, FLOOR_D),
      new THREE.MeshStandardMaterial({ map: mat, roughness: 0.95, metalness: 0.05 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);

    const wallMat = new THREE.MeshStandardMaterial({ color: PANEL, roughness: 0.9 });
    const WALL_H = 34;
    const back = new THREE.Mesh(new THREE.BoxGeometry(FLOOR_W, WALL_H, 0.6), wallMat);
    back.position.set(0, WALL_H / 2, -FLOOR_D / 2);
    back.receiveShadow = true;
    scene.add(back);

    for (const s of [-1, 1]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.6, WALL_H, FLOOR_D), wallMat);
      side.position.set((s * FLOOR_W) / 2, WALL_H / 2, 0);
      side.receiveShadow = true;
      scene.add(side);
    }

    // The mirror. Not a real reflection — a dark metal panel reads as one at
    // this angle, and a render target for a wall nobody looks into is waste.
    const mirror = new THREE.Mesh(
      new THREE.PlaneGeometry(FLOOR_W - 14, 9),
      new THREE.MeshStandardMaterial({
        color: EDGE,
        roughness: 0.34,
        metalness: 0.7,
      }),
    );
    mirror.position.set(0, 9, -FLOOR_D / 2 + 0.35);
    scene.add(mirror);

    const frameMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#aab4c9"),
      roughness: 0.35,
      metalness: 0.75,
    });
    const padMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color("#26304a"),
      roughness: 0.8,
      metalness: 0.1,
    });

    /* ── light ───────────────────────────────────────────────────────── */

    scene.add(new THREE.AmbientLight(0x4a5478, 1.7));

    const key = new THREE.DirectionalLight(0xdfe6ff, 1.35);
    key.position.set(-14, 24, 12);
    key.castShadow = true;
    key.shadow.mapSize.set(1024, 1024);
    key.shadow.camera.left = -26;
    key.shadow.camera.right = 26;
    key.shadow.camera.top = 26;
    key.shadow.camera.bottom = -26;
    key.shadow.bias = -0.0018;
    scene.add(key);

    const rim = new THREE.DirectionalLight(ACCENT, 0.5);
    rim.position.set(10, 8, -18);
    scene.add(rim);

    /* ── post ────────────────────────────────────────────────────────── */

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.5, 0.75, 0.62);
    composer.addPass(bloom);
    const tilt = new ShaderPass(TiltShift);
    composer.addPass(tilt);
    composer.addPass(new OutputPass());

    /* ── cast ────────────────────────────────────────────────────────── */

    const stations: Station[] = [];
    const actors: Actor[] = [];
    const stationGroup = new THREE.Group();
    scene.add(stationGroup);

    let castCols = 0;

    const buildCast = (aspect: number): void => {
      for (const a of actors) {
        scene.remove(a.sprite);
        a.sprite.material.dispose();
        for (const t of Object.values(a.textures)) t.dispose();
        a.label.remove();
      }
      actors.length = 0;
      for (const s of stations) s.light.dispose?.();
      stations.length = 0;
      stationGroup.clear();

      const { members: ms, agents: am, memory: mem } = liveRef.current;
      castCols = columnsFor(Math.max(ms.length, 1), aspect);
      const spots = stationSpots(Math.max(ms.length, 1), aspect);

      // Stations sit at the back of each character's patch and the rest spot is
      // 6.5 in front of it, so the occupied ground runs from the first station
      // to the last rest position.
      const xs = spots.map((sp) => sp.x);
      const zs = spots.map((sp) => sp.z);
      fit.halfW = Math.max(...xs.map(Math.abs)) + CHAR_W;
      fit.cx = (Math.min(...xs) + Math.max(...xs)) / 2;
      const zMin = Math.min(...zs) - 2.5;
      const zMax = Math.max(...zs) + 6.5 + 1.5;
      fit.depth = zMax - zMin;
      fit.cz = (zMin + zMax) / 2;

      ms.forEach((id, i) => {
        const spot = spots[i];
        if (!spot) return;
        const agent = am.get(id);
        const color = agent?.color ?? "#59627c";
        const bulk = bulkOf((mem[id] ?? { chars: 0 }).chars);
        const kind = KINDS[i % KINDS.length] ?? "bench";

        const g = buildStation(kind, frameMat, padMat);
        g.position.set(spot.x, 0, spot.z);
        stationGroup.add(g);

        // One light per station, in the agent's own colour. Off while they rest,
        // up while they work — so the lit part of the room is the busy part.
        const light = new THREE.PointLight(new THREE.Color(color), 0, 16, 2);
        light.position.set(spot.x, 3.2, spot.z + 1);
        scene.add(light);
        const station: Station = { x: spot.x, z: spot.z, kind, light };
        stations.push(station);

        const poses: Pose[] = ["stand", "pressUp", "pressDown", "walkA", "walkB", "sit"];
        const textures = {} as Record<Pose, THREE.Texture>;
        for (const p of poses) {
          const t = new THREE.CanvasTexture(characterCanvas(color, bulk, p));
          // Nearest on both filters. Anything else smooths the art pixels and
          // the sprite stops looking pixelled, which is the entire style.
          t.magFilter = THREE.NearestFilter;
          t.minFilter = THREE.NearestFilter;
          t.generateMipmaps = false;
          t.colorSpace = THREE.SRGBColorSpace;
          textures[p] = t;
        }

        const sprite = new THREE.Sprite(
          new THREE.SpriteMaterial({ map: textures.stand, transparent: true }),
        );
        /*
         * Two channels carry the same number, because one was not enough.
         *
         * The drawing is 44 pixels wide, so between two agents whose memory
         * differs by 2.7x the torso changes by one or two pixels — true to the
         * data and invisible on screen. Scaling the whole sprite in world space
         * as well turns that into a difference you can see across the room,
         * which is the entire job of this panel.
         */
        const sizeK = 0.62 + 0.85 * bulk;
        sprite.scale.set(CHAR_W * sizeK, CHAR_H * sizeK, 1);
        scene.add(sprite);

        const label = document.createElement("div");
        label.className = "gymscene__label";
        label.textContent = agent?.name ?? id;
        // The roster below this panel used to carry the numbers. It was removed,
        // so they live here — the figure is the glance, the hover is the figure.
        const m = mem[id] ?? { messages: 0, chars: 0 };
        label.title = `${agent?.name ?? id} — ${tierOf(bulk)} · ${compactCount(m.chars)} characters over ${m.messages} turns`;
        overlay.appendChild(label);

        actors.push({
          id,
          name: agent?.name ?? id,
          color,
          bulk,
          sprite,
          textures,
          station,
          restX: spot.x,
          restZ: spot.z + 6.5,
          t: 0,
          phase: (i * 1.9) % 6.28,
          label,
        });
      });
    };

    buildCast(1);
    frameCamera(camera.aspect || 1);

    /* ── size ────────────────────────────────────────────────────────── */

    const resize = (): void => {
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      if (w === 0 || h === 0) return;
      renderer.setSize(w, h, false);
      composer.setSize(w, h);
      bloom.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      // A shape change can change the layout, not just the framing.
      const { members: ms } = liveRef.current;
      if (columnsFor(Math.max(ms.length, 1), camera.aspect) !== castCols) {
        buildCast(camera.aspect);
      }
      frameCamera(camera.aspect);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    /* ── loop ────────────────────────────────────────────────────────── */

    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const v = new THREE.Vector3();
    let raf = 0;
    let last = performance.now();
    let castKey = liveRef.current.members.join(",");

    const frame = (now: number): void => {
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;
      const t = still ? 0 : now / 1000;

      const live = liveRef.current;
      const nextKey = live.members.join(",");
      if (nextKey !== castKey) {
        castKey = nextKey;
        buildCast(camera.aspect);
        frameCamera(camera.aspect);
      }

      for (const a of actors) {
        const status: AgentStatus = live.statuses[a.id] ?? "idle";
        const working = status === "processing";

        // Everyone trains. Standing still was the first version and it made a
        // quiet room look broken; the room is never idle, it is just working at
        // different speeds. Only an offline agent sits it out.
        const want = status === "offline" ? 0 : 1;
        const before = a.t;
        a.t += (want - a.t) * Math.min(dt * 2.4, 1);
        const moving = Math.abs(a.t - before) > 0.0015 && a.t > 0.02 && a.t < 0.98;

        const x = a.restX + (a.station.x - a.restX) * a.t;
        const z = a.restZ + (a.station.z + 2.4 - a.restZ) * a.t;
        const bob = moving ? Math.abs(Math.sin(t * 9 + a.phase)) * 0.12 : 0;
        a.sprite.position.set(x, CHAR_H / 2 + bob, z);

        // Rate is the status. Mid-turn is a hard set, just-finished is a
        // working pace, idle is a slow warm-up — but nobody is standing around.
        const rate = working ? 5.4 : status === "active" ? 2.9 : 1.5;

        let pose: Pose;
        if (status === "offline") pose = "sit";
        else if (moving) pose = Math.sin(t * 9 + a.phase) > 0 ? "walkA" : "walkB";
        else pose = Math.sin(t * rate + a.phase) > 0 ? "pressUp" : "pressDown";

        const tex = a.textures[pose];
        if (a.sprite.material.map !== tex) {
          a.sprite.material.map = tex;
          a.sprite.material.needsUpdate = true;
        }
        a.sprite.material.opacity = status === "offline" ? 0.35 : 1;

        // The station light follows the work, with a flicker under load.
        const target = working ? 30 + Math.sin(t * 7 + a.phase) * 5 : status === "active" ? 9 : 2.5;
        a.station.light.intensity += (target - a.station.light.intensity) * Math.min(dt * 3, 1);

        // Labels are HTML, projected each frame. Text drawn into the 3D scene
        // would be blurred by the same tilt-shift that sells the miniature.
        v.set(x, CHAR_H + 0.5, z).project(camera);
        const px = (v.x * 0.5 + 0.5) * mount.clientWidth;
        const py = (-v.y * 0.5 + 0.5) * mount.clientHeight;
        a.label.style.transform = `translate(-50%, -100%) translate(${px}px, ${py}px)`;
        a.label.dataset.state = status;
      }

      composer.render();
      if (!still) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      for (const a of actors) {
        a.sprite.material.dispose();
        for (const tx of Object.values(a.textures)) tx.dispose();
        a.label.remove();
      }
      scene.traverse((o) => {
        if (o instanceof THREE.Mesh) {
          o.geometry.dispose();
          const m = o.material;
          if (Array.isArray(m)) m.forEach((x) => x.dispose());
          else m.dispose();
        }
      });
      mat.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  const working = members.filter((id) => statuses[id] === "processing").length;

  return (
    <div className={compact ? "gymscene gymscene--compact" : "gymscene"}>
      <div className="gymscene__stage" ref={mountRef} />
      <div className="gymscene__overlay" ref={overlayRef} aria-hidden="true" />
      {!compact && (
        <div className="gymscene__hud">
          <span className="gymscene__room">{roomName}</span>
          <span className="gymscene__stat">
            {members.length} on the floor · {working} lifting
          </span>
        </div>
      )}
    </div>
  );
}
