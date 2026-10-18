"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Code2, Copy, Eraser, Loader2, Play, Plus, Text, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { isUntitledDraftPath } from "@/lib/untitled-draft";
import { runNotebookCellColab } from "../../colab-actions";
import { runNotebookCellLocal } from "../../jupyter-actions";
import { NotebookCellEditor, type CellRunMode } from "./notebook-cell-editor";
import { NotebookRuntimeBar, type NotebookBackend } from "./notebook-runtime-bar";
import { EditorShell } from "./editor-shell";
import { EditorError, EditorLoading } from "./editor-states";
import type { WorkspaceEditorProps } from "./types";
import { useTextFile } from "./use-text-file";

type NotebookCell = { id?: string; cell_type: "markdown" | "code" | "raw"; source: string | string[]; outputs?: Array<Record<string, unknown>>; execution_count?: number | null; metadata?: Record<string, unknown> };
type Notebook = { cells: NotebookCell[]; metadata: Record<string, unknown>; nbformat: number; nbformat_minor: number };

const RUN_TIMEOUT_SECONDS = 600;

const NOTEBOOK_STARTER = JSON.stringify({
  cells: [{ cell_type: "code", execution_count: null, metadata: {}, outputs: [], source: ["print('Hello from Ousia')"] }],
  metadata: { kernelspec: { display_name: "Python 3", language: "python", name: "python3" }, language_info: { name: "python" } },
  nbformat: 4,
  nbformat_minor: 5,
}, null, 2);

function notebookLanguageName(notebook: Notebook | undefined) {
  const kernel = notebook?.metadata?.kernelspec as { language?: string } | undefined;
  const languageInfo = notebook?.metadata?.language_info as { name?: string } | undefined;
  return languageInfo?.name ?? kernel?.language ?? "python";
}

