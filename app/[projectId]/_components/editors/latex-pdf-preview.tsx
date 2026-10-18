"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";

import { renderLatexDocument } from "../../latex-actions";

const COMPILE_DEBOUNCE_MS = 900;

export function LatexPdfPreview({ source }: { source: string }) {
  const [pdfUrl, setPdfUrl] = useState<string>();
  const [error, setError] = useState<string>();
  const [compiling, setCompiling] = useState(false);
  const [compiledAt, setCompiledAt] = useState<number>();
  const objectUrlRef = useRef<string | undefined>(undefined);
  const mountedRef = useRef(true);
  const compilingRef = useRef(false);
  const pendingRef = useRef<string | undefined>(undefined);

  const compile = useCallback(async (next: string) => {
    if (compilingRef.current) {
      pendingRef.current = next;
      return;
    }
    compilingRef.current = true;
    if (mountedRef.current) setCompiling(true);
    try {
      const result = await renderLatexDocument(next);
      if (!mountedRef.current) return;
      if (result.success) {
        const binary = atob(result.content);
        const bytes = new Uint8Array(binary.length);
        for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
        const url = URL.createObjectURL(new Blob([bytes.slice().buffer], { type: "application/pdf" }));
        if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = url;
        setPdfUrl(url);
        setError(undefined);
        setCompiledAt(Date.now());
      } else {
        setError(result.error);
      }
    } catch (cause) {
      if (mountedRef.current) setError(cause instanceof Error ? cause.message : "LaTeX compilation failed.");
    } finally {
      compilingRef.current = false;
      if (mountedRef.current) setCompiling(false);
      const pending = pendingRef.current;
      pendingRef.current = undefined;
      if (mountedRef.current && pending !== undefined && pending !== next) void compile(pending);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
    };
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void compile(source), COMPILE_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [compile, source]);

  return (
    <div className="flex h-full min-h-0 flex-col bg-neutral-200 dark:bg-neutral-900">
      <div className="flex h-8 shrink-0 items-center justify-between border-b bg-muted/50 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        <span>PDF preview</span>
        <span className="flex items-center gap-2">
          {compiledAt ? <span className="font-normal normal-case tracking-normal">{new Date(compiledAt).toLocaleTimeString()}</span> : null}
          <button
            type="button"
            onClick={() => void compile(source)}
            disabled={compiling}
            className="rounded p-0.5 transition-colors hover:bg-muted disabled:opacity-50"
            aria-label="Recompile LaTeX"
          >
            <RefreshCw className={`size-3.5 ${compiling ? "animate-spin" : ""}`} />
          </button>
        </span>
      </div>
      {error ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[11px]">{error}</pre>
        </div>
      ) : null}
      {pdfUrl ? (
        <object data={`${pdfUrl}#toolbar=1&navpanes=0&view=FitH`} type="application/pdf" className="min-h-0 w-full flex-1 bg-neutral-200 dark:bg-neutral-900" />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 text-center text-xs text-muted-foreground">
          {compiling ? <RefreshCw className="size-5 animate-spin" /> : <AlertCircle className="size-5" />}
          <span>{compiling ? "Compiling LaTeX…" : "No PDF yet"}</span>
        </div>
      )}
    </div>
  );
}
