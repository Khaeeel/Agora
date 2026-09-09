import { useState } from "react";
import type { MindStone as Stone } from "../lib/types.ts";

function ago(ts: number): string {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 90) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

/**
 * The stone is written as short lines under plain headings. Rendering it as
 * one `pre` block would be honest but unreadable at 264px; picking the
 * headings out is what makes it scannable. A heading is a short line that
 * isn't a bullet and doesn't end in sentence punctuation — the shape the
 * compaction prompt asks for. Anything ambiguous falls through as body text,
 * which costs nothing.
 */
function looksLikeHeading(line: string): boolean {
  const t = line.trim();
  if (t.length === 0 || t.length > 60) return false;
  if (/^[-·*\d]/.test(t)) return false;
  return !/[.,;:!?]$/.test(t) || t.endsWith(":");
}

function Rendered({ content }: { content: string }) {
  return (
    <div className="stonebody">
      {content.split("\n").map((line, i) => {
        const t = line.trim();
        if (t === "") return <div className="stonebody__gap" key={i} />;
        if (looksLikeHeading(line))
          return (
            <h3 className="stonebody__h" key={i}>
              {t.replace(/:$/, "")}
            </h3>
          );
        return (
          <p className="stonebody__p" key={i}>
            {t.replace(/^[-*·]\s*/, "")}
          </p>
        );
      })}
    </div>
  );
}

export function MindStonePanel({
  stone,
  roomName,
  compacting,
}: {
  stone: Stone | null;
  roomName: string;
  compacting: boolean;
}) {
  const [open, setOpen] = useState(false);

  if (!stone) {
    return (
      <div className="stone stone--empty">
        <div className="stone__head">
          <span className="stone__title">Mind stone</span>
          {compacting && <span className="stone__pulse">writing…</span>}
        </div>
        <p className="stone__hint">
          Nothing stored yet. Once {roomName} has enough history behind it, the
          room folds what it learned into a single memory it carries into every
          later run.
        </p>
      </div>
    );
  }

  const first = stone.content
    .split("\n")
    .map((l) => l.trim().replace(/^[-*·]\s*/, ""))
    .filter((l) => l !== "" && !looksLikeHeading(l))[0];

  return (
    <>
      <div className="stone">
        <div className="stone__head">
          <span className="stone__title">Mind stone</span>
          {compacting ? (
            <span className="stone__pulse">writing…</span>
          ) : (
            <span className="stone__when">{ago(stone.updatedAt)}</span>
          )}
        </div>
        <p className="stone__peek">{first ?? "Stored."}</p>
        <button className="stone__open" onClick={() => setOpen(true)}>
          Read memory
          <span className="stone__count">
            {stone.messages} msg · rev {stone.revisions}
          </span>
        </button>
      </div>

      {open && (
        <div
          className="scrim"
          role="dialog"
          aria-modal="true"
          aria-label={`Mind stone for ${roomName}`}
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="modal" style={{ width: "min(680px, 100%)" }}>
            <div className="modal__head">
              <span style={{ minWidth: 0, flex: 1 }}>
                <span className="modal__title">Mind stone — {roomName}</span>
                <br />
                <span className="stone__when">
                  {stone.messages} messages folded in over {stone.revisions}{" "}
                  {stone.revisions === 1 ? "revision" : "revisions"} · updated{" "}
                  {ago(stone.updatedAt)}
                </span>
              </span>
              <button className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>
            <div className="modal__body">
              <Rendered content={stone.content} />
            </div>
            <div className="modal__foot" style={{ justifyContent: "flex-start" }}>
              <span className="stone__when">
                Every agent in this room sees this before the transcript.
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
