export const ExitCode = {
  ok: 0,
  usage: 64,
  data: 65,
  unavailable: 69,
  io: 74,
  temporary: 75,
  configuration: 78,
} as const;

export type ExitCode = (typeof ExitCode)[keyof typeof ExitCode];

export class MillError extends Error {
  readonly code: string;
  readonly exitCode: ExitCode;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    exitCode: ExitCode,
    details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "MillError";
    this.code = code;
    this.exitCode = exitCode;
    this.details = details;
  }
}

export function asMillError(error: unknown): MillError {
  if (error instanceof MillError) {
    return error;
  }
  if (error instanceof Error) {
    return new MillError("INTERNAL_ERROR", error.message, ExitCode.io);
  }
  return new MillError("INTERNAL_ERROR", String(error), ExitCode.io);
}
