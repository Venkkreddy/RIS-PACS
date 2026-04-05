import { useCallback, useEffect, useRef, useState } from "react";
import { useEditor, EditorContent, Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableCell from "@tiptap/extension-table-cell";
import TableHeader from "@tiptap/extension-table-header";
import TaskList from "@tiptap/extension-task-list";
import TaskItem from "@tiptap/extension-task-item";
import CharacterCount from "@tiptap/extension-character-count";

interface TipTapEditorProps {
  content: string;
  onChange: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  autoFocus?: boolean;
  sectionTitle?: string;
  macros?: MacroItem[];
}

export interface MacroItem {
  label: string;
  text: string;
  category?: string;
}

const RADIOLOGY_MACROS: MacroItem[] = [
  { label: "Normal Lungs", text: "The lungs are clear bilaterally. No focal consolidation, pleural effusion, or pneumothorax.", category: "Chest" },
  { label: "Normal Heart", text: "The cardiac silhouette is normal in size. The mediastinal contours are unremarkable.", category: "Chest" },
  { label: "Normal Vasculature", text: "The pulmonary vasculature is normal.", category: "Chest" },
  { label: "No Fracture", text: "No acute fracture or dislocation. Osseous alignment is maintained.", category: "MSK" },
  { label: "Normal Liver", text: "Normal in size and attenuation. No focal hepatic lesion.", category: "Abdomen" },
  { label: "Normal Kidneys", text: "The kidneys enhance symmetrically without hydronephrosis or suspicious mass.", category: "Abdomen" },
  { label: "No Acute Intracranial", text: "No acute intracranial hemorrhage, mass, or midline shift. Gray-white matter differentiation is preserved.", category: "Neuro" },
  { label: "Normal Ventricles", text: "The ventricles and sulci are normal in size and configuration for age.", category: "Neuro" },
  { label: "Recommend Follow-up", text: "Recommend follow-up imaging in ___ weeks/months to assess for interval change.", category: "General" },
  { label: "Clinical Correlation", text: "Clinical correlation is recommended.", category: "General" },
  { label: "No Comparison", text: "No prior studies available for comparison.", category: "General" },
  { label: "Bilateral", text: "[right/left]", category: "Placeholder" },
  { label: "Size placeholder", text: "___ × ___ × ___ cm", category: "Placeholder" },
  { label: "Measurement", text: "measuring ___ mm", category: "Placeholder" },
];

export function TipTapEditor({
  content,
  onChange,
  placeholder = "Start typing...",
  editable = true,
  autoFocus = false,
  sectionTitle,
  macros = RADIOLOGY_MACROS,
}: TipTapEditorProps) {
  const [showMacros, setShowMacros] = useState(false);
  const [macroSearch, setMacroSearch] = useState("");
  const macroRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3, 4] },
      }),
      Placeholder.configure({ placeholder }),
      Highlight.configure({ multicolor: true }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      TaskList,
      TaskItem.configure({ nested: true }),
      CharacterCount,
    ],
    content,
    editable,
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor: e }) => {
      onChangeRef.current(e.getHTML());
    },
    editorProps: {
      attributes: {
        class: "tiptap-editor prose prose-sm max-w-none focus:outline-none min-h-[120px] px-4 py-3",
      },
    },
  });

  useEffect(() => {
    if (editor && editor.getHTML() !== content) {
      editor.commands.setContent(content, { emitUpdate: false });
    }
  }, [content, editor]);

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editable, editor]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (macroRef.current && !macroRef.current.contains(e.target as Node)) {
        setShowMacros(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const insertMacro = useCallback(
    (text: string) => {
      if (!editor) return;
      editor.chain().focus().insertContent(text).run();
      setShowMacros(false);
      setMacroSearch("");
    },
    [editor],
  );

  const filteredMacros = macros.filter(
    (m) =>
      !macroSearch ||
      m.label.toLowerCase().includes(macroSearch.toLowerCase()) ||
      m.category?.toLowerCase().includes(macroSearch.toLowerCase()),
  );

  const macroCategories = [...new Set(filteredMacros.map((m) => m.category ?? "Other"))];

  if (!editor) return null;

  return (
    <div className="tiptap-wrapper rounded-xl border border-tdai-gray-200 bg-white shadow-tdai-sm">
      {editable && <Toolbar editor={editor} onMacroToggle={() => setShowMacros(!showMacros)} />}

      {sectionTitle && (
        <div className="border-b border-tdai-gray-100 bg-tdai-gray-50/50 px-4 py-1.5">
          <span className="section-label">
            {sectionTitle}
          </span>
        </div>
      )}

      <EditorContent editor={editor} />

      {editable && (
        <div className="flex items-center justify-between border-t border-tdai-gray-100 px-4 py-1.5">
          <span className="text-[10px] text-tdai-gray-400">
            {editor.storage.characterCount.characters()} characters
            {" · "}
            {editor.storage.characterCount.words()} words
          </span>
          <span className="text-[10px] text-tdai-gray-400">
            Type <kbd className="rounded bg-tdai-gray-100 px-1 font-mono text-[10px] text-tdai-navy-600">/</kbd> for quick insert
          </span>
        </div>
      )}

      {showMacros && (
        <div
          ref={macroRef}
          className="absolute z-50 mt-1 max-h-80 w-96 overflow-y-auto rounded-xl border border-tdai-gray-200 bg-white shadow-modal animate-scale-in"
          style={{ top: "100%", right: 0 }}
        >
          <div className="sticky top-0 border-b border-tdai-gray-100 bg-white p-2.5">
            <input
              type="text"
              className="input-field py-1.5 text-sm"
              placeholder="Search macros..."
              value={macroSearch}
              onChange={(e) => setMacroSearch(e.target.value)}
              autoFocus
            />
          </div>
          {macroCategories.map((cat) => (
            <div key={cat}>
              <div className="sticky top-11 bg-tdai-gray-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.15em] text-tdai-gray-400">
                {cat}
              </div>
              {filteredMacros
                .filter((m) => (m.category ?? "Other") === cat)
                .map((m, i) => (
                  <button
                    key={`${cat}-${i}`}
                    className="block w-full px-3 py-2.5 text-left text-sm transition-colors hover:bg-tdai-teal-50/50"
                    onClick={() => insertMacro(m.text)}
                  >
                    <span className="font-medium text-tdai-navy-800">{m.label}</span>
                    <span className="ml-2 text-xs text-tdai-gray-400">{m.text.slice(0, 60)}...</span>
                  </button>
                ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Toolbar({ editor, onMacroToggle }: { editor: Editor; onMacroToggle: () => void }) {
  const btn = (active: boolean, onClick: () => void, children: React.ReactNode, title: string) => (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      className={`rounded-md p-1.5 transition-all duration-150 ${
        active ? "bg-tdai-teal-100 text-tdai-teal-700 shadow-sm" : "text-tdai-gray-500 hover:bg-tdai-gray-100 hover:text-tdai-navy-700"
      }`}
    >
      {children}
    </button>
  );

  const sep = () => <div className="mx-1 h-5 w-px bg-tdai-gray-200" />;

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-tdai-gray-200 bg-tdai-gray-50/80 px-2.5 py-2 rounded-t-xl">
      {btn(editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path d="M6 4h8a4 4 0 014 4 4 4 0 01-4 4H6z"/><path d="M6 12h9a4 4 0 014 4 4 4 0 01-4 4H6z"/></svg>, "Bold (Ctrl+B)"
      )}
      {btn(editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><line x1="19" y1="4" x2="10" y2="4"/><line x1="14" y1="20" x2="5" y2="20"/><line x1="15" y1="4" x2="9" y2="20"/></svg>, "Italic (Ctrl+I)"
      )}
      {btn(editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M6 3v7a6 6 0 006 6 6 6 0 006-6V3"/><line x1="4" y1="21" x2="20" y2="21"/></svg>, "Underline (Ctrl+U)"
      )}
      {btn(editor.isActive("highlight"), () => editor.chain().focus().toggleHighlight().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5"/></svg>, "Highlight"
      )}

      {sep()}

      {btn(editor.isActive("heading", { level: 3 }), () => editor.chain().focus().toggleHeading({ level: 3 }).run(),
        <span className="text-xs font-bold">H3</span>, "Heading 3"
      )}
      {btn(editor.isActive("heading", { level: 4 }), () => editor.chain().focus().toggleHeading({ level: 4 }).run(),
        <span className="text-xs font-bold">H4</span>, "Heading 4"
      )}

      {sep()}

      {btn(editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><circle cx="3" cy="6" r="1" fill="currentColor"/><circle cx="3" cy="12" r="1" fill="currentColor"/><circle cx="3" cy="18" r="1" fill="currentColor"/></svg>, "Bullet List"
      )}
      {btn(editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="21" y2="18"/><text x="2" y="8" fill="currentColor" fontSize="8" fontWeight="bold">1</text><text x="2" y="14" fill="currentColor" fontSize="8" fontWeight="bold">2</text><text x="2" y="20" fill="currentColor" fontSize="8" fontWeight="bold">3</text></svg>, "Numbered List"
      )}
      {btn(editor.isActive("taskList"), () => editor.chain().focus().toggleTaskList().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="5" width="6" height="6" rx="1"/><path d="M5 8l1.5 1.5L9 7"/><line x1="13" y1="8" x2="21" y2="8"/><rect x="3" y="13" width="6" height="6" rx="1"/><line x1="13" y1="16" x2="21" y2="16"/></svg>, "Checklist"
      )}

      {sep()}

      {btn(false, () => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="9" y1="3" x2="9" y2="21"/><line x1="15" y1="3" x2="15" y2="21"/></svg>, "Insert Table"
      )}

      {btn(editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M3 21c3 0 7-1 7-8V5c0-1.25-.756-2.017-2-2H4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2 1 0 1 0 1 1v1c0 1-1 2-2 2s-1 .008-1 1.031V21z"/><path d="M15 21c3 0 7-1 7-8V5c0-1.25-.757-2.017-2-2h-4c-1.25 0-2 .75-2 1.972V11c0 1.25.75 2 2 2h.75c0 2.25.25 4-2.75 4v3z"/></svg>, "Blockquote"
      )}

      <div className="flex-1" />

      {btn(false, () => editor.chain().focus().undo().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M3 10h10a5 5 0 015 5v2"/><polyline points="3,10 7,6"/><polyline points="3,10 7,14"/></svg>, "Undo"
      )}
      {btn(false, () => editor.chain().focus().redo().run(),
        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M21 10H11a5 5 0 00-5 5v2"/><polyline points="21,10 17,6"/><polyline points="21,10 17,14"/></svg>, "Redo"
      )}

      {sep()}

      <button
        type="button"
        title="Insert Macro / Quick Text"
        onClick={onMacroToggle}
        className="flex items-center gap-1.5 rounded-lg bg-tdai-teal-50 px-2.5 py-1 text-[11px] font-semibold text-tdai-teal-700 transition-colors hover:bg-tdai-teal-100"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>
        Macros
      </button>
    </div>
  );
}
