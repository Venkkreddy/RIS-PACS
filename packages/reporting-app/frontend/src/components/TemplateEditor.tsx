import { FormEvent, useState } from "react";
import type { ReportSection } from "@medical-report-system/shared";
import { api } from "../api/client";
import { TipTapEditor } from "./TipTapEditor";

const DEFAULT_SECTIONS: ReportSection[] = [
  { key: "clinical_history", title: "Clinical History", content: "" },
  { key: "comparison", title: "Comparison", content: "" },
  { key: "technique", title: "Technique", content: "" },
  { key: "findings", title: "Findings", content: "" },
  { key: "impression", title: "Impression", content: "" },
  { key: "recommendation", title: "Recommendation", content: "" },
];

const CATEGORIES = ["General", "Chest", "Abdomen", "Neuro", "MSK", "OB-GYN", "Breast", "Cardiac", "Other"];
const MODALITIES = ["CR", "CT", "MR", "US", "DX", "MG", "NM", "PT", "OT"];

export function TemplateEditor() {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("General");
  const [modality, setModality] = useState("OT");
  const [bodyPart, setBodyPart] = useState("");
  const [sections, setSections] = useState<ReportSection[]>(DEFAULT_SECTIONS.map((s) => ({ ...s })));
  const [activeSection, setActiveSection] = useState("findings");
  const [message, setMessage] = useState<string | null>(null);

  function updateSection(key: string, content: string) {
    setSections((prev) => prev.map((s) => (s.key === key ? { ...s, content } : s)));
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = sections.filter((s) => s.content.replace(/<[^>]*>/g, "").trim()).map((s) => `<h3>${s.title}</h3>\n${s.content}`).join("\n");
    await api.post("/templates", { name, content, category, modality, bodyPart: bodyPart || undefined, sections });
    setMessage("Template saved.");
    setName("");
    setSections(DEFAULT_SECTIONS.map((s) => ({ ...s })));
    setTimeout(() => setMessage(null), 3000);
  }

  return (
    <form className="card space-y-4 p-5" onSubmit={(e) => void handleSubmit(e)}>
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-bold text-tdai-primary">Create Report Template</h2>
        <span className="badge bg-tdai-teal-50 text-tdai-teal-700 ring-1 ring-tdai-teal-200 dark:bg-tdai-teal-900/20 dark:text-tdai-teal-300 dark:ring-tdai-teal-700/50">Template Studio</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500 dark:text-tdai-gray-400">Template Name</label>
          <input
            className="input-field"
            placeholder="e.g. Chest X-Ray Normal"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500 dark:text-tdai-gray-400">Category</label>
          <select className="select-field w-full" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500 dark:text-tdai-gray-400">Modality</label>
          <select className="select-field w-full" value={modality} onChange={(e) => setModality(e.target.value)}>
            {MODALITIES.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-semibold text-gray-500 dark:text-tdai-gray-400">Body Part</label>
          <input
            className="input-field"
            placeholder="e.g. Chest, Abdomen"
            value={bodyPart}
            onChange={(e) => setBodyPart(e.target.value)}
          />
        </div>
      </div>

      <div className="flex overflow-x-auto border-b border-tdai-gray-200 dark:border-white/[0.08]">
        {sections.map((section) => (
          <button
            key={section.key}
            type="button"
            onClick={() => setActiveSection(section.key)}
            className={`flex-shrink-0 border-b-2 px-4 py-2 text-xs font-semibold transition ${
              activeSection === section.key ? "border-tdai-accent text-tdai-accent" : "border-transparent text-gray-400 hover:text-gray-600 dark:text-tdai-gray-400 dark:hover:text-tdai-gray-200"
            }`}
          >
            {section.title}
          </button>
        ))}
      </div>

      {sections.map((section) => (
        <div key={section.key} className={activeSection === section.key ? "block" : "hidden"}>
          <TipTapEditor
            content={section.content}
            onChange={(html) => updateSection(section.key, html)}
            placeholder={`Enter default content for ${section.title}...`}
          />
        </div>
      ))}

      <div className="flex items-center gap-3">
        <button className="btn-primary" type="submit">
          Save Template
        </button>
        {message && <p className="text-sm font-medium text-emerald-600 dark:text-emerald-400">{message}</p>}
      </div>
    </form>
  );
}
