import type { LibrarySnapshot, ZoteroItem } from '../../../shared/corpus.js';
const pause = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
export class Zotero {
  constructor(readonly accountId: string, private readonly apiKey: string, readonly libraryType: 'users' | 'groups' = 'users') {
    if (!/^\d+$/.test(accountId)) throw new Error('Invalid Zotero library ID');
  }
  async request(path: string, headers: Record<string, string> = {}): Promise<Response> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await fetch(`https://api.zotero.org/${this.libraryType}/${this.accountId}/${path}`, {
        headers: { 'Zotero-API-Key': this.apiKey, 'Zotero-API-Version': '3', ...headers }, redirect: 'manual', signal: AbortSignal.timeout(60_000)
      });
      if ([429, 503].includes(response.status)) {
        await response.body?.cancel();
        const delay = Number(response.headers.get('Retry-After') || 2 ** attempt);
        if (!Number.isFinite(delay) || delay > 30) throw new Error('Zotero requested a later retry');
        await pause(Math.max(1, delay) * 1000); continue;
      }
      const backoff = Number(response.headers.get('Backoff') || 0);
      if (backoff > 0 && backoff <= 30) await pause(backoff * 1000);
      if (!response.ok && ![304, 302, 303].includes(response.status)) { await response.body?.cancel(); throw new Error(`Zotero HTTP ${response.status}`); }
      return response;
    }
    throw new Error('Zotero transient failure');
  }
  async snapshot(previousVersion?: number): Promise<LibrarySnapshot | undefined> {
    for (let attempt = 0; attempt < 3; attempt++) {
      let version: number | undefined; let stable = true;
      const items: ZoteroItem[] = [];
      for (let start = 0; ; start += 100) {
        const response = await this.request(`items?limit=100&start=${start}&includeTrashed=0`, start === 0 && previousVersion !== undefined ? { 'If-Modified-Since-Version': String(previousVersion) } : {});
        if (response.status === 304) return undefined;
        const pageVersion = Number(response.headers.get('Last-Modified-Version'));
        if (!Number.isSafeInteger(pageVersion) || pageVersion < 0) throw new Error('Missing library version');
        if (version !== undefined && version !== pageVersion) { await response.body?.cancel(); stable = false; break; }
        version = pageVersion;
        const page = await response.json() as ZoteroItem[];
        if (!Array.isArray(page)) throw new Error('Invalid Zotero response');
        items.push(...page);
        if (page.length < 100) break;
        if (items.length >= 20_000) throw new Error('Library size needs a reviewed paging policy');
      }
      if (stable) return { libraryType: this.libraryType, libraryId: this.accountId, version: version!, items };
    }
    throw new Error('Library changed during pagination; retry later');
  }
}
