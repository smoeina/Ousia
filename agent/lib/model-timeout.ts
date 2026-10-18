// Local turns have no wall-clock deadline. An optional request timeout can be
// configured for installations that want to bound a single OpenRouter call.
// `extraHeaders` are applied last so a provider can pin headers the AI SDK
// would otherwise overwrite (for example its own user agent).
export function timedModelFetch(extraHeaders: Record<string, string> = {}): typeof fetch {
  return (input, init) => {
    const headers = new Headers(input instanceof Request ? input.headers : undefined);
    new Headers(init?.headers).forEach((value, key) => headers.set(key, value));
    for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
    const timeoutMs = Number(process.env.OPENROUTER_REQUEST_TIMEOUT_MS);
    const next: RequestInit = { ...init, headers };
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) return fetch(input, next);
    const timeout = AbortSignal.timeout(timeoutMs);
    const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
    next.signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    return fetch(input, next);
  };
}
