import { NextRequest } from "next/server";
import { promises as dns } from "node:dns";
import { isIP } from "node:net";

import { getUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

const MAX_HTML_BYTES = 6_000_000;
const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Safari/537.36";

function isPrivateIpv4(address: string) {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || a >= 224;
}

function isPrivateIp(address: string) {
  const version = isIP(address);
  if (version === 4) return isPrivateIpv4(address);
  if (version !== 6) return true;
  const normalized = address.toLowerCase();
  if (normalized.startsWith("::ffff:")) return isPrivateIpv4(normalized.slice(7));
  return normalized === "::" || normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || /^fe[89ab]/.test(normalized);
}

async function assertPublicUrl(value: string) {
  const url = new URL(value);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Only http(s) URLs are supported.");
  const hostname = url.hostname.toLowerCase();
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("That address is not allowed.");
  }
  if (isIP(hostname) && isPrivateIp(hostname)) throw new Error("That address is not allowed.");
  // A DNS name that resolves to a private address is also rejected.
  if (!isIP(hostname)) {
    const addresses = await dns.lookup(hostname, { all: true, verbatim: true }).catch(() => []);
    if (addresses.some(({ address }) => isPrivateIp(address))) throw new Error("That address is not allowed.");
  }
  return url;
}

export async function GET(request: NextRequest) {
  if (!(await getUser())) return new Response("Unauthorized", { status: 401 });
  const raw = request.nextUrl.searchParams.get("url");
  if (!raw) return new Response("Missing url", { status: 400 });
  let target: URL;
  try {
    target = await assertPublicUrl(raw);
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Invalid URL", { status: 400 });
  }

  let response: Response;
  try {
    response = await fetch(target, {
      headers: {
        "user-agent": CHROME_UA,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
        "upgrade-insecure-requests": "1",
      },
      redirect: "follow",
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
  } catch {
    return new Response("Could not load the page", { status: 502 });
  }

  const contentType = response.headers.get("content-type") ?? "application/octet-stream";
  const buffer = Buffer.from(await response.arrayBuffer());
  const body = buffer.byteLength > MAX_HTML_BYTES ? buffer.subarray(0, MAX_HTML_BYTES) : buffer;

  if (contentType.includes("text/html")) {
    let html = body.toString("utf8");
    // Resolve relative assets against the final (post-redirect) URL.
    const baseTag = `<base href="${response.url}">`;
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head[^>]*>/i, (match) => `${match}${baseTag}`);
    else html = `${baseTag}${html}`;
    return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
  }

  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}
