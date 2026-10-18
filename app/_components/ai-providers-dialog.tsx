"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ExternalLink, Loader2, Plug } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  clearAiProviderKey,
  connectChatGpt,
  getAiProviderSettings,
  getChatGptConnectionStatus,
  saveAiProviderKey,
  setDefaultAiModel,
  type AiProviderSettings,
} from "./ai-provider-actions";
import { ModelPicker } from "./model-picker";
import type { AiModelSelection } from "@/lib/ai-providers";

type KeyProvider = "openrouter" | "opencode" | "opencode-go";

const KEY_PROVIDER_COPY: Record<KeyProvider, { placeholder: string; help: string }> = {
  openrouter: { placeholder: "sk-or-…", help: "Create a key at openrouter.ai/keys." },
  opencode: { placeholder: "OpenCode Zen API key", help: "Create a key at opencode.ai/auth." },
  "opencode-go": { placeholder: "OpenCode Go API key", help: "Subscribe to Go or Go Plus and copy a key at opencode.ai/auth." },
};

export function AiProvidersDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [settings, setSettings] = useState<AiProviderSettings>();
  const [drafts, setDrafts] = useState<Record<KeyProvider, string>>({ openrouter: "", opencode: "", "opencode-go": "" });
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [login, setLogin] = useState<{ url: string; code: string }>();
  const [defaultModel, setDefaultModel] = useState<AiModelSelection>();
  const pollRef = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      const next = await getAiProviderSettings();
      setSettings(next);
      setDefaultModel(next.defaultModel);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load provider settings.");
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setError(undefined);
    setLogin(undefined);
    void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!login) return;
    const stop = () => { if (pollRef.current) window.clearInterval(pollRef.current); pollRef.current = undefined; };
    pollRef.current = window.setInterval(() => {
      void getChatGptConnectionStatus().then((status) => {
        if (status.connected) {
          stop();
          setLogin(undefined);
          toast.success("ChatGPT connected");
          void refresh();
        }
      }).catch(() => undefined);
    }, 3_000);
    return stop;
  }, [login, refresh]);

  const saveKey = async (provider: KeyProvider) => {
    setBusy(provider);
    setError(undefined);
    try {
      const result = await saveAiProviderKey(provider, drafts[provider]);
      if (!result.success) { setError(result.error); return; }
      setDrafts((current) => ({ ...current, [provider]: "" }));
      toast.success("API key saved");
      await refresh();
    } finally {
      setBusy(undefined);
    }
  };

  const clearKey = async (provider: KeyProvider) => {
    setBusy(provider);
    try {
      await clearAiProviderKey(provider);
      toast.success("API key removed");
      await refresh();
    } finally {
      setBusy(undefined);
    }
  };

  const connect = async () => {
    setBusy("chatgpt");
    setError(undefined);
    try {
      const result = await connectChatGpt();
      if (!result.success) { setError(result.error); return; }
      if (result.connected) { toast.success("ChatGPT already connected"); await refresh(); return; }
      setLogin({ url: result.url, code: result.code });
    } finally {
      setBusy(undefined);
    }
  };

  const saveDefault = async (selection: AiModelSelection | undefined) => {
    setDefaultModel(selection);
    await setDefaultAiModel(selection);
    toast.success(selection ? "Default model saved" : "Default model cleared");
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>AI Providers</DialogTitle>
          <DialogDescription>Connect the models Ousia can use to chat. Keys are stored locally on this computer.</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {settings?.providers.map((provider) => (
            <div key={provider.id} className="rounded-xl border p-4">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{provider.label}</span>
                  <span className={provider.configured ? "inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400" : "rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground"}>
                    {provider.configured ? "Connected" : "Not connected"}
                  </span>
                </div>
                {provider.id !== "chatgpt" && provider.configured ? (
                  <Button variant="ghost" size="sm" onClick={() => void clearKey(provider.id as KeyProvider)} disabled={busy === provider.id}>Remove</Button>
                ) : null}
              </div>

              {provider.id === "chatgpt" ? (
                <div className="mt-3 flex flex-col gap-2">
                  <p className="text-xs text-muted-foreground">{provider.connected ? provider.detail : "Sign in with your ChatGPT subscription through the Codex CLI."}</p>
                  {!provider.connected ? (
                    <Button size="sm" onClick={() => void connect()} disabled={busy === "chatgpt"} className="w-fit">
                      {busy === "chatgpt" ? <Loader2 className="size-4 animate-spin" /> : <Plug className="size-4" />}
                      Connect ChatGPT
                    </Button>
                  ) : null}
                  {login ? (
                    <div className="rounded-lg bg-muted/60 p-3 text-xs">
                      <p className="font-medium">Finish sign-in in your browser:</p>
                      <a href={login.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-primary hover:underline">
                        {login.url} <ExternalLink className="size-3" />
                      </a>
                      <p className="mt-2">One-time code <span className="ml-1 font-mono text-sm font-semibold tracking-wider">{login.code}</span></p>
                      <p className="mt-1 text-muted-foreground">Waiting for sign-in…</p>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 flex flex-col gap-2">
                  {provider.configured ? (
                    <p className="text-xs text-muted-foreground">Key saved: <span className="font-mono">{provider.maskedKey}</span></p>
                  ) : (
                    <>
                      <Input
                        type="password"
                        autoComplete="off"
                        value={drafts[provider.id as KeyProvider]}
                        onChange={(event) => setDrafts((current) => ({ ...current, [provider.id]: event.target.value }))}
                        placeholder={KEY_PROVIDER_COPY[provider.id as KeyProvider].placeholder}
                      />
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-[11px] text-muted-foreground">{KEY_PROVIDER_COPY[provider.id as KeyProvider].help}</p>
                        <Button size="sm" onClick={() => void saveKey(provider.id as KeyProvider)} disabled={busy === provider.id || !drafts[provider.id as KeyProvider].trim()}>
                          {busy === provider.id ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                          Save
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ))}

          <div className="rounded-xl border p-4">
            <div className="text-sm font-medium">Default chat model</div>
            <p className="mt-1 text-xs text-muted-foreground">Used for new conversations when a chat has no model selected.</p>
            <div className="mt-2 flex items-center gap-2">
              <ModelPicker value={defaultModel} onChange={(selection) => void saveDefault(selection)} />
              <span className="text-xs text-muted-foreground">{defaultModel ? defaultModel.id : "None"}</span>
            </div>
          </div>

          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
