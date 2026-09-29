/**
 * Boot recovery.
 *
 * A crash leaves goals `active` with no live run. Reconciliation marks those
 * `stopped`. Resume only the goals that were active at the moment of boot
 * and still have unfinished steps. Goals that were already stopped stay stopped.
 */
export function selectBootResumes(
  activeBefore: readonly string[],
  after: readonly { id: string; open: boolean }[],
): string[] {
  const wasActive = new Set(activeBefore);
  const picked: string[] = [];
  for (const goal of after) {
    if (wasActive.has(goal.id) && goal.open && !picked.includes(goal.id)) picked.push(goal.id);
  }
  return picked;
}
