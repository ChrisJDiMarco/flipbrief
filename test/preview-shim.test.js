import fs from 'node:fs';
import vm from 'node:vm';
import { describe, expect, it } from 'vitest';

describe('browser preview shim', () => {
  it('provides inert shape-correct APIs without replacing Electron preload', async () => {
    const source = fs.readFileSync('src/renderer/public/preview-shim.js', 'utf8');
    const window = {};
    vm.runInNewContext(source, { window });

    expect(Object.isFrozen(window.flipbrief)).toBe(true);
    expect(await window.flipbrief.listBooks()).toEqual([]);
    expect(await window.flipbrief.listJobs()).toEqual([]);
    expect(await window.flipbrief.getSettings()).toMatchObject({ pageCount: 5 });
    expect(await window.flipbrief.queueImport()).toMatchObject({ ok: false, unavailable: true });
    expect(window.flipbrief.onBooksChanged()).toBeTypeOf('function');

    const electronAPI = { appMeta: () => 'native' };
    const nativeWindow = { flipbrief: electronAPI };
    vm.runInNewContext(source, { window: nativeWindow });
    expect(nativeWindow.flipbrief).toBe(electronAPI);
  });
});
