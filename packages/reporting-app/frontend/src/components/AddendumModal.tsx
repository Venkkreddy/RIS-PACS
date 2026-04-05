import { FormEvent, useState } from "react";
import { api } from "../api/client";

interface AddendumModalProps {
  reportId: string;
  onSaved: () => void;
}

export function AddendumModal({ reportId, onSaved }: AddendumModalProps) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!value.trim()) return;
    setSubmitting(true);
    await api.patch(`/reports/${reportId}/addendum`, { addendum: value });
    setValue("");
    setOpen(false);
    setSubmitting(false);
    onSaved();
  }

  if (!open) {
    return (
      <button
        className="btn-secondary py-2 text-xs"
        onClick={() => setOpen(true)}
        type="button"
      >
        <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
        </svg>
        Addendum
      </button>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-tdai-navy-900/30 backdrop-blur-sm animate-fade-in dark:bg-tdai-gray-900/70" onClick={() => setOpen(false)} />
      <div className="fixed inset-x-4 top-[20%] z-50 mx-auto max-w-lg animate-scale-in">
        <div className="card shadow-modal overflow-hidden dark:border-white/[0.08]">
          <div className="bg-gradient-to-r from-tdai-navy-700 to-tdai-navy-600 px-5 py-3.5">
            <div className="flex items-center gap-2">
              <svg className="h-5 w-5 text-white/80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <h3 className="text-sm font-bold text-white">Add Addendum</h3>
            </div>
          </div>
          <form className="p-5 space-y-4" onSubmit={(e) => void submit(e)}>
            <div>
              <label className="section-label mb-1.5 block">Addendum Content</label>
              <textarea
                className="input-field min-h-[120px] resize-y"
                placeholder="Enter addendum text..."
                value={value}
                onChange={(e) => setValue(e.target.value)}
                autoFocus
              />
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                className="btn-ghost"
                type="button"
                onClick={() => { setOpen(false); setValue(""); }}
              >
                Cancel
              </button>
              <button
                className="btn-navy"
                type="submit"
                disabled={!value.trim() || submitting}
              >
                {submitting ? (
                  <span className="flex items-center gap-1.5">
                    <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                    Saving...
                  </span>
                ) : (
                  <>
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                    Save Addendum
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
