"use client";

import { useEffect, useMemo, useState } from "react";
import { BrainCircuit, Check, MessageSquare, Sparkles } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getAiModelCatalog } from "./ai-provider-actions";
import type { AiModelOption } from "@/lib/ai-model-catalog";
import type { AiModelSelection, AiProviderId } from "@/lib/ai-providers";

const PROVIDER_LABELS: Record<AiProviderId, string> = {
  chatgpt: "ChatGPT",
  opencode: "OpenCode Zen",
  "opencode-go": "OpenCode Go",
  openrouter: "OpenRouter",
};

const PROVIDER_ICONS: Record<AiProviderId, typeof BrainCircuit> = {
  chatgpt: MessageSquare,
  opencode: Sparkles,
  "opencode-go": Sparkles,
  openrouter: BrainCircuit,
};

const PROVIDER_ORDER: AiProviderId[] = ["chatgpt", "opencode", "opencode-go", "openrouter"];

export function ModelPicker({
  value,
  onChange,
  disabled,
}: {
  value?: AiModelSelection;
  onChange: (selection: AiModelSelection) => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [models, setModels] = useState<AiModelOption[]>();
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string>();

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setError(undefined);
    if (models === undefined) {
      void getAiModelCatalog()
        .then((result) => { if (!cancelled) setModels(result); })
        .catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load models."); });
    }
    return () => { cancelled = true; };
  }, [open, models]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const all = models ?? [];
    if (!needle) return all;
    return all.filter((model) => `${model.label} ${model.id} ${PROVIDER_LABELS[model.provider]}`.toLowerCase().includes(needle));
  }, [models, query]);

  const label = value ? value.id : "Select model";

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="h-8 max-w-[190px] gap-1.5 px-2 text-xs text-muted-foreground"
        title={value ? `${PROVIDER_LABELS[value.provider]} · ${value.id}` : "Choose a model"}
      >
        <BrainCircuit className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg gap-0 p-0">
          <DialogHeader className="border-b px-4 py-3">
            <DialogTitle className="text-base">Choose a model</DialogTitle>
          </DialogHeader>
          <div className="border-b px-4 py-2">
            <Input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search models" className="h-9" />
          </div>
          <div className="max-h-[22rem] overflow-y-auto p-2">
            {error ? <p className="px-2 py-6 text-center text-xs text-destructive">{error}</p> : null}
            {!error && models === undefined ? <p className="px-2 py-6 text-center text-xs text-muted-foreground">Loading models…</p> : null}
            {!error && models !== undefined && filtered.length === 0 ? (
              <p className="px-2 py-6 text-center text-xs text-muted-foreground">No models found. Connect a provider in Settings.</p>
            ) : null}
            {PROVIDER_ORDER.map((provider) => {
              const group = filtered.filter((model) => model.provider === provider);
              if (group.length === 0) return null;
              const Icon = PROVIDER_ICONS[provider];
              return (
                <div key={provider} className="mb-1">
                  <div className="flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    <Icon className="size-3" />
                    {PROVIDER_LABELS[provider]}
                  </div>
                  {group.map((model) => {
                    const selected = value?.provider === model.provider && value?.id === model.id;
                    return (
                      <button
                        key={`${model.provider}:${model.id}`}
                        type="button"
                        onClick={() => {
                          onChange({ provider: model.provider, id: model.id, contextWindow: model.contextWindow });
                          setOpen(false);
                        }}
                        className={cn(
                          "flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent",
                          selected && "bg-accent/60",
                        )}
                      >
                        <span className="min-w-0 flex-1 truncate">
                          <span className="block truncate">{model.label}</span>
                          {model.label !== model.id ? <span className="block truncate text-[11px] text-muted-foreground">{model.id}</span> : null}
                        </span>
                        {selected ? <Check className="size-4 shrink-0 text-primary" /> : null}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
