"use client";

import { useEffect, useRef } from "react";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, defaultHighlightStyle, indentOnInput, StreamLanguage, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { javascript } from "@codemirror/legacy-modes/mode/javascript";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { python } from "@codemirror/legacy-modes/mode/python";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { swift } from "@codemirror/legacy-modes/mode/swift";
import { searchKeymap } from "@codemirror/search";
import { EditorState, Prec } from "@codemirror/state";
import { drawSelection, dropCursor, EditorView, highlightActiveLine, highlightSpecialChars, keymap } from "@codemirror/view";

export type CellRunMode = "inplace" | "advance" | "insert";

const modes: Record<string, StreamParser<unknown>> = {
  bash: shell,
  javascript,
  js: javascript,
  julia,
  python,
  python3: python,
  ruby,
  shell,
  sql: standardSQL,
  swift,
  ts: javascript,
  typescript: javascript,
};

export function NotebookCellEditor({
  value,
  language,
  onChange,
  onRun,
  onEscape,
  onFocusChange,
  autoFocus,
}: {
  value: string;
  language: string;
  onChange: (value: string) => void;
  onRun: (mode: CellRunMode) => void;
  onEscape?: () => void;
  onFocusChange?: (focused: boolean) => void;
  autoFocus?: boolean;
}) {
  const parentRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const callbacks = useRef({ onChange, onRun, onEscape, onFocusChange });
  callbacks.current = { onChange, onRun, onEscape, onFocusChange };

  useEffect(() => {
    if (!parentRef.current) return;
    const mode = modes[language.toLowerCase()];
    const view = new EditorView({
      parent: parentRef.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          drawSelection(),
          dropCursor(),
          highlightSpecialChars(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightActiveLine(),
          syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
          ...(mode ? [StreamLanguage.define(mode)] : []),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
          Prec.high(keymap.of([
            { key: "Shift-Enter", run: () => { callbacks.current.onRun("advance"); return true; } },
            { key: "Mod-Enter", run: () => { callbacks.current.onRun("inplace"); return true; } },
            { key: "Alt-Enter", run: () => { callbacks.current.onRun("insert"); return true; } },
            { key: "Escape", run: () => { callbacks.current.onEscape?.(); return true; } },
          ])),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({ "aria-label": "Notebook cell source" }),
          EditorView.theme({
            "&": { height: "auto", minHeight: "3.25rem", fontSize: "13px", backgroundColor: "var(--card)", color: "var(--foreground)" },
            "&.cm-focused": { outline: "none" },
            ".cm-scroller": { fontFamily: "var(--font-mono), ui-monospace, monospace", lineHeight: "1.6", overflow: "visible" },
            ".cm-content": { padding: "12px 14px" },
            ".cm-activeLine": { backgroundColor: "color-mix(in oklab, var(--primary) 6%, transparent)" },
            ".cm-cursor": { borderLeftColor: "var(--foreground)" },
            ".cm-selectionBackground": { backgroundColor: "color-mix(in oklab, var(--primary) 22%, transparent) !important" },
            "&.cm-focused .cm-selectionBackground": { backgroundColor: "color-mix(in oklab, var(--primary) 26%, transparent) !important" },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) callbacks.current.onChange(update.state.doc.toString());
            if (update.focusChanged) callbacks.current.onFocusChange?.(update.view.hasFocus);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      viewRef.current = null;
      view.destroy();
    };
  // The editor is created once per language; value syncs below.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    if (autoFocus) viewRef.current?.focus();
  }, [autoFocus]);

  return <div ref={parentRef} className="min-h-14" />;
}
