/** The origin (scheme, host and port) of a URL; empty when it isn't one. */
export const originOf = (url: string) => { try { return new URL(url).origin; } catch { return ''; } };

/**
 * The headers for one hop of a request that may be redirected. A login belongs to the origin it was given for, so
 * it travels only to that origin: a hop to anywhere else gets none of the caller's `Authorization` and only whatever
 * login the user stored for that other origin. (`net.request` re-sends the headers it started with on every hop, so
 * this is decided here.)
 */
export function hopHeaders(
  caller: Record<string, string> | undefined,
  startUrl: string,
  hopUrl: string,
  userAgent: string,
  loginFor: (url: string) => Record<string, string>,
): Record<string, string> {
  const home = originOf(hopUrl) === originOf(startUrl);
  const kept = Object.fromEntries(Object.entries(caller ?? {}).filter(([name]) => home || name.toLowerCase() !== 'authorization'));
  return { 'User-Agent': userAgent, ...loginFor(hopUrl), ...kept };
}
