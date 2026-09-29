/**
 * Mind-stone writes. An empty update must not wipe a stone that already
 * has text. A real update replaces it and keeps the previous text so the
 * overwrite is visible.
 */
export function applyMindStoneUpdate(
  previous: string | null,
  next: string,
): { content: string; conflict: boolean; reason?: string; previous: string | null } {
  const trimmed = next.trim();
  if (!trimmed && previous && previous.trim()) {
    return {
      content: previous,
      conflict: true,
      reason: "empty update would wipe the existing stone",
      previous,
    };
  }
  return { content: next, conflict: false, previous: previous && previous !== next ? previous : null };
}
