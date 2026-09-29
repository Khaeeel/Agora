import { config } from "./config.ts";

export interface ComputerStatus {
  online: boolean;
  url: string | null;
  title: string | null;
  detail: string | null;
  /** CSS viewport size of the live tab — used to map clicks from the UI. */
  width: number | null;
  height: number | null;
}

export type ComputerInput =
  | { kind: "click"; x: number; y: number; button?: "left" | "right" | "middle" }
  | { kind: "dblclick"; x: number; y: number }
  | { kind: "move"; x: number; y: number }
  | { kind: "scroll"; x: number; y: number; deltaX?: number; deltaY?: number }
  | { kind: "keydown"; key: string; code?: string; text?: string }
  | { kind: "keyup"; key: string; code?: string }
  | { kind: "type"; text: string }
  | { kind: "navigate"; url: string };

interface CdpTarget {
  id: string;
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl?: string;
}

function cdpBase(): string {
  return `http://127.0.0.1:${config.cdpPort}`;
}

export async function computerStatus(): Promise<ComputerStatus> {
  try {
    const res = await fetch(`${cdpBase()}/json/version`, {
      signal: AbortSignal.timeout(1500),
    });
    if (!res.ok) {
      return {
        online: false,
        url: null,
        title: null,
        detail: `CDP HTTP ${res.status}`,
        width: null,
        height: null,
      };
    }
    const page = await pickPage();
    if (!page?.webSocketDebuggerUrl) {
      return {
        online: true,
        url: null,
        title: null,
        detail: "Chrome is up, but no open tab yet",
        width: null,
        height: null,
      };
    }
    const metrics = await cdpCall<{
      cssVisualViewport?: { clientWidth?: number; clientHeight?: number };
      cssLayoutViewport?: { clientWidth?: number; clientHeight?: number };
    }>(page.webSocketDebuggerUrl, "Page.getLayoutMetrics", {});
    const vp = metrics.cssVisualViewport ?? metrics.cssLayoutViewport;
    return {
      online: true,
      url: page.url || null,
      title: page.title || null,
      detail: null,
      width: vp?.clientWidth ?? null,
      height: vp?.clientHeight ?? null,
    };
  } catch (err) {
    return {
      online: false,
      url: null,
      title: null,
      detail: err instanceof Error ? err.message : String(err),
      width: null,
      height: null,
    };
  }
}

async function pickPage(): Promise<CdpTarget | null> {
  const res = await fetch(`${cdpBase()}/json/list`, {
    signal: AbortSignal.timeout(1500),
  });
  if (!res.ok) return null;
  const targets = (await res.json()) as CdpTarget[];
  const pages = targets.filter((t) => t.type === "page" && t.webSocketDebuggerUrl);
  return (
    pages.find((p) => p.url && !p.url.startsWith("chrome://") && !p.url.startsWith("devtools://")) ??
    pages[0] ??
    null
  );
}

async function withPageWs<T>(fn: (wsUrl: string, page: CdpTarget) => Promise<T>): Promise<T> {
  const page = await pickPage();
  if (!page?.webSocketDebuggerUrl) {
    throw new Error("Chrome is offline. Start it headless: bash scripts/start-chrome.sh --headless");
  }
  return fn(page.webSocketDebuggerUrl, page);
}

function cdpCall<T>(
  wsUrl: string,
  method: string,
  params: Record<string, unknown>,
  timeoutMs = 4000,
): Promise<T> {
  const ws = new WebSocket(wsUrl);
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* closed */
      }
      reject(new Error(`${method} timed out`));
    }, timeoutMs);

    ws.addEventListener("open", () => {
      ws.send(JSON.stringify({ id: 1, method, params }));
    });

    ws.addEventListener("message", (ev) => {
      let msg: { id?: number; result?: T; error?: { message?: string } };
      try {
        msg = JSON.parse(String(ev.data)) as typeof msg;
      } catch {
        return;
      }
      if (msg.id !== 1) return;
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* closed */
      }
      if (msg.error) {
        reject(new Error(msg.error.message ?? method));
        return;
      }
      resolve((msg.result ?? {}) as T);
    });

    ws.addEventListener("error", () => {
      clearTimeout(timer);
      reject(new Error("CDP websocket failed"));
    });
  });
}

/** Several CDP commands on one short-lived websocket (click = move + down + up). */
function cdpBatch(
  wsUrl: string,
  calls: Array<{ method: string; params: Record<string, unknown> }>,
  timeoutMs = 4000,
): Promise<void> {
  const ws = new WebSocket(wsUrl);
  return new Promise<void>((resolve, reject) => {
    let nextId = 1;
    const pending = new Set<number>();
    const timer = setTimeout(() => {
      try {
        ws.close();
      } catch {
        /* closed */
      }
      reject(new Error("input timed out"));
    }, timeoutMs);

    const finish = (err?: Error) => {
      clearTimeout(timer);
      try {
        ws.close();
      } catch {
        /* closed */
      }
      if (err) reject(err);
      else resolve();
    };

    ws.addEventListener("open", () => {
      for (const call of calls) {
        const id = nextId++;
        pending.add(id);
        ws.send(JSON.stringify({ id, method: call.method, params: call.params }));
      }
    });

    ws.addEventListener("message", (ev) => {
      let msg: { id?: number; error?: { message?: string } };
      try {
        msg = JSON.parse(String(ev.data)) as typeof msg;
      } catch {
        return;
      }
      if (typeof msg.id !== "number" || !pending.has(msg.id)) return;
      if (msg.error) {
        finish(new Error(msg.error.message ?? "CDP error"));
        return;
      }
      pending.delete(msg.id);
      if (pending.size === 0) finish();
    });

    ws.addEventListener("error", () => finish(new Error("CDP websocket failed")));
  });
}

