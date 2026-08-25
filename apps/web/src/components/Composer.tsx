import { useRef, useState } from "react";

export function Composer({
  roomName,
  disabled,
  busy,
  onSend,
}: {
  roomName: string;
  disabled: boolean;
  busy: boolean;
  onSend: (text: string) => void;
}) {
  const [text, setText] = useState("");
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const submit = (): void => {
    const trimmed = text.trim();
    if (!trimmed || disabled || busy) return;
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
          placeholder={busy ? "A run is in progress…" : `Broadcast to ${roomName}…`}
          disabled={disabled || busy}
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
          disabled={disabled || busy || !text.trim()}
          aria-label="Send"
        >
          ➤
        </button>
      </div>
      <p className="composer__hint">
        <span>Enter to send · Shift+Enter for a new line</span>
        <span>The orchestrator decides who answers.</span>
      </p>
    </div>
  );
}
