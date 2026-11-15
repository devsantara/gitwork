/**
 * One Project's line in a command's results: its name padded to `width`,
 * then its outcome and the details that explain it, e.g. `web  skipped: dirty`.
 */
export function outcomeLine(
  name: string,
  width: number,
  outcome: string,
  details: readonly string[],
): string {
  const said =
    details.length > 0 ? `${outcome}: ${details.join(', ')}` : outcome;
  return `${name.padEnd(width)}  ${said}`;
}

/**
 * How many Projects had each outcome, in the order of `outcomes`, leaving out
 * any that none had, e.g. "2 cloned, 1 failed".
 */
export function outcomeSummary(
  outcomes: readonly string[],
  results: readonly { outcome: string }[],
): string {
  return outcomes
    .flatMap((outcome) => {
      const count = results.filter((r) => r.outcome === outcome).length;
      return count > 0 ? [`${count} ${outcome}`] : [];
    })
    .join(', ');
}
