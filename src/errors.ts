/**
 * A problem the user can fix. main() prints any `details` lines, then the message,
 * and exits 1, without a stack trace.
 */
export class UserError extends Error {
  override name = 'UserError';

  constructor(
    message: string,
    readonly details: readonly string[] = [],
  ) {
    super(message);
  }
}

/** The Node error code (e.g. "ENOENT") carried by `error`, if any. */
export function errorCode(error: unknown): string | undefined {
  const code =
    error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return typeof code === 'string' ? code : undefined;
}