/**
 * One JPEG of the active Chrome tab. The Computer tab shows this so the
 * machine lives inside Agora — no separate window needed when Chrome is headless.
 */
export async function captureComputerFrame(): Promise<{
  bytes: Buffer;
  url: string | null;
  title: string | null;
} | null> {
  return withPageWs(async (wsUrl, page) => {
    const result = await cdpCall<{ data: string }>(wsUrl, "Page.captureScreenshot", {
      format: "jpeg",
      quality: 55,
      fromSurface: true,
    });
    if (typeof result.data !== "string") return null;
    return {
      bytes: Buffer.from(result.data, "base64"),
      url: page.url || null,
      title: page.title || null,
    };
  });
}

const KEY_CODES: Record<string, { key: string; code: string; text?: string; windowsVirtualKeyCode?: number }> = {
  Enter: { key: "Enter", code: "Enter", text: "\r", windowsVirtualKeyCode: 13 },
  Backspace: { key: "Backspace", code: "Backspace", windowsVirtualKeyCode: 8 },
  Tab: { key: "Tab", code: "Tab", text: "\t", windowsVirtualKeyCode: 9 },
  Escape: { key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 },
  ArrowLeft: { key: "ArrowLeft", code: "ArrowLeft", windowsVirtualKeyCode: 37 },
  ArrowUp: { key: "ArrowUp", code: "ArrowUp", windowsVirtualKeyCode: 38 },
  ArrowRight: { key: "ArrowRight", code: "ArrowRight", windowsVirtualKeyCode: 39 },
  ArrowDown: { key: "ArrowDown", code: "ArrowDown", windowsVirtualKeyCode: 40 },
  Delete: { key: "Delete", code: "Delete", windowsVirtualKeyCode: 46 },
  Home: { key: "Home", code: "Home", windowsVirtualKeyCode: 36 },
  End: { key: "End", code: "End", windowsVirtualKeyCode: 35 },
  PageUp: { key: "PageUp", code: "PageUp", windowsVirtualKeyCode: 33 },
  PageDown: { key: "PageDown", code: "PageDown", windowsVirtualKeyCode: 34 },
};

function mouseButton(button: "left" | "right" | "middle" = "left"): {
  button: "left" | "right" | "middle";
  buttons: number;
} {
  if (button === "right") return { button: "right", buttons: 2 };
  if (button === "middle") return { button: "middle", buttons: 4 };
  return { button: "left", buttons: 1 };
}

/** Forward a click / key / scroll into the live Chrome tab. */
export async function dispatchComputerInput(input: ComputerInput): Promise<{ ok: true }> {
  return withPageWs(async (wsUrl) => {
    if (input.kind === "navigate") {
      let url = input.url.trim();
      if (!url) throw new Error("url is required");
      if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
      await cdpCall(wsUrl, "Page.navigate", { url });
      return { ok: true as const };
    }

    if (input.kind === "type") {
      await cdpCall(wsUrl, "Input.insertText", { text: input.text });
      return { ok: true as const };
    }

    if (input.kind === "click" || input.kind === "dblclick" || input.kind === "move") {
      const x = Math.max(0, input.x);
      const y = Math.max(0, input.y);
      const btn = input.kind === "click" ? mouseButton(input.button) : mouseButton("left");
      const clicks = input.kind === "dblclick" ? 2 : 1;
      const calls: Array<{ method: string; params: Record<string, unknown> }> = [
        {
          method: "Input.dispatchMouseEvent",
          params: { type: "mouseMoved", x, y },
        },
      ];
      if (input.kind !== "move") {
        for (let i = 1; i <= clicks; i++) {
          calls.push({
            method: "Input.dispatchMouseEvent",
            params: {
              type: "mousePressed",
              x,
              y,
              button: btn.button,
              buttons: btn.buttons,
              clickCount: i,
            },
          });
          calls.push({
            method: "Input.dispatchMouseEvent",
            params: {
              type: "mouseReleased",
              x,
              y,
              button: btn.button,
              buttons: 0,
              clickCount: i,
            },
          });
        }
      }
      await cdpBatch(wsUrl, calls);
      return { ok: true as const };
    }

    if (input.kind === "scroll") {
      await cdpCall(wsUrl, "Input.dispatchMouseEvent", {
        type: "mouseWheel",
        x: Math.max(0, input.x),
        y: Math.max(0, input.y),
        deltaX: input.deltaX ?? 0,
        deltaY: input.deltaY ?? 0,
      });
      return { ok: true as const };
    }

    // keydown / keyup
    const special = KEY_CODES[input.key];
    const text =
      input.kind === "keydown"
        ? (input.text ?? special?.text ?? (input.key.length === 1 ? input.key : undefined))
        : undefined;
    await cdpCall(wsUrl, "Input.dispatchKeyEvent", {
      type: input.kind === "keydown" ? (text ? "keyDown" : "rawKeyDown") : "keyUp",
      key: special?.key ?? input.key,
      code: input.code ?? special?.code ?? (input.key.length === 1 ? `Key${input.key.toUpperCase()}` : input.key),
      text,
      unmodifiedText: text,
      windowsVirtualKeyCode: special?.windowsVirtualKeyCode,
      nativeVirtualKeyCode: special?.windowsVirtualKeyCode,
    });
    return { ok: true as const };
  });
}
