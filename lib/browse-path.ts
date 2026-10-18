// A "Browse" tab is a transient, non-file tab whose path encodes a remote URL.
// The URL is percent-encoded so the synthetic path never contains slashes.
export const BROWSE_PATH_PREFIX = "browse:";

export function browsePath(url: string) {
  return `${BROWSE_PATH_PREFIX}${encodeURIComponent(url)}`;
}

export function isBrowsePath(path: string) {
  return path.startsWith(BROWSE_PATH_PREFIX);
}

export function browseUrlFromPath(path: string) {
  if (!isBrowsePath(path)) return undefined;
  try {
    return decodeURIComponent(path.slice(BROWSE_PATH_PREFIX.length));
  } catch {
    return undefined;
  }
}

/** Adds a scheme and validates; returns the normalized URL or an error. */
export function normalizeBrowseUrl(raw: string): { url: string } | { error: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { error: "Enter a URL." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withScheme);
    if (url.protocol !== "http:" && url.protocol !== "https:") return { error: "Only http(s) URLs are supported." };
    return { url: url.toString() };
  } catch {
    return { error: "That isn't a valid URL." };
  }
}
