// Pure helpers shared by the UI and unit tests (no DOM access here).

/** 3723000 -> "1:02:03" */
export function formatDuration(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Date -> "YYYY-MM-DD" in the local time zone (toISOString would use UTC). */
export function toDateInput(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Converts an inclusive local date range ("2026-10-01".."2026-10-31") into a
 * half-open UTC instant range [from, to) for the API.
 */
export function dateRangeToPeriod(fromDate, toDate) {
  const [fy, fm, fd] = fromDate.split('-').map(Number);
  const [ty, tm, td] = toDate.split('-').map(Number);
  const from = new Date(fy, fm - 1, fd);
  const to = new Date(ty, tm - 1, td + 1); // end of the "to" day
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Preset ranges relative to `now`; weeks start on Monday. */
export function presetRange(preset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === 'week') {
    const offset = (today.getDay() + 6) % 7;
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - offset);
    return { from: toDateInput(start), to: toDateInput(today) };
  }
  if (preset === 'month') {
    return { from: toDateInput(new Date(today.getFullYear(), today.getMonth(), 1)), to: toDateInput(today) };
  }
  return { from: toDateInput(today), to: toDateInput(today) };
}
