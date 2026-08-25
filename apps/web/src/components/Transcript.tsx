import { useEffect, useRef } from "react";
import type { Agent, Message } from "../lib/types.ts";
import type { Live } from "../lib/store.ts";
import { Avatar, clock } from "./bits.tsx";

interface Props {
  messages: Message[];
  live: Live | null;
  agents: Map<string, Agent>;
}

/** Consecutive messages from one author collapse under a single header. */
function isTight(prev: Message | undefined, m: Message): boolean {
  if (!prev) return false;
  if (prev.kind !== m.kind) return false;
  if (prev.authorId !== m.authorId) return false;
  return m.createdAt - prev.createdAt < 4 * 60 * 1000;
}

export function Transcript({ messages, live, agents }: Props) {
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
          return (
            <div
              className={`notify${m.delivered ? " notify--sent" : ""}`}
              key={m.id}
            >
              <span aria-hidden="true">📲</span>
              <span style={{ minWidth: 0 }}>
                <span className="notify__label">
                  {m.delivered ? "Sent to WhatsApp" : "WhatsApp update — not sent"}
                </span>
                <span className="notify__body">{m.text}</span>
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
                </div>
              )}
              <div className={"bubble" + (human ? " bubble--human" : "")}>
                {m.text}
              </div>
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
            <div className="bubble caret">{live.text}</div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  );
}
