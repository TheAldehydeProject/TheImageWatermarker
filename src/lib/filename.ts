/** "holiday.JPG" + "webp" + "-compressed" → "holiday-compressed.webp" */
export function outputFileName(original: string, extension: string, suffix: string): string {
  const slash = Math.max(original.lastIndexOf('/'), original.lastIndexOf('\\'));
  const base = original.slice(slash + 1);
  const dot = base.lastIndexOf('.');
  const stem = (dot > 0 ? base.slice(0, dot) : base) || 'image';
  const oldExt = dot > 0 ? base.slice(dot + 1).toLowerCase() : '';
  const sameExt =
    oldExt === extension ||
    (extension === 'jpg' && oldExt === 'jpeg') ||
    (extension === 'tiff' && oldExt === 'tif');
  // A conversion to the same type still needs a different name.
  const tag = suffix || (sameExt ? '-converted' : '');
  return `${stem}${tag}.${extension}`;
}

/** Makes names unique (case-insensitively) by adding " (2)", " (3)", … */
export function uniqueNames(names: string[]): string[] {
  const seen = new Set<string>();
  return names.map((name) => {
    let candidate = name;
    const dot = name.lastIndexOf('.');
    const stem = dot > 0 ? name.slice(0, dot) : name;
    const ext = dot > 0 ? name.slice(dot) : '';
    for (let n = 2; seen.has(candidate.toLowerCase()); n++) candidate = `${stem} (${n})${ext}`;
    seen.add(candidate.toLowerCase());
    return candidate;
  });
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v >= 10 ? v.toFixed(1) : v.toFixed(2)} ${units[i]}`;
}

/** "-23%" when smaller, "+5%" when bigger. */
export function formatChange(before: number, after: number): string {
  if (before <= 0) return '';
  const pct = ((after - before) / before) * 100;
  const rounded = Math.abs(pct) < 0.95 ? pct.toFixed(1) : pct.toFixed(0);
  return `${pct > 0 ? '+' : ''}${rounded}%`;
}
