/** Format a YYYY-MM-DD value for tables and labels (locale-aware, not raw ISO). */
export function formatIsoDateDisplay(iso: string | undefined | null): string {
  if (iso == null || String(iso).trim() === "") return "—";
  const s = String(iso).trim();
  const d = new Date(`${s}T12:00:00`);
  if (Number.isNaN(d.getTime())) return s;
  return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}
