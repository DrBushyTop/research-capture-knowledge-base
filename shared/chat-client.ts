// Runtime helpers used by the reader. Keep this module free of server imports.
export const maxMessageImages = 4;

export function citationLabel(source: { title: string; authors: string[]; url: string | null }) {
  const short = (value: string) => value.length > 26 ? value.slice(0, 25).trimEnd() + '…' : value;
  try {
    const host = source.url ? new URL(source.url).hostname.replace(/^www\./, '') : '';
    if (host && !['doi.org', 'dx.doi.org', 'zotero.org'].includes(host)) return short(host);
  } catch { /* Invalid URLs fall through to authors. */ }
  const author = source.authors[0]?.trim();
  if (author) return short((author.includes(',') ? author.split(',')[0] : author.split(/\s+/).at(-1)!) + (source.authors.length > 1 ? ' et al.' : ''));
  return short(source.title.trim() || 'Source');
}
