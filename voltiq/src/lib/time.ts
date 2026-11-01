// Measurement timestamps are source wall-clock labels, never viewer-local instants.
export function addSourceMinutes(value: string, minutes: number): string {
  const result = new Date(value + "Z");
  if (Number.isNaN(result.getTime()))
    throw new Error("Invalid source timestamp");
  result.setUTCMinutes(result.getUTCMinutes() + minutes);
  return result.toISOString().slice(0, 19);
}
export function inclusiveEndToExclusive(day: string): string {
  return addSourceMinutes(day + "T00:00:00", 1440);
}
export function exclusiveEndToInclusive(value: string): string {
  return addSourceMinutes(value, -1).slice(0, 10);
}
export function sourceTimestampLabel(value: string): string {
  if (!value) return "Unavailable";
  const [day, time] = value.split("T");
  return `${day} ${(time ?? "").slice(0, 8)}`.trim();
}
export function sourceLabel(value: string, short = false): string {
  if (!value) return "Unavailable";
  const [day, time] = value.split("T");
  return short
    ? (time?.slice(0, 5) ?? day)
    : `${day} ${time?.slice(0, 5) ?? ""}`.trim();
}
export function inRange(time: string, from: string, to: string): boolean {
  return time >= from && time < to;
}
export function validRange(from: string, to: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T/.test(from) &&
    /^\d{4}-\d{2}-\d{2}T/.test(to) &&
    from < to
  );
}
export function isSourceTimestamp(value: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value) &&
    !Number.isNaN(Date.parse(value + "Z")) &&
    new Date(value + "Z").toISOString().slice(0, 19) === value
  );
}
export function number(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value)
    ? "Unavailable"
    : value.toLocaleString("en", {
        maximumFractionDigits: digits,
        minimumFractionDigits: digits,
      });
}
export function csvCell(value: unknown): string {
  let text = value == null ? "" : String(value);
  if (typeof value === "string" && /^[\s]*[=+\-@]/.test(text))
    text = "'" + text;
  return /[",\n\r]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text;
}
export function downloadCsv(filename: string, rows: Record<string, unknown>[]) {
  if (!rows.length) return;
  const headers = Object.keys(rows[0]);
  const csv = [
    headers.map(csvCell).join(","),
    ...rows.map((row) => headers.map((key) => csvCell(row[key])).join(",")),
  ].join("\r\n");
  const url = URL.createObjectURL(
    new Blob([csv], { type: "text/csv;charset=utf-8;" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
