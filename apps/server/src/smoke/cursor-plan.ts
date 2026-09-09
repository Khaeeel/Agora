/**
 * The planning turn is the one that runs on opus and the one everything else
 * is measured against. Its schema is bigger than the decision schema — six
 * required fields, two enums, a nested array with additionalProperties:false —
 * so it is the real test of extracting JSON instead of having the CLI enforce
 * it. Shape mirrors PLAN_SCHEMA in orchestrator.ts.
 */
import { CursorCliDriver } from "../drivers/cursor-cli.ts";
import { config } from "../config.ts";

const N = Number(process.env.N ?? 3);

const PLAN_SCHEMA = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["answer", "work"] },
    responder: { type: ["string", "null"] },
    needsLookup: { type: "boolean" },
    discuss: { type: ["array", "null"], items: { type: "string" } },
    goal: { type: "string", description: "The goal in one line, as an outcome rather than an activity." },
    steps: {
      type: "array",
      description: "Between 2 and 6 steps, in dependency order. Each is checkable.",
      items: {
        type: "object",
        properties: {
          title: { type: "string", description: "One line, starts with a verb." },
          owner: { type: ["string", "null"] },
        },
        required: ["title", "owner"],
        additionalProperties: false,
      },
    },
  },
  required: ["mode", "responder", "discuss", "needsLookup", "goal", "steps"],
  additionalProperties: false,
};

const PROMPT = `Room: Trunks. Agents: gaben (architect), n0tail (run director),
collapse (inference), yatoro (video), ana (image), topson (data), ceb (eval).

Dominic says: "The image-gen tab is built but has never run. Get it to the point
where one real image comes out, and tell me what it cost in VRAM."

Plan it.`;

function validate(o: unknown): string | null {
  if (o === null || typeof o !== "object") return "not an object";
  const d = o as Record<string, unknown>;
  if (d["mode"] !== "answer" && d["mode"] !== "work") return `mode = ${JSON.stringify(d["mode"])}`;
  if (!(typeof d["responder"] === "string" || d["responder"] === null)) return "responder wrong type";
  if (typeof d["needsLookup"] !== "boolean") return `needsLookup is ${typeof d["needsLookup"]}`;
  if (!(Array.isArray(d["discuss"]) || d["discuss"] === null)) return "discuss wrong type";
  if (typeof d["goal"] !== "string" || !d["goal"]) return "goal missing";
  if (!Array.isArray(d["steps"])) return "steps not an array";
  const steps = d["steps"] as unknown[];
  if (steps.length < 2 || steps.length > 6) return `steps length ${steps.length}, want 2-6`;
  for (const [i, s] of steps.entries()) {
    if (s === null || typeof s !== "object") return `steps[${i}] not an object`;
    const st = s as Record<string, unknown>;
    if (typeof st["title"] !== "string" || !st["title"]) return `steps[${i}].title missing`;
    if (!(typeof st["owner"] === "string" || st["owner"] === null)) return `steps[${i}].owner wrong type`;
    for (const k of Object.keys(st)) {
      if (k !== "title" && k !== "owner") return `steps[${i}] has extra key "${k}" (additionalProperties:false)`;
    }
  }
  return null;
}

const driver = new CursorCliDriver();
const controller = new AbortController();

console.log(`plan model  ${config.cursorPlanModel}   runs  ${N}\n`);

let pass = 0;
for (let i = 1; i <= N; i++) {
  let structured: unknown = null;
  let isError = false;
  let text = "";
  const started = Date.now();

  for await (const event of driver.run({
    systemPrompt: "You are the orchestrator. Terse.",
    prompt: PROMPT,
    model: config.model,
    effort: config.effort,
    tools: [],
    addDirs: [],
    mcp: [],
    allow: [],
    mcpConfigs: [],
    schema: PLAN_SCHEMA,
    phase: "planning",
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
    const steps = d["steps"] as Array<{ title: string; owner: string | null }>;
    console.log(`run ${i}  OK    ${secs}s  mode=${d["mode"]} steps=${steps.length}`);
    for (const s of steps) console.log(`         - ${s.owner ?? "unassigned"}: ${s.title}`);
  } else {
    console.log(`run ${i}  FAIL  ${secs}s  ${problem}`);
  }
}

console.log(`\nvalid ${pass}/${N}`);
process.exit(pass === N ? 0 : 1);
