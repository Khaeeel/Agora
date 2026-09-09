import { useEffect, useRef, useState } from "react";

/**
 * Typing is NEVER blocked — only sending is.
 *
 * The textarea used to be disabled whenever the socket dropped or a run was in
 * progress, which meant a one-second reconnect blip silently swallowed
 * keystrokes and an active run stopped you drafting the next thing at all.
 * Losing what someone typed is a worse failure than letting them queue it.
 */
export function Composer({
  roomName,
  hasRoom,
  connected,
  busy,
  onSend,
}: {
  roomName: string;
  hasRoom: boolean;
  connected: boolean;
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const blocked = !hasRoom
    ? "No room selected."
    : !connected
      ? "Reconnecting — your message is kept and will send once it's back."
      : busy
        ? "A run is in progress. It'll send when the room is free."
        : null;

  // Drafts survive a reload; a dropped connection should not cost you a
  // paragraph you already typed.
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

  return (
    <div className="composer">
      <div className="composer__box">
        <textarea
          ref={areaRef}
          className="composer__input"
          rows={1}
          value={text}
          placeholder={
            hasRoom ? `Broadcast to ${roomName}…` : "Pick a room to start a goal…"
          }
          aria-label={`Broadcast to ${roomName}`}
          onChange={(e) => {
            setText(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = `${Math.min(160, e.target.scrollHeight)}px`;
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <button
          className="composer__send"
          onClick={submit}
          disabled={!text.trim()}
          title={blocked ?? "Send"}
          aria-label="Send"
        >
          ➤
        </button>
      </div>
      <p className="composer__hint">
        {flash ? (
          <span className="composer__flash">{flash}</span>
        ) : blocked ? (
          <span className="composer__blocked">{blocked}</span>
        ) : (
          <>
            <span>Enter to send · Shift+Enter for a new line</span>
            <span>The orchestrator decides who answers.</span>
          </>
        )}
      </p>
    </div>
  );
}
