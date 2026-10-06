import type { ChatJob, ChatRequest } from '../../../shared/chat.js';
const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const form = element<HTMLFormElement>('chat-form');
const question = element<HTMLTextAreaElement>('chat-question');
const source = element<HTMLSelectElement>('chat-source');
const visual = element<HTMLSelectElement>('chat-visual');
const page = element<HTMLInputElement>('chat-page');
const submit = element<HTMLButtonElement>('chat-submit');
const clear = element<HTMLButtonElement>('chat-clear');
const status = element<HTMLParagraphElement>('chat-status');
const transcript = element<HTMLDivElement>('chat-transcript');
const history: ChatRequest['history'] = [];
let active = false;
let answerNumber = 0;
const labels = { source: 'Stored source text', machine: 'Generated analysis', human: 'Human notes', metadata: 'Source metadata', visual: 'Rendered source page or image' };
function turn(kind: 'question' | 'answer', text: string) {
  const section = document.createElement('section'); section.className = `chat-turn ${kind}`;
  const heading = document.createElement('h2'); heading.textContent = kind === 'question' ? 'Your question' : 'Answer from your collection'; section.append(heading);
  const body = document.createElement('div'); body.className = 'chat-answer-text'; body.textContent = text; section.append(body);
  transcript.append(section); return section;
}
function render(result: NonNullable<ChatJob['result']>) {
  const section = turn('answer', '');
  const number = ++answerNumber;
  const body = section.querySelector('.chat-answer-text')!;
  let start = 0;
  for (const match of result.answer.matchAll(/\[(e_[a-f0-9]{16})\]/g)) {
    body.append(document.createTextNode(result.answer.slice(start, match.index)));
    const index = result.citations.findIndex(citation => citation.evidenceId === match[1]);
    if (index >= 0) {
      const marker = document.createElement('a'); marker.href = `#chat-citation-${number}-${index + 1}`; marker.textContent = `[${index + 1}]`; marker.setAttribute('aria-label', `Evidence ${index + 1}`); body.append(marker);
    } else body.append(document.createTextNode('[Citation unavailable]'));
    start = match.index + match[0].length;
  }
  body.append(document.createTextNode(result.answer.slice(start)));
  const answerHeading = section.querySelector('h2')!; answerHeading.tabIndex = -1;
  if (result.insufficientEvidence) { const notice = document.createElement('p'); notice.className = 'evidence-notice'; notice.textContent = 'The stored evidence does not fully answer this question.'; section.append(notice); }
  if (result.citations.length) {
    const heading = document.createElement('h3'); heading.textContent = 'Evidence to check'; section.append(heading);
    const list = document.createElement('ol'); list.className = 'chat-citations';
    for (const [index, citation] of result.citations.entries()) {
      const row = document.createElement('li'); row.id = `chat-citation-${number}-${index + 1}`; const link = document.createElement('a'); link.href = `/research/${encodeURIComponent(citation.sourceId)}/`; link.textContent = citation.title; row.append(link);
      const locator = document.createElement('p'); locator.className = 'chat-evidence-label'; locator.textContent = `${labels[citation.kind]} · ${citation.locator}`; row.append(locator);
      const details = document.createElement('details'); const summary = document.createElement('summary'); summary.textContent = 'Read the supplied passage'; details.append(summary);
      const excerpt = document.createElement('p'); excerpt.textContent = citation.quote || citation.excerpt; details.append(excerpt); row.append(details); list.append(row);
    }
    section.append(list);
  }
  return answerHeading;
}
async function api(url: string, init?: RequestInit) {
  const response = await fetch(url, { ...init, credentials: 'same-origin', redirect: 'follow', signal: AbortSignal.timeout(35_000) });
  if (response.redirected || [401, 403].includes(response.status)) { element('chat-signin').hidden = false; throw new Error('Your reader session has expired. Sign in again.'); }
  if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Chat is unavailable. Try again in a moment.');
  const value = await response.json(); if (!response.ok) throw new Error(value.error || 'Chat is unavailable. Try again.'); return value;
}
visual.addEventListener('change', () => { page.disabled = !visual.value; });
const preselected = new URLSearchParams(location.search).get('source');
if (preselected && [...source.options].some(option => option.value === preselected)) source.value = preselected;
clear.addEventListener('click', () => { if (active) return; transcript.replaceChildren(); history.length = 0; element('chat-empty').hidden = false; clear.hidden = true; status.textContent = ''; question.value = ''; question.focus(); });
form.addEventListener('submit', async event => {
  event.preventDefault(); if (active || !question.value.trim()) return;
  if (!form.reportValidity()) return;
  const text = question.value.trim();
  const request: ChatRequest = { question: text, history: history.slice(-6), ...(source.value ? { sourceId: source.value } : {}),
    ...(visual.value ? { visual: { sourceId: visual.value, page: Number(page.value) } } : {}) };
  while (new TextEncoder().encode(JSON.stringify(request)).length > 16_000 && request.history.length) request.history.shift();
  let answerHeading: HTMLElement | undefined;
  active = true; submit.disabled = clear.disabled = question.disabled = source.disabled = visual.disabled = page.disabled = true;
  submit.textContent = 'Finding evidence…'; status.textContent = 'Reading stored sources. This may take a minute.'; element('chat-empty').hidden = true; element('chat-signin').hidden = true;
  const pending = turn('question', text);
  try {
    const { id } = await api('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(request) });
    const started = Date.now();
    while (Date.now() - started < 10 * 60_000) {
      await new Promise(resolve => setTimeout(resolve, 2500));
      const job = await api(`/api/chat?id=${encodeURIComponent(id)}`) as Pick<ChatJob, 'status' | 'result' | 'error'>;
      if (job.status === 'failed') throw new Error(job.error || 'The question could not be completed. Try again.');
      if (job.status === 'complete' && job.result) {
        answerHeading = render(job.result); history.push({ role: 'user', content: text.slice(0, 3000) }, { role: 'assistant', content: job.result.answer.slice(0, 3000) });
        history.splice(0, Math.max(0, history.length - 6)); question.value = ''; clear.hidden = false; status.textContent = 'Answer ready. Check its cited evidence.'; return;
      }
      status.textContent = 'Finding evidence and preparing an answer. You can keep reading while this finishes.';
    }
    throw new Error('The question timed out. Try again.');
  } catch (error) {
    pending.remove(); status.textContent = error instanceof Error ? error.message : 'Chat is unavailable. Try again.';
    element('chat-empty').hidden = transcript.children.length > 0;
  } finally {
    active = false; submit.disabled = clear.disabled = question.disabled = source.disabled = visual.disabled = false; page.disabled = !visual.value;
    submit.textContent = 'Ask collection';
    if (document.activeElement === document.body || form.contains(document.activeElement)) {
      if (answerHeading) { answerHeading.focus({ preventScroll: true }); answerHeading.scrollIntoView({ block: 'start' }); }
      else question.focus();
    }
  }
});
