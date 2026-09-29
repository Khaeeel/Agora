/**
 * Read-only replay. This walks messages that were already stored.
 * It does not import a driver and it does not start a run.
 */
export interface ReplayMessage {
  seq: number;
  authorId: string;
  kind: string;
  text: string;
}

export interface Replay {
  live: false;
  executesTools: false;
  messages: ReplayMessage[];
}

export function replayTranscript(messages: readonly ReplayMessage[]): Replay {
  const ordered = [...messages].sort((a, b) => a.seq - b.seq);
  return { live: false, executesTools: false, messages: ordered };
}
