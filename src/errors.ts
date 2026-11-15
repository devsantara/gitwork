/** A problem the user can fix. main() prints its message and exits 1, without a stack trace. */
export class UserError extends Error {
  override name = "UserError";
}

/** The Node error code (e.g. "ENOENT") carried by `error`, if any. */
export function errorCode(error: unknown): string | undefined {
  const code = error instanceof Error ? (error as NodeJS.ErrnoException).code : undefined;
  return typeof code === "string" ? code : undefined;
}
