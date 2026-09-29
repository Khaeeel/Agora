export function redact(text: string): string {
  return text
    .replace(/\bsk-[A-Za-z0-9]{10,}\b/g, "[redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted]")
    .replace(/\b(api[_-]?key|password|secret|token)\b(\s*[:=]\s*)(\S+)/gi, "$1$2[redacted]");
}

export interface DiagnosticSummary {
  roomId: string;
  roomName: string;
  observed: {
    messages: number;
    goals: number;
    goalsDone: number;
    activeRun: boolean;
    stopReason: string | null;
    phase: string | null;
  };
  /** Last few lines, secrets removed. Not an inference about why the run ended. */
  recent: string[];
}

export function buildDiagnostics(input: {
  roomId: string;
  roomName: string;
  messages: Array<{ text: string }>;
  goals: Array<{ status: string }>;
  run: { active: boolean; stopReason: string | null; phase: string | null } | null;
}): DiagnosticSummary {
  return {
    roomId: input.roomId,
    roomName: input.roomName,
    observed: {
      messages: input.messages.length,
      goals: input.goals.length,
      goalsDone: input.goals.filter((goal) => goal.status === "done").length,
      activeRun: input.run?.active ?? false,
      stopReason: input.run?.stopReason ?? null,
      phase: input.run?.phase ?? null,
    },
    recent: input.messages.slice(-5).map((message) => redact(message.text).slice(0, 240)),
  };
}
