import { useEffect, useRef } from "react";
import type { Agent, Message } from "../lib/types.ts";
import type { Live } from "../lib/store.ts";
import { Avatar, clock } from "./bits.tsx";

interface Props {
  messages: Message[];
  live: Live | null;
  agents: Map<string, Agent>;
  onAnswer: (messageId: string, label: string) => void;
  /** A run holds the room, so a decision cannot start another one yet. */
  busy: boolean;
}

/** Consecutive messages from one author collapse under a single header. */
function isTight(prev: Message | undefined, m: Message): boolean {
  if (!prev) return false;
  if (prev.kind !== m.kind) return false;
  if (prev.authorId !== m.authorId) return false;
  return m.createdAt - prev.createdAt < 4 * 60 * 1000;
}

function fmtDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}

/**
 * The `kind:` and `@next:` markers are a contract between agents, not something
 * Dominic reads. They stay in the stored text — agents see each other's markers
 * in the transcript, which is how the convention holds — and come off here only.
 */
function displayText(text: string): string {
  return text
    .replace(/^\s*kind:[^\n]*\n?/i, "")
    .replace(/\n?\s*@next:[^\n]*\s*$/i, "")
    .trim();
}

/** What the markers said, as a small tag instead of two raw lines. */
function Marks({ m, agents }: { m: Message; agents: Map<string, Agent> }) {
  if (!m.act && !m.nextId) return null;
  const next = m.nextId ? (agents.get(m.nextId)?.name ?? m.nextId) : null;
  return (
    <span className="chip" title="kind · next">
      {m.act ?? "?"}
      {next ? ` → ${next}` : ""}
    </span>
  );
}

/**
 * A question the room is putting to Dominic, with its options as buttons.
 *
 * The room stops dead when it needs a decision from him, and before this the
 * only way to give one was to read a wall of text, work out what was being
 * asked, and type an answer that matched. Every one of those steps was a place
 * to lose an hour. Tapping the option restarts the room immediately.
 */
function Decision({
  m,
  onAnswer,
  disabled,
}: {
  m: Message;
  onAnswer: (messageId: string, label: string) => void;
  disabled: boolean;
}) {
  const answered = m.answeredWith;
  return (
    <div className={`decision${answered ? " decision--answered" : ""}`}>
      <div className="decision__head">
        <span className="decision__label">
          {answered ? "You chose" : "The room needs a decision"}
        </span>
      </div>
      <div className="decision__body">{m.text}</div>
      <div className="decision__options">
        {(m.choices ?? []).map((c) => {
          const picked = answered === c.label;
          return (
            <button
              className={`choice${picked ? " choice--picked" : ""}`}
              key={c.label}
              onClick={() => onAnswer(m.id, c.label)}
              // Once answered the buttons stay visible but inert: the record of
              // what was chosen is worth more than reclaiming the space.
              disabled={answered !== null || disabled}
              title={answered ? "This decision has been made" : c.detail}
            >
              <span className="choice__label">{c.label}</span>
              {c.detail && <span className="choice__detail">{c.detail}</span>}
            </button>
          );
        })}
      </div>
      {answered === null && disabled && (
        <p className="decision__note">A run is already going — wait for it, or stop it first.</p>
      )}
    </div>
  );
}

function TurnMeta({ m }: { m: Message }) {
  const bits: string[] = [];
  if (m.durationMs != null) bits.push(fmtDuration(m.durationMs));
  if (bits.length === 0) return null;
  return <span className="turnmeta">{bits.join(" · ")}</span>;
}

export function Transcript({ messages, live, agents, onAnswer, busy }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live?.text]);

  return (
    <div className="transcript" role="log" aria-live="polite" aria-relevant="additions">
      {messages.length > 0 && <div className="daymark">Today</div>}

      {messages.map((m, i) => {
        if (m.kind === "notice") {
          return (
            <p className="notice" key={m.id}>
              {m.text}
            </p>
          );
        }

        if (m.kind === "event") {
          return (
            <p className="event" key={m.id}>
              <span className="event__mark" aria-hidden="true">
                ▸
              </span>
              <span>{m.text}</span>
              <TurnMeta m={m} />
            </p>
          );
        }

        if (m.choices?.length) {
          return (
            <Decision key={m.id} m={m} onAnswer={onAnswer} disabled={busy} />
          );
        }

        if (m.kind === "handoff") {
          return (
            <div className="handoff" key={m.id}>
              <div className="handoff__head">
                <span className="handoff__label">
                  Your prompt — paste into Claude CLI
                </span>
                <button
                  className="handoff__copy"
                  onClick={() => void navigator.clipboard.writeText(m.text)}
                >
                  Copy
                </button>
              </div>
              <pre className="handoff__body">{m.text}</pre>
            </div>
          );
        }

        if (m.kind === "notify") {
          // Delivered means the text is already on Dominic's phone, so printing
          // the whole report here again is the same thing twice. Collapse it —
          // the record stays, one click away.
          //
          // NOT delivered is the opposite case and must stay open: WhatsApp
          // never got it, so this copy is the only copy there is.
          return (
            <div
              className={`notify${m.delivered ? " notify--sent" : ""}`}
              key={m.id}
            >
              <span aria-hidden="true">📲</span>
              <span style={{ minWidth: 0 }}>
                {m.delivered ? (
                  <details className="notify__fold">
                    <summary className="notify__label">Sent to WhatsApp</summary>
                    <span className="notify__body">{m.text}</span>
                  </details>
                ) : (
                  <>
                    <span className="notify__label">
                      WhatsApp update — not sent
                    </span>
                    <span className="notify__body">{m.text}</span>
                  </>
                )}
              </span>
            </div>
          );
        }

        const tight = isTight(messages[i - 1], m);
        const human = m.kind === "human";
        const agent = agents.get(m.authorId);
        const director = m.directedBy ? agents.get(m.directedBy) : undefined;

        return (
          <div
            className={
              "group" +
              (tight ? " group--tight" : "") +
              (human ? " group--human" : "")
            }
            key={m.id}
          >
            {!human && (tight ? <span /> : <Avatar agent={agent} size={34} />)}
            <div style={{ minWidth: 0 }}>
              {!tight && (
                <div className="group__head">
                  <span className="group__name">
                    {human ? "You" : (agent?.name ?? m.authorId)}
                  </span>
                  {!human && agent && <span className="chip">{agent.role}</span>}
                  <span className="time">{clock(m.createdAt)}</span>
                  {director && (
                    <span className="directed">← {director.name} asked</span>
                  )}
                  <TurnMeta m={m} />
                  {!human && <Marks m={m} agents={agents} />}
                </div>
              )}
              <div className={"bubble" + (human ? " bubble--human" : "")}>
                {human ? m.text : displayText(m.text)}
              </div>
              {tight && (
                <>
                  <TurnMeta m={m} />
                  <Marks m={m} agents={agents} />
                </>
              )}
            </div>
          </div>
        );
      })}

      {live && (
        <div className="group">
          <Avatar agent={agents.get(live.agentId)} size={34} />
          <div style={{ minWidth: 0 }}>
            <div className="group__head">
              <span className="group__name">
                {agents.get(live.agentId)?.name ?? live.agentId}
              </span>
              <span className="chip">{agents.get(live.agentId)?.role}</span>
              {live.directedBy && (
                <span className="directed">
                  ← {agents.get(live.directedBy)?.name ?? live.directedBy} asked
                </span>
              )}
            </div>
            <div className="bubble caret">{displayText(live.text)}</div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
