import { describe, expect, it } from 'vitest';
import { PreviewCache } from '../../src/ui/previewCache';

describe('PreviewCache', () => {
  it('loads each file and size once, and forgets failures', async () => {
    const cache = new PreviewCache<string>();
    let loads = 0;
    const load = async () => `p${++loads}`;
    expect(await cache.get(1, 100, load)).toBe('p1');
    expect(await cache.get(1, 100, load)).toBe('p1');
    expect(await cache.get(1, 200, load)).toBe('p2');
    const failed = cache.get(2, 100, () => Promise.reject(new Error('nope')));
    await expect(failed).rejects.toThrow('nope');
    expect(await cache.get(2, 100, load)).toBe('p3');
  });

  it('forgets one file, and trims others while keeping the selected one', async () => {
    const cache = new PreviewCache<number>();
    for (let id = 1; id <= 6; id++) await cache.get(id, 10, async () => id);
    cache.forget(6);
    let reloaded = false;
    await cache.get(6, 10, async () => ((reloaded = true), 6));
    expect(reloaded).toBe(true);
    cache.trim(1, 2);
    let kept = true;
    await cache.get(1, 10, async () => ((kept = false), 1));
    expect(kept).toBe(true);
  });
});
