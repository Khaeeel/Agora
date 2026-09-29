import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable, Writable } from "node:stream";

/**
 * Spawn one agent CLI and make cancellation kill the process group.
 *
 * On Linux the child is its own group (`detached: true` without `unref`),
 * so an abort sends SIGTERM to the group, not only the direct child.
 * Cursor and Claude both start grandchildren; killing the child alone
 * leaves those behind. Windows has no negative-pid groups, so the
 * AbortSignal on `spawn` is the kill there.
 */
export function spawnAgent(
  command: string,
  args: string[],
  options: { cwd: string; signal: AbortSignal },
): ChildProcessByStdio<Writable, Readable, Readable> {
  const grouped = process.platform !== "win32";
  const child = spawn(command, args, {
    cwd: options.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    signal: options.signal,
    detached: grouped,
  });

  // Node emits `error` with AbortError when `signal` fires. With no listener
  // that becomes an uncaught exception and takes the server down on Stop.
  child.on("error", () => {});

  const killGroup = (): void => {
    if (!grouped || !child.pid) return;
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      // The group is already gone.
    }
  };

  if (options.signal.aborted) killGroup();
  else options.signal.addEventListener("abort", killGroup, { once: true });

  child.on("exit", () => {
    options.signal.removeEventListener("abort", killGroup);
  });

  return child;
}
