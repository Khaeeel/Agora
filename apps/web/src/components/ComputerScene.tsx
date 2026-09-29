import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
  type WheelEvent,
} from "react";
import { createPortal } from "react-dom";
import type { Agent, AgentStatus } from "../lib/types.ts";
import { Av } from "./bits.tsx";

const API = import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8787";

type Fit = "cover" | "contain";

/** Map a pointer on a fitted image onto remote CSS viewport pixels. */
function mapFittedPoint(
  el: HTMLElement,
  clientX: number,
  clientY: number,
  viewportW: number,
  viewportH: number,
  fit: Fit,
): { x: number; y: number } | null {
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0 || viewportW <= 0 || viewportH <= 0) return null;
  const scale =
    fit === "contain"
      ? Math.min(rect.width / viewportW, rect.height / viewportH)
      : Math.max(rect.width / viewportW, rect.height / viewportH);
  const shownW = viewportW * scale;
  const shownH = viewportH * scale;
  const offsetX = (rect.width - shownW) / 2;
  const offsetY = fit === "contain" ? (rect.height - shownH) / 2 : 0;
  const x = (clientX - rect.left - offsetX) / scale;
  const y = (clientY - rect.top - offsetY) / scale;
  if (x < 0 || y < 0 || x > viewportW || y > viewportH) return null;
  return { x, y };
}

