"use client";

import { TableKit } from "@tiptap/extension-table";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";
import type { DocNode } from "@/lib/contract/document";
import { cx } from "../ui";
import { NumberedHeading, Variable } from "./extensions";

export interface ClauseOption {
  id: string;
  name: string;
  category: string;
  body: DocNode;
}

function Tool({ active, onClick, children, title, disabled }: { active?: boolean; onClick: () => void; children: React.ReactNode; title: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cx(
        "min-h-9 rounded-md px-2 text-sm font-semibold disabled:opacity-40",
        active ? "bg-brand-600 text-white" : "text-slate-700 hover:bg-slate-100",
      )}
    >
      {children}
    </button>
  );
}

export function RichEditor({
  value,
  onChange,
  variableKeys,
  clauses,
  readOnly,
}: {
  value: DocNode;
  onChange: (doc: DocNode) => void;
  variableKeys: string[];
  clauses: ClauseOption[];
  readOnly?: boolean;
}) {
  const changeRef = useRef(onChange);
  useEffect(() => {
    changeRef.current = onChange;
  }, [onChange]);
  const editor = useEditor({
    immediatelyRender: false,
    editable: !readOnly,
    extensions: [
      StarterKit.configure({ heading: false, code: false, codeBlock: false, link: false }),
      NumberedHeading,
      TableKit.configure({ table: { resizable: false } }),
      Variable,
    ],
    content: value as object,
    editorProps: { attributes: { class: "tiptap contract-body px-4 py-3", "aria-label": "契約書の本文" } },
    onUpdate: ({ editor }) => changeRef.current(editor.getJSON() as DocNode),
  });

  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  const state = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e
        ? {
            bold: e.isActive("bold"),
            underline: e.isActive("underline"),
            h1: e.isActive("heading", { level: 1 }),
            h2: e.isActive("heading", { level: 2, numbered: false }),
            article: e.isActive("heading", { numbered: true }),
            h3: e.isActive("heading", { level: 3 }),
            bullet: e.isActive("bulletList"),
            ordered: e.isActive("orderedList"),
            table: e.isActive("table"),
          }
        : null,
  });

  if (!editor) return <div className="min-h-[420px] rounded-lg bg-white ring-1 ring-slate-200" />;

  const c = () => editor.chain().focus();
  return (
    <div className="rounded-lg bg-white ring-1 ring-slate-300">
      {!readOnly && (
        <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-white/95 p-1.5 backdrop-blur">
          <Tool title="表題" active={state?.h1} onClick={() => c().toggleHeading({ level: 1 }).run()}>表題</Tool>
          <Tool
            title="条（第N条を自動で振る見出し）"
            active={state?.article}
            onClick={() => {
              if (state?.article) c().setParagraph().run();
              else c().setHeading({ level: 2 }).updateAttributes("heading", { numbered: true }).run();
            }}
          >
            第N条
          </Tool>
          <Tool title="見出し" active={state?.h2} onClick={() => c().setHeading({ level: 2 }).updateAttributes("heading", { numbered: false }).run()}>見出し</Tool>
          <Tool title="小見出し" active={state?.h3} onClick={() => c().toggleHeading({ level: 3 }).run()}>小見出し</Tool>
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <Tool title="太字" active={state?.bold} onClick={() => c().toggleBold().run()}>B</Tool>
          <Tool title="下線" active={state?.underline} onClick={() => c().toggleUnderline().run()}><u>U</u></Tool>
          <Tool title="箇条書き" active={state?.bullet} onClick={() => c().toggleBulletList().run()}>・箇条</Tool>
          <Tool title="番号付きリスト" active={state?.ordered} onClick={() => c().toggleOrderedList().run()}>1. 番号</Tool>
          <Tool title="表を挿入" onClick={() => c().insertTable({ rows: 3, cols: 2, withHeaderRow: true }).run()}>表</Tool>
          {state?.table && (
            <>
              <Tool title="行を追加" onClick={() => c().addRowAfter().run()}>＋行</Tool>
              <Tool title="列を追加" onClick={() => c().addColumnAfter().run()}>＋列</Tool>
              <Tool title="行を削除" onClick={() => c().deleteRow().run()}>−行</Tool>
              <Tool title="列を削除" onClick={() => c().deleteColumn().run()}>−列</Tool>
              <Tool title="表を削除" onClick={() => c().deleteTable().run()}>表を削除</Tool>
            </>
          )}
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <select
            aria-label="変数を挿入"
            className="min-h-9 rounded-md bg-sky-50 px-2 text-sm font-semibold text-sky-800 ring-1 ring-sky-200"
            value=""
            onChange={(e) => {
              if (e.target.value) c().insertContent({ type: "variable", attrs: { key: e.target.value } }).run();
            }}
          >
            <option value="">{"{{ }} 変数を挿入"}</option>
            {variableKeys.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          {clauses.length > 0 && (
            <select
              aria-label="条項を挿入"
              className="min-h-9 rounded-md bg-slate-50 px-2 text-sm font-semibold ring-1 ring-slate-200"
              value=""
              onChange={(e) => {
                const cl = clauses.find((x) => x.id === e.target.value);
                if (cl) c().insertContent((cl.body.content ?? []) as object[]).run();
              }}
            >
              <option value="">条項ライブラリから挿入</option>
              {clauses.map((cl) => (
                <option key={cl.id} value={cl.id}>
                  {cl.category ? `［${cl.category}］` : ""}
                  {cl.name}
                </option>
              ))}
            </select>
          )}
          <Tool title="元に戻す" disabled={!editor.can().undo()} onClick={() => c().undo().run()}>↶</Tool>
          <Tool title="やり直す" disabled={!editor.can().redo()} onClick={() => c().redo().run()}>↷</Tool>
        </div>
      )}
      <EditorContent editor={editor} />
    </div>
  );
}
