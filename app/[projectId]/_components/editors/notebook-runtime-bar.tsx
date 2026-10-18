"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Check, ExternalLink, Loader2, LogIn, Play, RotateCw, Square, SquareTerminal } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getJupyterStatus, runNotebookLocal } from "../../jupyter-actions";
import {
  cancelColab,
  connectColab,
  getColabStatus,
  runNotebook,
  sessionUrl,
  startSession,
  stopSession,
  submitColabCode,
} from "../../colab-actions";

export type NotebookBackend = "local" | "colab";

const ACCELERATORS = ["CPU", "T4", "L4", "G4", "A100", "H100"] as const;
const RUN_TIMEOUT_SECONDS = 600;

export function NotebookRuntimeBar({
  projectId,
  backend,
  onBackendChange,
  notebookJson,
  onNotebookUpdated,
}: {
  projectId: string;
  backend: NotebookBackend;
  onBackendChange: (backend: NotebookBackend) => void;
  notebookJson: string;
  onNotebookUpdated: (content: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [jupyter, setJupyter] = useState<{ installed: boolean; version?: string }>();
  const [colab, setColab] = useState<{ installed: boolean; version?: string; authenticated: boolean }>();
  const [accelerator, setAccelerator] = useState<string>("CPU");
  const [highMem, setHighMem] = useState(false);
  const [login, setLogin] = useState<{ id: string; url: string }>();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [output, setOutput] = useState<string>();
  const [sessionRunning, setSessionRunning] = useState(false);
  const [colabLink, setColabLink] = useState<string>();

  const refresh = useCallback(async () => {
    try {
      const [jupyterStatus, colabStatus] = await Promise.all([getJupyterStatus(), getColabStatus()]);
      setJupyter(jupyterStatus);
      setColab(colabStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not read runtime status.");
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    const handler = () => { onBackendChange("colab"); setOpen(true); };
    window.addEventListener("ousia:open-colab", handler);
    return () => window.removeEventListener("ousia:open-colab", handler);
  }, [onBackendChange]);

  const chooseBackend = (next: NotebookBackend) => { onBackendChange(next); setOpen(true); setError(undefined); };

  const runAll = async () => {
    setBusy("run-all");
    setError(undefined);
    setOutput(undefined);
    try {
      const result = backend === "local"
        ? await runNotebookLocal(projectId, notebookJson, RUN_TIMEOUT_SECONDS)
        : await runNotebook(projectId, notebookJson, RUN_TIMEOUT_SECONDS);
      setOutput(result.output || undefined);
      if (!result.success) { setError(result.error ?? "Notebook execution failed."); return; }
      if (result.content !== undefined) onNotebookUpdated(result.content);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Notebook execution failed.");
    } finally {
      setBusy(undefined);
    }
  };

  const connect = async () => {
    setBusy("connect");
    setError(undefined);
    setOpen(true);
    try {
      const result = await connectColab();
      if ("error" in result) { setError(result.error); return; }
      setLogin(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not start the Google sign-in.");
    } finally {
      setBusy(undefined);
    }
  };

  const submitCode = async () => {
    if (!login) return;
    setBusy("code");
    setError(undefined);
    try {
      const result = await submitColabCode(login.id, code);
      if (!result.success) { setError(result.error ?? "Sign-in failed."); return; }
      setLogin(undefined);
      setCode("");
      await refresh();
    } finally {
      setBusy(undefined);
    }
  };

  const start = async () => {
    setBusy("start");
    setError(undefined);
    setOutput(undefined);
    try {
      const result = await startSession(accelerator, highMem);
      setOutput(result.output || undefined);
      if (!result.success) { setError(result.error ?? "Could not start the Colab session."); return; }
      setSessionRunning(true);
    } finally {
      setBusy(undefined);
    }
  };

  const stop = async () => {
    setBusy("stop");
    setError(undefined);
    try {
      const result = await stopSession();
      setOutput(result.output || undefined);
      if (!result.success) { setError(result.error ?? "Could not stop the session."); return; }
      setSessionRunning(false);
    } finally {
      setBusy(undefined);
    }
  };

  const openInColab = async () => {
    setBusy("url");
    try {
      const result = await sessionUrl();
      const url = result.output.match(/https:\/\/[^\s]+/)?.[0];
      if (!result.success || !url) { setError(result.error ?? "No Colab URL is available yet."); return; }
      setColabLink(url);
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(undefined);
    }
  };

  const statusText = backend === "local"
    ? jupyter === undefined ? "Checking…" : jupyter.installed ? `Local Jupyter ${jupyter.version ?? ""}`.trim() : "Jupyter not installed"
    : colab === undefined ? "Checking…" : !colab.installed ? "CLI not installed" : colab.authenticated ? "Google connected" : "Not connected";

  return (
    <div className="border-b bg-muted/30">
      <div className="flex items-center gap-2 px-3 py-1.5 text-xs">
        <SquareTerminal className="size-3.5 text-muted-foreground" />
        <span className="font-medium">Notebook</span>
        <div className="flex items-center rounded-md border bg-background p-0.5">
          {(["local", "colab"] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={backend === value}
              onClick={() => chooseBackend(value)}
              className="rounded px-1.5 py-0.5 text-[11px] capitalize text-muted-foreground hover:text-foreground aria-pressed:bg-muted aria-pressed:text-foreground"
            >
              {value === "local" ? "Local" : "Colab"}
            </button>
          ))}
        </div>
        <span className="text-muted-foreground">{statusText}</span>
        <div className="ml-auto flex items-center gap-1.5">
          {backend === "colab" && colab?.installed && !colab.authenticated ? (
            <Button size="sm" variant="outline" className="h-7" onClick={() => void connect()} disabled={busy === "connect"}>
              {busy === "connect" ? <Loader2 className="size-3.5 animate-spin" /> : <LogIn className="size-3.5" />}Connect Google
            </Button>
          ) : null}
          <button type="button" onClick={() => setOpen((current) => !current)} className="rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted">
            {open ? "Hide" : "Runtime"}
          </button>
        </div>
      </div>

      {open ? (
        <div className="flex flex-col gap-2 border-t px-3 py-2 text-xs">
          {backend === "local" ? (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" className="h-8" onClick={() => void runAll()} disabled={busy === "run-all" || !jupyter?.installed}>
                {busy === "run-all" ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCw className="size-3.5" />}Run all cells
              </Button>
              <span className="text-muted-foreground">{jupyter?.installed ? "Runs every cell with your local Python kernel and writes outputs into the notebook." : <>Install Jupyter: <code className="rounded bg-muted px-1">pip install jupyter nbconvert ipykernel</code></>}</span>
            </div>
          ) : (
            <>
              {colab && !colab.installed ? (
                <p className="text-muted-foreground">Install the CLI on the server: <code className="rounded bg-muted px-1">uv tool install google-colab-cli</code></p>
              ) : null}

              {login ? (
                <div className="rounded-lg border bg-card p-3">
                  <p className="font-medium">Authorize Ousia with your Google account</p>
                  <ol className="mt-1 list-decimal pl-4 text-muted-foreground">
                    <li>Open <a href={login.url} target="_blank" rel="noreferrer" className="text-primary hover:underline">this Google sign-in link <ExternalLink className="inline size-3" /></a> and approve access.</li>
                    <li>Copy the authorization code Google shows and paste it below.</li>
                  </ol>
                  <div className="mt-2 flex gap-2">
                    <Input value={code} onChange={(event) => setCode(event.target.value)} placeholder="Authorization code" className="h-8" />
                    <Button size="sm" className="h-8" onClick={() => void submitCode()} disabled={busy === "code" || !code.trim()}>
                      {busy === "code" ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}Finish
                    </Button>
                    <Button size="sm" variant="ghost" className="h-8" onClick={() => { void cancelColab(login.id); setLogin(undefined); setCode(""); }}>Cancel</Button>
                  </div>
                </div>
              ) : null}

              {colab?.authenticated ? (
                <div className="flex flex-wrap items-center gap-2">
                  <select value={accelerator} onChange={(event) => setAccelerator(event.target.value)} disabled={sessionRunning || busy !== undefined} className="h-8 rounded-md border bg-background px-2 text-xs">
                    {ACCELERATORS.map((value) => <option key={value} value={value}>{value === "CPU" ? "CPU" : `${value} GPU`}</option>)}
                  </select>
                  <label className="flex items-center gap-1.5 text-muted-foreground">
                    <input type="checkbox" checked={highMem} onChange={(event) => setHighMem(event.target.checked)} disabled={sessionRunning || busy !== undefined} className="size-3.5" />
                    High-RAM
                  </label>
                  {sessionRunning ? (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => void stop()} disabled={busy === "stop"}>
                      {busy === "stop" ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3.5" />}Stop
                    </Button>
                  ) : (
                    <Button size="sm" variant="outline" className="h-8" onClick={() => void start()} disabled={busy === "start"}>
                      {busy === "start" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}Start session
                    </Button>
                  )}
                  <Button size="sm" className="h-8" onClick={() => void runAll()} disabled={busy === "run-all"}>
                    {busy === "run-all" ? <Loader2 className="size-3.5 animate-spin" /> : <Play className="size-3.5" />}Run all cells
                  </Button>
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => void openInColab()} disabled={busy === "url"}>
                    <ExternalLink className="size-3.5" />Open in Colab
                  </Button>
                </div>
              ) : null}
            </>
          )}

          {error ? <p className="flex items-start gap-1.5 text-destructive"><AlertCircle className="mt-0.5 size-3.5 shrink-0" />{error}</p> : null}
          {output ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-md bg-neutral-900 p-2 font-mono text-[11px] text-neutral-100">{output}</pre> : null}
          {colabLink ? <a href={colabLink} target="_blank" rel="noreferrer" className="text-primary hover:underline">Open session in Colab</a> : null}
          {backend === "colab" && sessionRunning ? <p className="text-muted-foreground">Running on the shared session <code className="rounded bg-muted px-1">ousia</code>.</p> : null}
        </div>
      ) : null}
    </div>
  );
}