async function sendInput(body: Record<string, unknown>): Promise<void> {
  await fetch(`${API}/api/computer/input`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/**
 * The one Agora computer — a live CDP view of headless Chrome.
 * Preview is watch-only; double-click expands to a Grok-style drive surface.
 */
export function ComputerScene({
  members,
  agents,
  statuses,
  roomName,
  size = "compact",
  live = true,
}: {
  members: string[];
  agents: Map<string, Agent>;
  statuses: Record<string, AgentStatus>;
  roomName: string;
  size?: "compact" | "full";
  live?: boolean;
}) {
  const cast = members
    .map((id) => agents.get(id))
    .filter((agent): agent is Agent => agent !== undefined);

  const [frame, setFrame] = useState<string | null>(null);
  const [online, setOnline] = useState(false);
  const [pageTitle, setPageTitle] = useState<string | null>(null);
  const [pageUrl, setPageUrl] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [viewport, setViewport] = useState<{ w: number; h: number } | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [focused, setFocused] = useState(false);
  const [busy, setBusy] = useState(false);
  const driveRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!live) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    const tick = async (): Promise<void> => {
      try {
        const status = (await fetch(`${API}/api/computer`).then((r) => r.json())) as {
          online: boolean;
          url: string | null;
          title: string | null;
          detail: string | null;
          width: number | null;
          height: number | null;
        };
        if (cancelled) return;
        setOnline(status.online);
        setPageTitle(status.title);
        setPageUrl(status.url);
        setDetail(status.detail);
        if (status.width && status.height) setViewport({ w: status.width, h: status.height });
        if (!status.online) {
          if (objectUrl) {
            URL.revokeObjectURL(objectUrl);
            objectUrl = null;
          }
          setFrame(null);
          return;
        }
        const res = await fetch(`${API}/api/computer/frame.jpg?t=${Date.now()}`);
        if (!res.ok || cancelled) return;
        const blob = await res.blob();
        if (cancelled) return;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
        objectUrl = URL.createObjectURL(blob);
        setFrame(objectUrl);
      } catch {
        if (!cancelled) {
          setOnline(false);
          setDetail("Cannot reach the Agora computer API");
        }
      }
    };

    void tick();
    const ms = expanded ? 350 : size === "full" ? 900 : 1400;
    const id = setInterval(() => void tick(), ms);
    return () => {
      cancelled = true;
      clearInterval(id);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [live, size, expanded]);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false);
    };
    window.addEventListener("keydown", onKey);
    // Focus the drive surface so typing works immediately.
    queueMicrotask(() => driveRef.current?.focus());
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded]);

  const pointFrom = (
    el: HTMLElement | null,
    e: { clientX: number; clientY: number },
    fit: Fit,
  ) => {
    if (!el || !viewport) return null;
    return mapFittedPoint(el, e.clientX, e.clientY, viewport.w, viewport.h, fit);
  };

  const driveClick = async (e: MouseEvent<HTMLDivElement>, fit: Fit) => {
    e.preventDefault();
    e.stopPropagation();
    const el = e.currentTarget;
    el.focus();
    const pt = pointFrom(el, e, fit);
    if (!pt) return;
    setBusy(true);
    try {
      await sendInput({
        kind: e.detail >= 2 ? "dblclick" : "click",
        x: pt.x,
        y: pt.y,
        button: e.button === 2 ? "right" : e.button === 1 ? "middle" : "left",
      });
    } finally {
      setBusy(false);
    }
  };

  const driveWheel = async (e: WheelEvent<HTMLDivElement>, fit: Fit) => {
    e.preventDefault();
    e.stopPropagation();
    const pt = pointFrom(e.currentTarget, e, fit);
    if (!pt) return;
    await sendInput({
      kind: "scroll",
      x: pt.x,
      y: pt.y,
      deltaX: e.deltaX,
      deltaY: e.deltaY,
    });
  };

  const driveKey = async (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      setExpanded(false);
      return;
    }
    if (e.metaKey || e.altKey) return;
    if (e.ctrlKey && !["a", "c", "v", "x", "Backspace"].includes(e.key)) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      await sendInput({ kind: "type", text: e.key });
      return;
    }
    await sendInput({ kind: "keydown", key: e.key, code: e.code });
    await sendInput({ kind: "keyup", key: e.key, code: e.code });
  };

  const onNavigate = async (url: string) => {
    if (!url.trim()) return;
    setBusy(true);
    try {
      await sendInput({ kind: "navigate", url: url.trim() });
    } finally {
      setBusy(false);
    }
  };

  const title = online ? pageTitle || pageUrl || roomName || "Computer" : "Computer · offline";

  return (
    <>
      <div
        className={`computer computer--${size}${online && frame ? " computer--live" : ""}`}
        aria-label="Shared computer"
      >
        <div className="computer__bezel">
          <div className="computer__chrome">
            <span className="computer__dots" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
            <span className="computer__name">{live ? title : roomName || "Computer"}</span>
            {live && (
              <span className={`computer__live${online ? " computer__live--on" : ""}`}>
                {online ? "live" : "off"}
              </span>
            )}
          </div>
          <div className="computer__desktop">
            {live && frame ? (
              <button
                type="button"
                className="computer__screen-hit"
                aria-label="Double-click to expand and drive the computer"
                title="Double-click to expand"
                onDoubleClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setExpanded(true);
                }}
              >
                <img
                  className="computer__screen"
                  src={frame}
                  alt={pageTitle ?? "Computer screen"}
                  draggable={false}
                />
                <span className="computer__expand-hint">Double-click to expand</span>
              </button>
            ) : live ? (
              <p className="computer__empty">
                {detail ?? "No virtual PC yet."}
                <br />
                <span className="computer__hint">
                  Start headless Chrome so it stays inside Agora:
                  <code> bash scripts/start-chrome.sh --headless</code>
                </span>
              </p>
            ) : cast.length === 0 ? (
              <p className="computer__empty">No agents on this computer.</p>
            ) : null}

            {live && cast.length > 0 && (
              <div className="computer__agents" aria-label="Agents on this machine">
                {cast.map((agent) => (
                  <span
                    key={agent.id}
                    className={`computer__agent${statuses[agent.id] === "processing" ? " computer__agent--live" : ""}`}
                    title={`${agent.name} · ${statuses[agent.id] === "processing" ? "writing" : "idle"}`}
                  >
                    <Av agent={agent} size={size === "full" ? 26 : 20} />
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {expanded &&
        frame &&
        createPortal(
          <div className="computer-stage" role="dialog" aria-modal="true" aria-label="Computer">
            <div className="computer-stage__bar">
              <span className="computer-stage__dots" aria-hidden="true">
                <i />
                <i />
                <i />
              </span>
              <form
                className="computer-stage__urlbar"
                onSubmit={(e) => {
                  e.preventDefault();
                  const fd = new FormData(e.currentTarget);
                  void onNavigate(String(fd.get("url") ?? ""));
                }}
              >
                <input
                  name="url"
                  className="computer-stage__url"
                  defaultValue={pageUrl ?? ""}
                  key={pageUrl ?? "url"}
                  spellCheck={false}
                  placeholder="https://…"
                  aria-label="Address"
                />
                <button type="submit" className="computer-stage__go" disabled={busy}>
                  Go
                </button>
              </form>
              <span className={`computer-stage__live${online ? " computer-stage__live--on" : ""}`}>
                {focused ? "driving" : "live"}
              </span>
              <button
                type="button"
                className="computer-stage__close"
                onClick={() => setExpanded(false)}
                aria-label="Close"
              >
                Esc
              </button>
            </div>
            <div
              ref={driveRef}
              className="computer-stage__drive"
              role="application"
              tabIndex={0}
              aria-label="Drive the computer — click, type, scroll. Esc to close."
              onClick={(e) => void driveClick(e, "contain")}
              onContextMenu={(e) => void driveClick(e, "contain")}
              onWheel={(e) => void driveWheel(e, "contain")}
              onKeyDown={(e) => void driveKey(e)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
            >
              <img
                className="computer-stage__screen"
                src={frame}
                alt={pageTitle ?? "Computer screen"}
                draggable={false}
              />
            </div>
            <p className="computer-stage__tip">
              Click · type · scroll inside · Esc to shrink
            </p>
          </div>,
          document.body,
        )}
    </>
  );
}
