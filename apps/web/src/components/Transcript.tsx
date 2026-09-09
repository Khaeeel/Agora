import { useEffect, useRef, type ReactNode } from "react";
import type { Agent, Message } from "../lib/types.ts";
import type { Live } from "../lib/store.ts";
import { Av, clock } from "./bits.tsx";

interface Props {
  messages: Message[];
  live: Live | null;
  agents: Map<string, Agent>;
  onAnswer: (messageId: string, label: string) => void;
  /** A run holds the room, so a decision cannot start another one yet. */
  busy: boolean;
  /** A private thread: human bubbles sit on the right, no "direct message" tag. */
  dm?: boolean;
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
 * The `kind:` and `@next:` markers and the `[#1282]` citations are a contract
 * between agents, not something Dominic reads. They stay in the stored text —
 * agents see each other's markers in the transcript, which is how the
 * convention holds — and come off here only.
 */
function displayText(text: string): string {
  return text
    .replace(/^[\s\S]*?(?=^\s*kind:\s*(?:claim|question|result|pass)\s*$)/im, "")
    .replace(/^\s*kind:[^\n]*\n?/i, "")
    .replace(/\n?\s*@next:[^\n]*\s*$/i, "")
    .replace(/\s*\[#\d+\]/g, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/ ([,.;:!?])/g, "$1")
    .trim();
}

/** `code`, @mentions, **bold** — the three things agents actually write. */
function rich(text: string, agents: Map<string, Agent>): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`\n]+`)|(@[a-z0-9][a-z0-9_-]*)|(\*\*[^*\n]+\*\*)/gi;
  let last = 0;
  let i = 0;
  for (const m of text.matchAll(re)) {
    const at = m.index ?? 0;
    if (at > last) out.push(text.slice(last, at));
    const tok = m[0];
    if (tok.startsWith("`")) out.push(<code key={i++}>{tok.slice(1, -1)}</code>);
    else if (tok.startsWith("**")) out.push(<strong key={i++}>{tok.slice(2, -2)}</strong>);
    else {
      const id = tok.slice(1).toLowerCase();
      const a = agents.get(id) ?? [...agents.values()].find((x) => x.name.toLowerCase() === id);
      out.push(<span className="at" key={i++}>@{a?.name ?? tok.slice(1)}</span>);
    }
    last = at + tok.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** "Progress check 2/6\n\n…" becomes the report card; anything else is a bubble. */
function splitReport(text: string): { step: number; of: number; body: string } | null {
  const m = text.match(/^Progress check (\d+)\/(\d+)\s*\n+([\s\S]*)$/);
  if (!m) return null;
  return { step: Number(m[1]), of: Number(m[2]), body: m[3]!.trim() };
}

function verdictOf(m: Message, text: string): ReactNode {
  if (m.act === "pass" || /^pass$/i.test(text)) return <span className="verdict pass">PASS</span>;
  if (m.act === "result") return <span className="verdict result">RESULT</span>;
  if (m.act === "question") return <span className="verdict question">ASK</span>;
  if (/^\s*BLOCKED:/.test(text)) return <span className="verdict hold">HOLD</span>;
  return null;
}

function Log({ m, kind }: { m: Message; kind: "fold" | "warn" | "plain" | "blocked" }) {
  const text = m.text;
  if (kind === "blocked") {
    // "step blocked · 1. Title · Owner — note"
    const body = text.replace(/^step blocked\s*·\s*/i, "");
    const [head, ...rest] = body.split(" — ");
    const parts = (head ?? "").split(" · ");
    const title = parts[0] ?? "";
    const who = parts.slice(1).join(" · ");
    const note = rest.join(" — ");
    return (
      <div className="log blocked">
        <span className="glyph"><i /></span>
        <span className="t">
          <b>Step blocked</b> · {title}
          {who && <><br /><span className="who">{who}</span></>}
          {note && <><br /><span className="needs">{note}</span></>}
        </span>
      </div>
    );
  }
  // "mind stone updated · 27 messages" / "assigned · Tokyo (Audio) · turn 2"
  const sep = text.indexOf(" · ");
  const lead = sep === -1 ? text : text.slice(0, sep);
  const tail = sep === -1 ? "" : text.slice(sep + 3);
  const leadCap = lead.charAt(0).toUpperCase() + lead.slice(1);
  return (
    <div className={`log ${kind === "plain" ? "" : kind}`}>
      <span className="glyph"><i /></span>
      <span className="t">
        <b>{leadCap}</b>{tail ? ` — ${tail}` : ""}
      </span>
      {m.durationMs != null && <span className="dur">{fmtDuration(m.durationMs)}</span>}
    </div>
  );
}

function Ask({ m, onAnswer, disabled }: { m: Message; onAnswer: (id: string, label: string) => void; disabled: boolean }) {
  const answered = m.answeredWith;
  return (
    <div className="log ask">
      <span className="t"><b>{answered ? "You chose" : "The room needs a decision"}</b>{"\n"}{displayText(m.text)}</span>
      <div className="askopts">
        {(m.choices ?? []).map((c) => {
          const picked = answered === c.label;
          return (
            <button
              key={c.label}
              className={`askopt${picked ? " picked" : ""}`}
              onClick={() => onAnswer(m.id, c.label)}
              disabled={answered !== null || disabled}
              title={answered ? "This decision has been made" : c.detail}
            >
              {c.label}
              {c.detail && <small>{c.detail}</small>}
            </button>
          );
        })}
      </div>
      {answered === null && disabled && <p className="asknote">A run is already going — wait for it, or stop it first.</p>}
    </div>
  );
}

export function Transcript({ messages, live, agents, onAnswer, busy, dm = false }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [messages.length, live?.text]);

  let lastDay = "";

  return (
    <div className={`stream${dm ? " dmstream" : ""}`} role="log" aria-live="polite" aria-relevant="additions">
      {messages.map((m, i) => {
        const day = new Date(m.createdAt).toDateString();
        const today = new Date().toDateString();
        const dayLabel = day === today ? "Today" : new Date(m.createdAt).toLocaleDateString([], { month: "short", day: "numeric" });
        const showDay = day !== lastDay;
        lastDay = day;
        const daybar = showDay ? (
          <div className="daybar"><i /><span>{dayLabel}</span><i /></div>
        ) : null;

        if (m.kind === "event") {
          const t = m.text.toLowerCase();
          const kind = t.startsWith("step blocked") ? "blocked" : t.startsWith("mind stone") ? "fold" : t.startsWith("access") || t.startsWith("forged") || t.startsWith("parallel") ? "warn" : "plain";
          return <div key={m.id}>{daybar}<Log m={m} kind={kind} /></div>;
        }
        if (m.kind === "notice") {
          return (
            <div key={m.id}>{daybar}
              <div className="log warn"><span className="glyph"><i /></span><span className="t" style={{ whiteSpace: "normal" }}>{m.text}</span></div>
            </div>
          );
        }
        if (m.choices?.length) {
          return <div key={m.id}>{daybar}<Ask m={m} onAnswer={onAnswer} disabled={busy} /></div>;
        }
        if (m.kind === "handoff") {
          return (
            <div key={m.id}>{daybar}
              <div className="prompt">
                <div className="rep-h"><b>Your prompt — paste into Claude CLI</b>
                  <button className="copybtn" onClick={() => void navigator.clipboard.writeText(m.text)}>Copy</button>
                </div>
                <pre>{displayText(m.text)}</pre>
              </div>
            </div>
          );
        }
        if (m.kind === "notify") {
          return (
            <div key={m.id}>{daybar}
              <details className="log fold" style={{ display: "block" }}>
                <summary className="t" style={{ cursor: "pointer" }}><b>{m.delivered ? "Sent to WhatsApp" : "WhatsApp update — not sent"}</b></summary>
                <div className="t" style={{ whiteSpace: "pre-wrap", padding: "4px 0 0 24px" }}>{displayText(m.text)}</div>
              </details>
            </div>
          );
        }

        const human = m.kind === "human";
        const agent = agents.get(m.authorId);
        const tight = isTight(messages[i - 1], m) && !showDay;
        const text = displayText(m.text);
        const report = human ? null : splitReport(m.text);
        const name = human ? "You" : (agent?.name ?? m.authorId);
        const color = human ? "#c9b6ff" : (agent?.color ?? "#8a90a8");
        const director = m.directedBy && m.directedBy !== "human" ? agents.get(m.directedBy) : undefined;

        return (
          <div key={m.id}>{daybar}
            <div className={`msg${tight ? " tight" : ""}${dm && human ? " mine" : ""}`}>
              <Av name={name} color={color} size={32} />
              <div className="body">
                {!tight && (
                  <div className="line1">
                    <span className="who" style={{ color }}>{name}</span>
                    {!human && agent && <span className="role">{agent.role}</span>}
                    <span className="time">{clock(m.createdAt)}</span>
                    {director && <span className="directed">← {director.name} asked</span>}
                    {m.directedBy === "human" && !dm && <span className="directed">← direct message</span>}
                    {m.durationMs != null && <span className="took">{fmtDuration(m.durationMs)}</span>}
                  </div>
                )}
                {report ? (
                  <div className="report">
                    <div className="rep-h"><b>Progress check</b>
                      <span className="steps">
                        {Array.from({ length: report.of }, (_, k) => (
                          <i key={k} className={k < report.step - 1 ? "done" : k === report.step - 1 ? "now" : ""} />
                        ))}
                      </span>
                      <span className="frac">{report.step}/{report.of}</span>
                    </div>
                    <div className="rep-b">{rich(displayText(report.body), agents)}</div>
                  </div>
                ) : (
                  <div className={`say${human ? " human" : ""}`}>
                    {!human && verdictOf(m, text)}
                    {rich(/^pass$/i.test(text) ? "" : text, agents)}
                  </div>
                )}
              </div>
            </div>
          </div>
        );
      })}

      {live && (
        <>
          <div className="thinking">
            <Av agent={agents.get(live.agentId)} size={32} />
            <span className="dots"><i /><i /><i /></span>
            <span>{agents.get(live.agentId)?.name ?? live.agentId} is writing{live.directedBy ? ` for ${agents.get(live.directedBy)?.name ?? live.directedBy}` : ""}</span>
          </div>
          {live.text.trim() && <div className="livebubble">{displayText(live.text)}</div>}
        </>
      )}
      <div ref={endRef} />
    </div>
  );
}
