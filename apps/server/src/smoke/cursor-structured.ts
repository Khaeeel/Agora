/**
 * The question this answers: can the Cursor driver be trusted with the
 * orchestrator's structured decision, given Cursor has no --json-schema and the
 * object is extracted from prose rather than validated by the CLI?
 *
 * Shape below mirrors DECISION_SCHEMA in orchestrator.ts. Run n times, because
 * a single pass proves nothing about a failure mode that is intermittent by
 * nature — room rule 8.
 */
import { CursorCliDriver } from "../drivers/cursor-cli.ts";
import { config } from "../config.ts";

const N = Number(process.env.N ?? 5);

const DECISION_SCHEMA = {
  type: "object",
  properties: {
    say: { type: "string", description: "What you say out loud in the room. One short message." },
    next: {
      type: ["string", "null"],
      description: "The id of the agent who should act next, or null if the work is finished.",
    },
    steps: {
      type: "array",
      description: "Every plan step whose status changed this turn.",
      items: {
        type: "object",
        properties: {
          index: { type: "number", description: "0-based index into the plan." },
          status: { type: "string", enum: ["pending", "active", "done", "blocked"] },
          note: { type: ["string", "null"], description: "Short reason, required when blocked." },
        },
        required: ["index", "status"],
      },
    },
  },
  required: ["say", "next", "steps"],
};

const PROMPT = `Your plan for "Ship the image-gen tab":
  0. Build the ComfyUI graph — ana [active]
  1. Wire it into the image tab — ana [pending]
  2. Define eval criteria — ceb [pending]

Ana just reported: "Graph is built and wired into the tab. I could not run a
test job — the schnell weights are not on the machine."

Decide the next turn.`;

const STATUSES = new Set(["pending", "active", "done", "blocked"]);

/** Returns null when valid, else the first thing wrong with it. */
function validate(o: unknown): string | null {
  if (o === null || typeof o !== "object") return "not an object";
  const d = o as Record<string, unknown>;
  if (typeof d["say"] !== "string") return `say is ${typeof d["say"]}, want string`;
  if (!(typeof d["next"] === "string" || d["next"] === null)) {
    return `next is ${typeof d["next"]}, want string|null`;
  }
  if (!Array.isArray(d["steps"])) return `steps is ${typeof d["steps"]}, want array`;
  for (const [i, s] of (d["steps"] as unknown[]).entries()) {
    if (s === null || typeof s !== "object") return `steps[${i}] not an object`;
    const st = s as Record<string, unknown>;
    if (typeof st["index"] !== "number") return `steps[${i}].index is ${typeof st["index"]}, want number`;
    if (typeof st["status"] !== "string" || !STATUSES.has(st["status"])) {
      return `steps[${i}].status = ${JSON.stringify(st["status"])}, not in enum`;
    }
  }
  return null;
}

const driver = new CursorCliDriver();
const controller = new AbortController();

console.log(`model  ${config.cursorModel}   runs  ${N}\n`);

let pass = 0;
const failures: string[] = [];

for (let i = 1; i <= N; i++) {
  let structured: unknown = null;
  let isError = false;
  let text = "";
  const started = Date.now();

  for await (const event of driver.run({
    systemPrompt: "You are N0tail, the run director. Terse.",
    prompt: PROMPT,
    model: config.model,
    effort: config.effort,
    tools: [],
    addDirs: [],
    mcp: [],
    allow: [],
    mcpConfigs: [],
    schema: DECISION_SCHEMA,
    phase: "deciding",
    signal: controller.signal,
  })) {
    if (event.type === "final") {
      structured = event.structured;
      isError = event.isError;
      text = event.text;
    }
  }

  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const problem = isError ? `driver error: ${text.slice(0, 200)}` : validate(structured);

  if (problem === null) {
    pass++;
    const d = structured as Record<string, unknown>;
    console.log(`run ${i}  OK    ${secs}s  next=${JSON.stringify(d["next"])} steps=${(d["steps"] as unknown[]).length}`);
  } else {
    failures.push(`run ${i}: ${problem}`);
    console.log(`run ${i}  FAIL  ${secs}s  ${problem}`);
  }
}

console.log(`\nvalid ${pass}/${N}`);
if (failures.length) {
  console.log("\nfailures:");
  for (const f of failures) console.log("  " + f);
}
process.exit(pass === N ? 0 : 1);
