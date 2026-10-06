// Turns the streamed JSON of a chat answer into a displayable draft of complete Markdown blocks.

/** Decodes the `answer` string from a JSON prefix such as `{"answer":"First para`. Stops before an incomplete escape. */
export function partialAnswer(json: string) {
  const start = json.match(/^\s*\{\s*"answer"\s*:\s*"/);
  if (!start) return '';
  let text = '';
  for (let i = start[0].length; i < json.length; i++) {
    const char = json[i];
    if (char === '"') break;
    if (char !== '\\') { text += char; continue; }
    const next = json[i + 1];
    if (next === undefined) break;
    if (next === 'u') {
      const code = json.slice(i + 2, i + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(code)) break;
      text += String.fromCharCode(parseInt(code, 16)); i += 5; continue;
    }
    text += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' } as Record<string, string>)[next] ?? next; i++;
  }
  return text;
}

/**
 * Returns the prefix made of finished blocks: everything before the last blank line outside an open code fence.
 * A table, list or fence is released only once a blank line follows it, so readers never see half a table.
 */
export function completeBlocks(markdown: string) {
  let fence: string | undefined;
  let end = 0; let offset = 0;
  const lines = markdown.split('\n');
  // The last element has no newline yet and may still grow.
  for (const line of lines.slice(0, -1)) {
    offset += line.length + 1;
    const marker = line.match(/^\s{0,3}(`{3,}|~{3,})/)?.[1];
    if (marker && !fence) fence = marker;
    else if (marker && fence && marker[0] === fence[0] && marker.length >= fence.length && !line.trim().slice(marker.length).trim()) fence = undefined;
    else if (!fence && !line.trim()) end = offset;
  }
  return markdown.slice(0, end).replace(/\s*\[e_[a-f0-9]{16}\]/g, '').trimEnd();
}

export const streamedDraft = (json: string) => completeBlocks(partialAnswer(json));
