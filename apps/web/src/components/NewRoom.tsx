import { useState } from "react";
import type { Agent } from "../lib/types.ts";
import { Avatar } from "./bits.tsx";

export function NewRoom({
  agents,
  onClose,
  onCreated,
}: {
  agents: Agent[];
  onClose: () => void;
  onCreated: (roomId: string) => void;
}) {
  const [name, setName] = useState("");
  const [topic, setTopic] = useState("");
  const [members, setMembers] = useState<string[]>(
    agents.filter((a) => a.orchestrator).map((a) => a.id),
  );
  const [orchestratorId, setOrchestratorId] = useState<string>(
    agents.find((a) => a.orchestrator)?.id ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggle = (id: string): void =>
    setMembers((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));

  const chosen = agents.filter((a) => members.includes(a.id));

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, topic, members, orchestratorId }),
      });
      const data = (await res.json()) as { room?: { id: string }; error?: string };
      if (!res.ok || !data.room) throw new Error(data.error ?? "Could not create room");
      onCreated(data.room.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-label="New room">
      <div className="modal" style={{ width: "min(560px, 100%)" }}>
        <div className="modal__head">
          <span className="modal__title">New Room</span>
        </div>

        <div className="modal__body">
          <div className="field">
            <label className="field__label" htmlFor="rm-name">
              Room name
            </label>
            <input
              id="rm-name"
              className="input"
              value={name}
              placeholder="Release Pipeline"
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="field">
            <label className="field__label" htmlFor="rm-topic">
              Topic
            </label>
            <input
              id="rm-topic"
              className="input"
              value={topic}
              placeholder="What this room is for"
              onChange={(e) => setTopic(e.target.value)}
            />
          </div>

          <div className="field">
            <span className="field__label">Agents in the room</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {agents.map((a) => (
                <label className="participant" key={a.id} style={{ cursor: "pointer" }}>
                  <Avatar agent={a} />
                  <span style={{ minWidth: 0 }}>
                    <span className="participant__name">{a.name}</span>
                    <br />
                    <span className="participant__role">{a.role}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={members.includes(a.id)}
                    onChange={() => toggle(a.id)}
                    aria-label={`Include ${a.name}`}
                  />
                </label>
              ))}
            </div>
          </div>

          <div className="field">
            <label className="field__label" htmlFor="rm-orch">
              Who directs the room
            </label>
            <select
              id="rm-orch"
              className="select"
              value={orchestratorId}
              onChange={(e) => setOrchestratorId(e.target.value)}
            >
              {chosen.length === 0 && <option value="">Pick agents first</option>}
              {chosen.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} — {a.role}
                </option>
              ))}
            </select>
            <span className="field__hint">
              This agent decides who speaks next and when the run ends.
            </span>
          </div>

          {error && <p style={{ color: "var(--accent)", fontSize: 13 }}>{error}</p>}
        </div>

        <div className="modal__foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--accent"
            onClick={() => void save()}
            disabled={!name.trim() || members.length === 0 || !orchestratorId || saving}
          >
            {saving ? "Creating…" : "Create Room"}
          </button>
        </div>
      </div>
    </div>
  );
}
