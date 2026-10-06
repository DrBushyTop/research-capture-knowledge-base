export function sourceTypeLabel(type: string) {
  const labels: Record<string, string> = { journalArticle: 'Journal article', webpage: 'Webpage', attachment: 'Attachment', bookSection: 'Book chapter', conferencePaper: 'Conference paper', preprint: 'Preprint' };
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  return labels[type] || words.charAt(0).toUpperCase() + words.slice(1);
}
/** Stable tone 1–6 for a category id, so the same category keeps its color in lists and notes. */
export function categoryTone(id: string | null | undefined) {
  if (!id) return 0;
  let value = 0;
  for (const char of id) value = (value * 31 + char.charCodeAt(0)) >>> 0;
  return value % 6 + 1;
}
