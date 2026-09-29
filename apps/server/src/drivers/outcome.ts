export type DriverErrorCode =
  | "spawn_failed"
  | "nonzero_exit"
  | "cancelled"
  | "timeout"
  | "unparseable";

export interface DriverFailure {
  code: DriverErrorCode;
  message: string;
  exitCode: number | null;
  stderr: string;
}

export function classifyExit(input: {
  code: number;
  aborted: boolean;
  timedOut?: boolean;
  sawResult: boolean;
  stderr: string;
}): DriverFailure | null {
  const stderr = input.stderr.trim().slice(-500);
  if (input.timedOut) {
    return { code: "timeout", message: "turn timed out", exitCode: input.code, stderr };
  }
  if (input.aborted) {
    return { code: "cancelled", message: "turn cancelled", exitCode: input.code, stderr };
  }
  if (!input.sawResult && input.code === -1) {
    return {
      code: "spawn_failed",
      message: stderr || "the driver process could not be started",
      exitCode: null,
      stderr,
    };
  }
  if (!input.sawResult) {
    return {
      code: "unparseable",
      message: stderr || `driver exited ${input.code} without a result`,
      exitCode: input.code,
      stderr,
    };
  }
  if (input.code !== 0) {
    return {
      code: "nonzero_exit",
      message: stderr || `driver exited ${input.code}`,
      exitCode: input.code,
      stderr,
    };
  }
  return null;
}
