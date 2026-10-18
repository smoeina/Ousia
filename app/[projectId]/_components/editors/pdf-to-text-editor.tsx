"use client";

import { ExternalLink } from "lucide-react";

import { Button } from "@/components/ui/button";
import { OPEN_WORKSPACE_FILE_EVENT } from "@/lib/chat-context";
import { EditorShell } from "./editor-shell";
import { EditorError, EditorLoading } from "./editor-states";
import { SourceCodeEditor } from "./source-code-editor";
import type { WorkspaceEditorProps } from "./types";
import { useTextFile } from "./use-text-file";

/** Split view for a `<name>.pdf.txt` file: the source PDF beside its text. */
export function PdfToTextEditor({ projectId, file, sourceUrl, onSaved }: WorkspaceEditorProps) {
  const text = useTextFile(projectId, file.path, onSaved);
  const pdfPath = file.path.replace(/\.txt$/i, "");
  const pdfName = pdfPath.split("/").at(-1) || pdfPath;
  const pdfUrl = `/api/workspace/${projectId}/${pdfPath.split("/").map(encodeURIComponent).join("/")}`;
  const lines = text.draft.split(/\r?\n/).length;

  return <EditorShell
    path={file.path}
    sourceUrl={sourceUrl}
    dirty={text.dirty}
    status={<span className="text-xs text-muted-foreground">{pdfName} · {lines.toLocaleString()} lines</span>}
    actions={<Button size="sm" variant="ghost" onClick={() => window.dispatchEvent(new CustomEvent(OPEN_WORKSPACE_FILE_EVENT, { detail: { name: pdfName, path: pdfPath } }))}><ExternalLink />Open PDF</Button>}
    discard={{ onDiscard: text.discard, disabled: text.saving }}
    save={{ onClick: () => text.save(), saving: text.saving }}
    review={text.review}
  >
    {text.loading ? <EditorLoading name={file.name} size={file.size} /> : text.error ? <EditorError message={text.error} /> : <div className="grid h-full min-h-0 grid-cols-2 divide-x">
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-8 shrink-0 items-center justify-between gap-2 border-b bg-muted/50 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><span>PDF</span><span className="truncate normal-case tracking-normal">{pdfName}</span></div>
        <object data={`${pdfUrl}#toolbar=1&navpanes=0&view=FitH`} type="application/pdf" className="min-h-0 w-full flex-1" />
      </div>
      <div className="flex h-full min-h-0 flex-col">
        <div className="flex h-8 shrink-0 items-center justify-between border-b bg-muted/50 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"><span>Extracted text</span><span>{lines} lines</span></div>
        <div className="min-h-0 flex-1"><SourceCodeEditor value={text.draft} extension="txt" onChange={text.setDraft} /></div>
      </div>
    </div>}
  </EditorShell>;
}