export function NotebookEditor({ projectId, file, sourceUrl, onSaved }: WorkspaceEditorProps) {
  const text = useTextFile(projectId, file.path, onSaved);
  const [selectedCell, setSelectedCell] = useState(0);
  const [focusCell, setFocusCell] = useState<number>();
  const [editingCell, setEditingCell] = useState<number>();
  const [backend, setBackend] = useState<NotebookBackend>("local");
  const [runningCell, setRunningCell] = useState<number>();
  const seededRef = useRef(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastKeyRef = useRef("");
  const { draft, setDraft } = text;

  useEffect(() => {
    if (seededRef.current || !isUntitledDraftPath(file.path) || draft !== "") return;
    seededRef.current = true;
    setDraft(NOTEBOOK_STARTER);
  }, [draft, file.path, setDraft]);

  const parsed = useMemo(() => {
    try {
      const value = JSON.parse(draft) as Notebook;
      return Array.isArray(value.cells) ? { value } : { error: "Notebook has no cells array." };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Invalid notebook JSON" };
    }
  }, [draft]);

  const update = (updater: (notebook: Notebook) => Notebook) => {
    if (parsed.value) setDraft(JSON.stringify(updater(structuredClone(parsed.value)), null, 2));
  };
  const insertCellAt = (index: number, cell_type: "markdown" | "code" = "code") => {
    update((notebook) => ({ ...notebook, cells: [...notebook.cells.slice(0, index), { cell_type, metadata: {}, source: [], ...(cell_type === "code" ? { outputs: [], execution_count: null } : {}) }, ...notebook.cells.slice(index)] }));
    setSelectedCell(index);
    setFocusCell(index);
  };
  const deleteCellAt = (index: number) => {
    const total = parsed.value?.cells.length ?? 1;
    update((notebook) => ({ ...notebook, cells: notebook.cells.filter((_, itemIndex) => itemIndex !== index) }));
    setSelectedCell(Math.max(0, Math.min(index, total - 2)));
  };
  const setCellType = (index: number, cell_type: "markdown" | "code") => {
    update((notebook) => ({ ...notebook, cells: notebook.cells.map((cell, itemIndex) => itemIndex === index ? { ...cell, cell_type, ...(cell_type === "code" ? { outputs: cell.outputs ?? [], execution_count: cell.execution_count ?? null } : {}) } : cell) }));
  };

  const runCell = async (index: number, mode: CellRunMode = "inplace") => {
    const cell = parsed.value?.cells[index];
    if (!parsed.value || !cell || cell.cell_type !== "code") return;
    setRunningCell(index);
    try {
      const notebookJson = JSON.stringify(parsed.value);
      const result = backend === "local"
        ? await runNotebookCellLocal(projectId, index, notebookJson, RUN_TIMEOUT_SECONDS)
        : await runNotebookCellColab(projectId, index, notebookJson, RUN_TIMEOUT_SECONDS);
      if (!result.success) { toast.error(result.error ?? "Cell execution failed."); return; }
      const shouldInsert = mode === "insert" || (mode === "advance" && index + 1 >= parsed.value.cells.length);
      update((notebook) => {
        const cells = notebook.cells.map((item, itemIndex) => itemIndex === index
          ? { ...item, outputs: result.outputs ?? [], execution_count: result.executionCount ?? item.execution_count }
          : item);
        if (!shouldInsert) return { ...notebook, cells };
        return { ...notebook, cells: [...cells.slice(0, index + 1), { cell_type: "code", metadata: {}, source: [], outputs: [], execution_count: null }, ...cells.slice(index + 1)] };
      });
      if (mode === "inplace") setSelectedCell(index);
      else { setSelectedCell(index + 1); setFocusCell(index + 1); }
    } catch (cause) {
      toast.error(cause instanceof Error ? cause.message : "Cell execution failed.");
    } finally {
      setRunningCell(undefined);
    }
  };

  // Jupyter command-mode shortcuts, active when a cell is selected but not being edited.
  useEffect(() => {
    if (editingCell !== undefined) return;
    const handler = (event: KeyboardEvent) => {
      const container = containerRef.current;
      if (!container || !container.contains(document.activeElement)) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
      const index = selectedCell;
      if (parsed.error || index === undefined || !parsed.value) return;
      const key = event.key.toLowerCase();
      if (key === "a") { event.preventDefault(); lastKeyRef.current = ""; insertCellAt(index); }
      else if (key === "b") { event.preventDefault(); lastKeyRef.current = ""; insertCellAt(index + 1); }
      else if (key === "d") {
        if (lastKeyRef.current === "d") { event.preventDefault(); lastKeyRef.current = ""; deleteCellAt(index); }
        else lastKeyRef.current = "d";
      } else if (event.key === "Enter") { event.preventDefault(); lastKeyRef.current = ""; setFocusCell(index); }
      else if (key === "m") { event.preventDefault(); lastKeyRef.current = ""; setCellType(index, "markdown"); }
      else if (key === "y") { event.preventDefault(); lastKeyRef.current = ""; setCellType(index, "code"); }
      else lastKeyRef.current = "";
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [editingCell, selectedCell, draft, parsed]);

  const kernel = parsed.value?.metadata?.kernelspec as { display_name?: string; language?: string } | undefined;
  const cellCount = parsed.value?.cells.length ?? 0;
  const language = notebookLanguageName(parsed.value);

  return <EditorShell path={file.path} sourceUrl={sourceUrl} dirty={text.dirty} status={<span className="text-xs text-muted-foreground">{kernel?.display_name || kernel?.language || "Notebook"} · {cellCount} Cells</span>} actions={<><Button size="sm" variant="ghost" onClick={() => insertCellAt(cellCount, "markdown")}><Plus />Markdown</Button><Button size="sm" variant="ghost" onClick={() => insertCellAt(cellCount, "code")}><Plus />Code</Button></>} discard={{ onDiscard: text.discard, disabled: text.saving }} save={{ onClick: () => text.save(), saving: text.saving, disabled: !!parsed.error }} review={text.review}>
    {text.loading ? <EditorLoading name={file.name} size={file.size} /> : text.error ? <EditorError message={text.error} /> : parsed.error ? <EditorError message={parsed.error} /> : <div className="flex h-full min-h-0 flex-col"><NotebookRuntimeBar projectId={projectId} backend={backend} onBackendChange={setBackend} notebookJson={draft} onNotebookUpdated={(content) => setDraft(content)} /><div ref={containerRef} tabIndex={0} className="min-h-0 flex-1 overflow-auto bg-muted/30 p-4 outline-none"><div className="mx-auto max-w-4xl space-y-4 pb-8">{parsed.value?.cells.map((cell, index) => <NotebookCellView key={cell.id || index} cell={cell} index={index} count={cellCount} selected={selectedCell === index} running={runningCell === index} language={language} autoFocus={focusCell === index} onSelect={() => setSelectedCell(index)} onCommandFocus={() => containerRef.current?.focus()} onChange={(next) => update((notebook) => ({ ...notebook, cells: notebook.cells.map((item, itemIndex) => itemIndex === index ? next : item) }))} onMove={(direction) => update((notebook) => { const target = index + direction; if (target < 0 || target >= notebook.cells.length) return notebook; [notebook.cells[index], notebook.cells[target]] = [notebook.cells[target], notebook.cells[index]]; setSelectedCell(target); return notebook; })} onDuplicate={() => update((notebook) => ({ ...notebook, cells: [...notebook.cells.slice(0, index + 1), { ...structuredClone(cell), id: undefined, execution_count: null }, ...notebook.cells.slice(index + 1)] }))} onClearOutputs={() => onClearNotebookOutputs(index, update)} onDelete={() => deleteCellAt(index)} onRun={(mode) => runCell(index, mode)} onEscape={() => containerRef.current?.focus()} onFocusChange={(focused) => { if (focused) setEditingCell(index); else setEditingCell((current) => current === index ? undefined : current); }} />)}{cellCount === 0 ? <p className="py-10 text-center text-xs text-muted-foreground">No cells yet. Press <kbd className="rounded border px-1">B</kbd> or add a code/markdown cell.</p> : null}</div></div></div>}
  </EditorShell>;
}

function NotebookCellView({ cell, index, count, selected, running, language, autoFocus, onSelect, onCommandFocus, onChange, onMove, onDuplicate, onClearOutputs, onDelete, onRun, onEscape, onFocusChange }: { cell: NotebookCell; index: number; count: number; selected: boolean; running: boolean; language: string; autoFocus: boolean; onSelect: () => void; onCommandFocus: () => void; onChange: (cell: NotebookCell) => void; onMove: (direction: -1 | 1) => void; onDuplicate: () => void; onClearOutputs: () => void; onDelete: () => void; onRun: (mode: CellRunMode) => void; onEscape: () => void; onFocusChange: (focused: boolean) => void }) {
  const source = Array.isArray(cell.source) ? cell.source.join("") : cell.source;
  const isCode = cell.cell_type === "code";
  return <section onFocus={onSelect} onClick={onSelect} data-selected={selected} className={`overflow-hidden rounded-lg border bg-card transition-shadow ${selected ? "border-primary/60 shadow-[0_0_0_1px_color-mix(in_oklab,var(--primary)_30%,transparent)]" : ""}`}>
    <header onMouseDown={(event) => { event.preventDefault(); onSelect(); onCommandFocus(); }} className="flex h-8 cursor-default items-center gap-2 border-b bg-muted/40 px-2"><span className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{isCode ? <Code2 className="size-3" /> : <Text className="size-3" />}{cell.cell_type}</span>{isCode ? <span className="text-[10px] text-muted-foreground">In [{cell.execution_count ?? " "}]</span> : null}<div className="ml-auto flex">{isCode ? <Button size="icon-xs" variant="ghost" title="Run cell (Shift+Enter)" aria-label="Run cell" onClick={() => onRun("inplace")} disabled={running}>{running ? <Loader2 className="animate-spin" /> : <Play />}</Button> : null}<Button size="icon-xs" variant="ghost" title="Move up" disabled={index === 0} onClick={() => onMove(-1)}><ArrowUp /></Button><Button size="icon-xs" variant="ghost" title="Move down" disabled={index === count - 1} onClick={() => onMove(1)}><ArrowDown /></Button><Button size="icon-xs" variant="ghost" title="Duplicate cell" onClick={onDuplicate}><Copy /></Button>{isCode && cell.outputs?.length ? <Button size="icon-xs" variant="ghost" title="Clear output" onClick={onClearOutputs}><Eraser /></Button> : null}<Button size="icon-xs" variant="ghost" title="Delete cell" onClick={onDelete}><Trash2 /></Button></div></header>
    <NotebookCellEditor value={source} language={isCode ? language : "markdown"} onChange={(next) => onChange({ ...cell, source: next.split(/(?<=\n)/) })} onRun={onRun} onEscape={onEscape} onFocusChange={onFocusChange} autoFocus={autoFocus} />
    {isCode && cell.outputs?.length ? <div className="border-t bg-muted/20 p-3 text-xs"><NotebookOutputs outputs={cell.outputs} /></div> : null}
  </section>;
}

function onClearNotebookOutputs(index: number, update: (updater: (notebook: Notebook) => Notebook) => void) {
  update((notebook) => ({ ...notebook, cells: notebook.cells.map((cell, itemIndex) => itemIndex === index ? { ...cell, outputs: [], execution_count: null } : cell) }));
}

function NotebookOutputs({ outputs }: { outputs: Array<Record<string, unknown>> }) {
  return <>{outputs.map((output, index) => {
    const data = output.data as Record<string, unknown> | undefined;
    const png = joined(data?.["image/png"]); const jpeg = joined(data?.["image/jpeg"]); const svg = joined(data?.["image/svg+xml"]); const html = joined(data?.["text/html"]); const text = joined(output.text ?? data?.["text/plain"]); const traceback = Array.isArray(output.traceback) ? output.traceback.join("\n") : undefined;
    return <div key={index} className="mb-3 overflow-auto rounded border bg-card p-3 last:mb-0">{png || jpeg ? <img alt="Notebook output" src={`data:image/${png ? "png" : "jpeg"};base64,${png || jpeg}`} className="max-w-full" /> : svg ? <img alt="Notebook SVG output" src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`} className="max-w-full" /> : html ? <iframe title={`Notebook HTML output ${index + 1}`} sandbox="" srcDoc={html} className="min-h-32 w-full border-0 bg-white" /> : traceback ? <pre className="whitespace-pre-wrap font-mono text-destructive">{traceback}</pre> : <pre className="whitespace-pre-wrap font-mono">{text || String(output.ename ?? "")}</pre>}</div>;
  })}</>;
}

function joined(value: unknown) { return Array.isArray(value) ? value.join("") : typeof value === "string" ? value : ""; }
