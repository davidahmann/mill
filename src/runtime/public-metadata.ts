import { ExitCode, MillError } from "../errors.js";

/** Public summaries are not a transport for commit bodies or author identity. */
export function publicPullRequestTitle(message: string): string {
  const subject =
    (message.split(/\r?\n/u, 1)[0] ?? "").split(
      /\b(?:Signed-off-by|Co-authored-by|Reviewed-by):/iu,
      1,
    )[0] ?? "";
  const title = subject
    .replaceAll(
      /[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9.-]+\.[A-Z]{2,}/giu,
      "[email redacted]",
    )
    .replaceAll(/\p{C}/gu, " ")
    .trim()
    .slice(0, 240);
  if (title.length === 0) {
    throw new MillError(
      "PUBLIC_TITLE_EMPTY",
      "The commit must have a nonempty public subject without trailers.",
      ExitCode.configuration,
    );
  }
  return title;
}
