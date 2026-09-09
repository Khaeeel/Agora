import { useEffect, useState } from "react";
import type { Agent } from "../lib/types.ts";

const MODELS = ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"];
const EFFORTS = ["low", "medium", "high", "xhigh", "max"];

export interface AgentDraft {
  name: string;
  role: string;
  description: string;
  instructions: string;
  personality: string;
  color: string;
  model: string;
  effort: string;
  orchestrator: boolean;
  /* Capabilities are not editable in this form, but they MUST round-trip.
     Dropping them here silently revoked an agent's repo and browser access on
     save — an edit that looked like a model change and was a downgrade. */
  tools: string[];
  addDirs: string[];
  mcp: string[];
  allow: string[];
}

const EMPTY: AgentDraft = {
  name: "",
  role: "",
  description: "",
  instructions: "",
  personality: "",
  color: "#7A6A5D",
  model: "claude-sonnet-5",
  effort: "low",
  orchestrator: false,
  tools: [],
  addDirs: [],
  mcp: [],
  allow: [],
};

function fromAgent(a: Agent): AgentDraft {
  return {
    name: a.name,
    role: a.role,
    description: a.description,
    instructions: a.instructions,
    personality: a.personality,
    color: a.color,
    model: a.model,
    effort: a.effort,
    orchestrator: a.orchestrator,
    tools: a.tools,
    addDirs: a.addDirs,
    mcp: a.mcp,
    allow: a.allow,
  };
}

export function AgentEditor({
  agent,
  onClose,
  onSaved,
}: {
  /** Present = editing that agent. Absent = creating a new one. */
  agent?: Agent;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = agent !== undefined;
  const [draft, setDraft] = useState<AgentDraft>(agent ? fromAgent(agent) : EMPTY);
  const [markdown, setMarkdown] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview comes from the server, so what you see is exactly what gets written.
  useEffect(() => {
    const t = setTimeout(() => {
      void (async () => {
        const res = await fetch("/api/agents/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(draft),
        });
        const data = (await res.json()) as { markdown: string };
        setMarkdown(data.markdown);
      })();
    }, 200);
    return () => clearTimeout(t);
  }, [draft]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const set = <K extends keyof AgentDraft>(key: K, value: AgentDraft[K]): void =>
    setDraft((d) => ({ ...d, [key]: value }));

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(editing ? `/api/agents/${agent.id}` : "/api/agents", {
        method: editing ? "PUT" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? `Request failed (${res.status})`);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const slug = draft.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const fileId = editing ? agent.id : slug;

  return (
    <div
      className="scrim"
      role="dialog"
      aria-modal="true"
      aria-label={editing ? `Edit ${agent.name}` : "Create new agent"}
    >
      <div className="modal">
        <div className="modal__head">
          <span className="modal__title">
            {editing ? `Edit ${agent.name}` : "Create New Agent"}
          </span>
          {editing && (
            <span className="chip" style={{ marginLeft: 10 }}>
              agents/{agent.id}.md
            </span>
          )}
        </div>

        <div className="modal__body">
          <div className="split">
            <div>
              <div className="field">
                <label className="field__label" htmlFor="ag-name">
                  Name
                </label>
                <input
                  id="ag-name"
                  className="input"
                  value={draft.name}
                  placeholder="Atlas"
                  onChange={(e) => set("name", e.target.value)}
                />
                <span className="field__hint">
                  {editing
                    ? `Renaming keeps the same file (agents/${agent.id}.md), so rooms
                       using this agent stay intact.`
                    : `Writes ${slug ? `agents/${slug}.md` : "agents/<name>.md"}`}
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="ag-role">
                  Role
                </label>
                <input
                  id="ag-role"
                  className="input"
                  value={draft.role}
                  placeholder="Research Agent"
                  onChange={(e) => set("role", e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="ag-desc">
                  Skills — what this agent can do
                </label>
                <textarea
                  id="ag-desc"
                  className="textarea"
                  value={draft.description}
                  placeholder="Researches information, validates sources, and reports findings to other agents."
                  onChange={(e) => set("description", e.target.value)}
                />
                <span className="field__hint">
                  This is the agent's capability, not a bio. It becomes the
                  skills section of its prompt — the agent is told to work only
                  within it and to hand off anything outside it. Editing this
                  changes what the agent will actually take on.
                </span>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="ag-inst">
                  Instructions — how it works
                </label>
                <textarea
                  id="ag-inst"
                  className="textarea"
                  value={draft.instructions}
                  placeholder={"- Research before concluding.\n- Cite sources."}
                  onChange={(e) => set("instructions", e.target.value)}
                />
              </div>

              <div className="field">
                <label className="field__label" htmlFor="ag-pers">
                  Personality
                </label>
                <textarea
                  id="ag-pers"
                  className="textarea"
                  style={{ minHeight: 56 }}
                  value={draft.personality}
                  placeholder="Analytical, concise, evidence-driven."
                  onChange={(e) => set("personality", e.target.value)}
                />
              </div>

              <div className="split" style={{ gap: 12 }}>
                <div className="field">
                  <label className="field__label" htmlFor="ag-model">
                    Model
                  </label>
                  <select
                    id="ag-model"
                    className="select"
                    value={draft.model}
                    onChange={(e) => set("model", e.target.value)}
                  >
                    {MODELS.map((m) => (
                      <option key={m} value={m}>
                        {m}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label className="field__label" htmlFor="ag-effort">
                    Effort
                  </label>
                  <select
                    id="ag-effort"
                    className="select"
                    value={draft.effort}
                    onChange={(e) => set("effort", e.target.value)}
                  >
                    {EFFORTS.map((e) => (
                      <option key={e} value={e}>
                        {e}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="field">
                <label className="field__label" htmlFor="ag-color">
                  Colour
                </label>
                <input
                  id="ag-color"
                  className="input"
                  type="color"
                  style={{ height: 38, padding: 4 }}
                  value={draft.color}
                  onChange={(e) => set("color", e.target.value)}
                />
              </div>

              <label className="checkline">
                <input
                  type="checkbox"
                  checked={draft.orchestrator}
                  onChange={(e) => set("orchestrator", e.target.checked)}
                />
                Can direct a room (orchestrator)
              </label>

              {(draft.tools.length > 0 ||
                draft.mcp.length > 0 ||
                draft.allow.length > 0) && (
                <p className="field__hint">
                  Capabilities from the file — kept as-is when you save, edit the
                  markdown to change them:
                  {draft.tools.length > 0 && ` tools ${draft.tools.join(", ")};`}
                  {draft.mcp.length > 0 && ` mcp ${draft.mcp.join(", ")};`}
                  {draft.allow.length > 0 && ` allow ${draft.allow.join(", ")};`}
                  {draft.addDirs.length > 0 && ` reads ${draft.addDirs.join(", ")}`}
                </p>
              )}

              {error && (
                <p style={{ color: "var(--accent)", fontSize: 13 }}>{error}</p>
              )}
            </div>

            <div>
              <div className="field__label" style={{ marginBottom: 6 }}>
                {fileId ? `agents/${fileId}.md` : "File preview"}
              </div>
              <pre className="preview">{markdown}</pre>
            </div>
          </div>
        </div>

        <div className="modal__foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn--accent"
            onClick={() => void save()}
            disabled={!draft.name.trim() || saving}
          >
            {saving
              ? editing
                ? "Saving…"
                : "Creating…"
              : editing
                ? "Save changes"
                : "Create Agent"}
          </button>
        </div>
      </div>
    </div>
  );
}
