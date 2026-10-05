export function sourceTypeLabel(type: string) {
  const labels: Record<string, string> = { journalArticle: 'Journal article', webpage: 'Webpage', attachment: 'Attachment', bookSection: 'Book chapter', conferencePaper: 'Conference paper', preprint: 'Preprint' };
  const words = type.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  return labels[type] || words.charAt(0).toUpperCase() + words.slice(1);
}
