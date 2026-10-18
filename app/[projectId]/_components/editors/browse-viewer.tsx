"use client";

import { useMemo, useState } from "react";
import { ExternalLink, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { browseUrlFromPath, normalizeBrowseUrl } from "@/lib/browse-path";
import type { WorkspaceEditorProps } from "./types";

/**
 * An in-app browser tab. Pages are fetched server-side with Chrome headers
 * (see `/api/browse`) and rendered in a sandboxed iframe, so remote scripts
 * cannot reach the app origin.
 */
export function BrowseViewer({ file }: WorkspaceEditorProps) {
  const initial = browseUrlFromPath(file.path) ?? "";
  const [url, setUrl] = useState(initial);
  const [input, setInput] = useState(initial);
  const [nonce, setNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  const src = useMemo(() => `/api/browse?url=${encodeURIComponent(url)}&_=${nonce}`, [url, nonce]);

  const navigate = (raw: string) => {
    const result = normalizeBrowseUrl(raw);
    if ("error" in result) { setError(result.error); return; }
    setError(undefined);
    setLoading(true);
    setUrl(result.url);
    setInput(result.url);
    setNonce((value) => value + 1);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center gap-1.5 border-b bg-muted/40 px-2 py-1.5">
        <Button size="icon-xs" variant="ghost" title="Reload" onClick={() => { setLoading(true); setNonce((value) => value + 1); }}>
          <RefreshCw className={loading ? "animate-spin" : ""} />
        </Button>
        <form className="flex min-w-0 flex-1 items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); navigate(input); }}>
          <Input value={input} onChange={(event) => setInput(event.target.value)} className="h-8 min-w-0 flex-1" placeholder="https://…" aria-label="Address" />
          <Button type="submit" size="sm" className="h-8">Go</Button>
        </form>
        <Button size="icon-xs" variant="ghost" title="Open in a new browser tab" onClick={() => window.open(url, "_blank", "noopener,noreferrer")}>
          <ExternalLink />
        </Button>
      </div>
      {error ? <p className="border-b bg-destructive/10 px-3 py-1.5 text-xs text-destructive">{error}</p> : null}
      <div className="relative min-h-0 flex-1">
        {loading ? <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-0.5 animate-pulse bg-primary" /> : null}
        <iframe
          key={`${url}:${nonce}`}
          src={src}
          title={url || "Browse"}
          sandbox="allow-scripts allow-popups allow-forms allow-pointer-lock"
          referrerPolicy="no-referrer"
          className="h-full w-full bg-white"
          onLoad={() => setLoading(false)}
        />
      </div>
    </div>
  );
}
