import { useEffect, useRef, useState } from "react";
import type { Agent } from "../lib/types.ts";

/**
 * Typing and sending are never blocked by a run.
 *
 * A busy room used to refuse send with "It'll send when the room is free" and
 * then drop the message. The server now queues human lines and drains them
 * when the current turn finishes — same idea as chatting while Claude works.
 */
export function Composer({
  roomName,
  hasRoom,
  connected,
  busy,
  onSend,
  prefill,
  dmAgent,
}: {
  roomName: string;
  hasRoom: boolean;
  connected: boolean;
  busy: boolean;
  onSend: (text: string) => void;
  /** Text to drop into the box from elsewhere — a "Message" button on an agent. */
  prefill?: { text: string; nonce: number } | null;
  /** Set when this composer belongs to a private thread: sends go to this agent, no "@" needed. */
  dmAgent?: Agent | null;
}) {
  const [text, setText] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  // A "Message Fury" tap puts "@fury " in the box and hands you the cursor.
  useEffect(() => {
    if (!prefill) return;
    setText(prefill.text);
    const el = areaRef.current;
    if (el) {
      el.focus();
      requestAnimationFrame(() => el.setSelectionRange(el.value.length, el.value.length));
    }
  }, [prefill?.nonce]);

  const blocked = !hasRoom
    ? "No room selected."
    : !connected
      ? "Reconnecting — your message is kept and will send once it's back."
      : null;

  useEffect(() => {
    try {
      const saved = localStorage.getItem("agora-draft");
      if (saved) setText(saved);
    } catch {
      /* private mode — drafts just won't persist */
    }
  }, []);

  useEffect(() => {
    try {
      if (text) localStorage.setItem("agora-draft", text);
      else localStorage.removeItem("agora-draft");
    } catch {
      /* ignore */
    }
  }, [text]);

  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed) return;
    if (blocked) {
      setFlash(blocked);
      setTimeout(() => setFlash(null), 2600);
      return;
    }
    onSend(trimmed);
    setText("");
    if (areaRef.current) areaRef.current.style.height = "auto";
  };

  const direct = dmAgent ? true : text.trimStart().startsWith("@");

  return (
    <>
      <div className="composer">
        <div className="cbox">
          <textarea
            ref={areaRef}
            className="cinput"
            rows={1}
            value={text}
            placeholder={dmAgent ? `Message ${dmAgent.name}…` : hasRoom ? "Broadcast to the room, or @name one agent" : "Pick a room to start a goal…"}
            aria-label={`Broadcast to ${roomName}`}
            onChange={(e) => {
              setText(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(140, e.target.scrollHeight)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
          />
          <div className="ctools">
            {flash ? (
              <span className="flash">{flash}</span>
            ) : blocked && text.trim() ? (
              <span className="blockedhint">{blocked}</span>
            ) : busy && text.trim() ? (
              <span className="blockedhint">Room is working — a question gets a quick reply now; new work runs next.</span>
            ) : null}
            <button
              className="send"
              onClick={submit}
              disabled={!text.trim() || Boolean(blocked)}
              title={blocked ?? (busy ? "Questions are answered now; work queues behind the run" : "Send")}
              aria-label="Send"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M4 12h15M13 6l6 6-6 6" /></svg>
            </button>
          </div>
        </div>
      </div>
      <div className="chint">
        <span><b>Enter</b> send</span>
        <span><b>Shift+Enter</b> new line</span>
        <span>
          {dmAgent
            ? `Private thread with ${dmAgent.name} — no planning, nothing goes to WhatsApp.`
            : direct
              ? "Direct message: only that agent answers, no planning."
              : <>The orchestrator picks who answers unless you <b>@name</b> someone.</>}
        </span>
      </div>
    </>
  );
}
