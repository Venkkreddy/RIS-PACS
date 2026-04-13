/** Format amounts as Indian Rupees (INR) for billing UI. Uses explicit ₹ — never `style: "currency"`, which can render as $ in some runtimes. */
export function formatInr(amount: number): string {
  const n = Number.isFinite(amount) ? amount : 0;
  const grouped = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n);
  return `₹${grouped}`;
}
