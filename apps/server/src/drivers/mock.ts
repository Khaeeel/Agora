import type { AgentDriver, DriverEvent, DriverRequest } from "./types.ts";

/**
 * A driver that yields a scripted event list. Tests use this so nothing
 * needs a Cursor or Claude login.
 */
export class MockDriver implements AgentDriver {
  readonly id = "mock";
  readonly calls: DriverRequest[] = [];
  private readonly script: DriverEvent[] | ((req: DriverRequest) => DriverEvent[]);

  constructor(script: DriverEvent[] | ((req: DriverRequest) => DriverEvent[])) {
    this.script = script;
  }

  async *run(req: DriverRequest): AsyncIterable<DriverEvent> {
    this.calls.push(req);
    if (req.signal.aborted) {
      yield {
        type: "final",
        text: "(stopped)",
        structured: null,
        costUsd: null,
        isError: true,
        failure: { code: "cancelled", message: "turn cancelled", exitCode: null, stderr: "" },
        exitCode: null,
        pid: null,
      };
      return;
    }
    const events = typeof this.script === "function" ? this.script(req) : this.script;
    for (const event of events) {
      if (req.signal.aborted) return;
      yield event;
    }
  }
}
