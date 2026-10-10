/**
 * Decoded previews, kept for the selected file and a few others to limit
 * memory use. Plain rather than reactive on purpose: nothing on screen
 * depends on what happens to be cached.
 */
export class PreviewCache<T> {
  private entries = new Map<string, Promise<T>>();

  /** The cached preview of a file at a size, or a new one from `load` (failures aren't kept). */
  get(id: number, size: number, load: () => Promise<T>): Promise<T> {
    const key = `${id}:${size}`;
    const cached = this.entries.get(key);
    if (cached) return cached;
    const p = load();
    this.entries.set(key, p);
    p.catch(() => this.entries.delete(key));
    return p;
  }

  /** Drops every preview of one file. */
  forget(id: number): void {
    for (const key of [...this.entries.keys()]) {
      if (key.startsWith(`${id}:`)) this.entries.delete(key);
    }
  }

  /** Drops previews of files other than `keep` until at most `limit` remain. */
  trim(keep: number | null, limit = 4): void {
    for (const key of [...this.entries.keys()]) {
      if (this.entries.size <= limit) break;
      if (!key.startsWith(`${keep}:`)) this.entries.delete(key);
    }
  }
}
