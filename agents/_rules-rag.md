# Room rules — RAG

This room builds a chatbot for the HQ website that answers from KooyaPedia
through a local open-source model. These rules are mostly for the orchestrator's
plan turn; the responders read them so they know what a good plan looks like
and can say so when a step does not fit.

## How a plan is made here

A plan is not a to-do list. It answers four questions, in this order:

1. **What will exist when this is done, and how will we know?** The goal line is
   an outcome someone can check afterwards, never an activity. "A widget on the
   HQ site answers a question whose answer is only on one wiki page, citing the
   slug" is a goal. "Create the agents for the chatbot" is not.
2. **How does it get built?** For anything that creates something new (a
   service, an endpoint, a widget, a wrapper, an experiment), step 1 is a
   design, five lines, posted as a `result` by the agent who read the code:
   pieces, flow, where (repo, host, port, table), interfaces, risks. Steps that
   follow take their dependency order from that design.
3. **Who can do each piece, with the grants they hold?** Derive lanes from the
   verbs: read, build, run, verify, decide. One owner per lane. Two to four
   owners for most goals. The verifier is never the builder.
4. **What is the smallest set of one-turn steps that proves it?** Two to six
   steps. Each starts with a verb and names the evidence it produces.

## Before writing the plan

- If Dominic's message is a green light or an answer to a blocker, resume the
  stalled goal with the same owners. Do not open a new goal.
- Read the roster line, including the grants. Assign only holders.
- Name every unknown you cannot look up from here (a repo path, a host, a
  port, whether a service is up). An unknown that only Dominic can answer goes
  in step 0 as "Blocked until Dominic says X", so the run stops in the first
  turn with a clear ask instead of five turns later with a vague one.
- If the work depends on a service being up, step 0 checks it, owned by
  someone who can run the check, with "if down, report and stop".

## Spawning is not capability

A forged agent has exactly its template's grants: a researcher reads the web
and the two lookup wrappers, a mechanic edits agent prompts, a helper reasons
from the transcript. None of them can write code into a project folder or run
a service. If a lane needs a grant nobody on the roster holds, say so in the
goal line or step 0; only Dominic grants. Do not spawn three agents to cover a
lane that a template cannot fill, and do not spawn a second agent for a lane
that one holder can cover in two steps.

## Steps

- Not a report. "Report back", "summarise", "cite" are not steps; every reply
  is already a report and the run report reaches WhatsApp by itself.
- Not a plan-level power. Spawn, access, and new rooms are plan fields, never
  steps assigned to an agent.
- Honest `dependsOn`: steps with different owners and no real dependency run
  in parallel; a step that consumes another's evidence waits for it.
- The last step verifies the outcome, owned by someone other than the builder.

## Checklist before returning the plan

- Follow-up to the last goal? Then resume, not plan.
- Goal line is an outcome someone can check.
- Build goal? Step 1 is the design by whoever read the code.
- Step 0 names the precondition or the blocker only Dominic can clear.
- One owner per lane; two to four owners; every owner holds the grant.
- No report steps, no spawn/grant/room steps.
- Each step names its evidence; `dependsOn` honest both ways.
- Last step verifies, not by the builder.

## Verified facts — checked 2026-09-11; re-check before contradicting them

- **This PC has an NVIDIA GPU**: RTX 4070 SUPER, 12 GB, driver 591.86. WSL sees
  it at `/usr/lib/wsl/lib/nvidia-smi`, a directory a sandboxed PATH often
  lacks — a missing `nvidia-smi` on PATH is not "no driver". The vLLM image sees
  the GPU too, through `docker run --gpus all`. Never report "walang GPU" or
  "walang NVIDIA driver dito".
- **Nothing is left to install.** `vllm/vllm-openai:v0.22.1` is pulled, and the
  `llm/Qwen3-4B-Instruct-2507` weights in
  `/mnt/c/Projects/HelloAlex-Local-Model/models/llm/Qwen3-4B-Instruct-2507`
  match `serving/models.lock` file for file.
- **Serve the weights where they are.** Dominic decided not to copy them into
  `C:\Projects\HQ-RAG-Chatbot`.
- **What is not done is serving.** `.env.gpu` in HelloAlex-Local-Model is for
  the production GPU host: the 8B AWQ model, host 10.0.1.20, `/data/models`,
  0.70 GPU memory and a 20–24 GB container memory reserve. None of that fits
  this 12 GB card and 16 GB WSL VM. Serving here needs host settings Dominic
  has not chosen yet — say exactly that, never "GPU-blocked".
- The GPU is shared with the Voicemail Detection room's training runs.

## Doing, not just reporting

To check the GPU, the image or the weights, run
`bash /home/dominickooya/agora/scripts/hq-model.sh status | verify | download`.
If you do not hold it, say you need "the hq-model script": the room turns that
into an Allow button for Dominic. Never ask for broad shell or Bash.
