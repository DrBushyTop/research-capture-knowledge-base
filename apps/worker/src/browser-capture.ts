import { z } from 'zod';

export const browserCaptureVersion = 'browser-1';
export const captureLimits = { views: 20, actions: 40, milliseconds: 180_000, text: 60_000 };
export interface BrowserControl { id: string; label: string; kind: 'link' | 'button'; href?: string }
export interface BrowserView { url: string; title: string; text: string; controls: BrowserControl[]; screenshot?: string; capturedAt?: string; blockedRequests: number }
export interface BrowserCaptureSession {
  observe(signal: AbortSignal): Promise<BrowserView>;
  act(action: CaptureDecision, signal: AbortSignal): Promise<void>;
  close(): Promise<void>;
}
export const captureDecisionSchema = z.strictObject({
  action: z.enum(['click', 'scroll', 'scroll-left', 'scroll-right', 'back', 'reload', 'finish']), target: z.string().max(20),
  reason: z.string().max(300), coverage: z.string().max(1000)
});
export type CaptureDecision = z.infer<typeof captureDecisionSchema>;
export type CapturePlanner = (source: { title: string; url: string }, view: BrowserView, history: { action: CaptureDecision; url: string }[], signal: AbortSignal) => Promise<CaptureDecision>;
export interface BrowserCapture {
  version: string; sourceUrl: string; retrievedAt: string; text: string;
  views: BrowserView[]; actions: { action: CaptureDecision; url: string }[];
  complete: boolean; stopReason: string; coverage: string;
}

/** Readability is article-oriented. Navigation gates and interactive indexes need rendered capture, even when their text is long. */
export function browserCaptureNeeded(text: string, html: string) {
  if (text.trim().length < 80) return true;
  if (/<title[^>]*>[^<]*(?:choose.{0,20}language|scegli.{0,20}lingua|select.{0,20}language)/i.test(html)) return true;
  const gate = /(?:choose|select|scegli|seleziona).{0,30}(?:language|lingua)|(?:sign|log)\s*in|enable javascript/i;
  if (text.length < 1800 && gate.test(text)) return true;
  const headings = (text.match(/\b(?:details|dettagli)\b/gi) || []).length;
  return headings >= 4 && text.length < 6000 || text.length < 1000 && /(?:__next|__NEXT_DATA__|self\.__next_f|id=["'](?:root|app)["'])/.test(html);
}

const consequential = /\b(?:login|log in|sign in|sign up|register|checkout|pay|purchase|order now|add to cart|book|reserve|prenota|accedi|paga|ordina|buy|submit|send|delete|unsubscribe|accept all|accetta tutto)\b/i;
export function safeControl(control: BrowserControl, origin: string) {
  if (consequential.test(control.label)) return false;
  if (!control.href) return true;
  try {
    const url = new URL(control.href, origin);
    return url.origin === new URL(origin).origin && !url.username && !url.password && !consequential.test(url.pathname);
  } catch { return false; }
}

/** The model chooses only among observed controls. Budgets and navigation safety are not prompt-enforced. */
export async function captureDocument(source: { title: string; url: string }, session: BrowserCaptureSession, plan: CapturePlanner, caller: AbortSignal, limits = captureLimits): Promise<BrowserCapture> {
  const signal = AbortSignal.any([caller, AbortSignal.timeout(limits.milliseconds)]);
  const result: BrowserCapture = { version: browserCaptureVersion, sourceUrl: source.url, retrievedAt: new Date().toISOString(), text: '', views: [], actions: [], complete: false, stopReason: 'view-limit', coverage: 'Capture budget reached; some content may be missing.' };
  const seen = new Set<string>(); const failed = new Set<string>(); let unchanged = 0;
  try {
    for (let step = 0; step < limits.actions; step++) {
      signal.throwIfAborted();
      const view = await session.observe(signal);
      view.controls = view.controls.filter(control => !failed.has(`${view.url}:${control.id}:${control.label}`));
      if (new URL(view.url).origin !== new URL(source.url).origin) { result.stopReason = 'outside-origin'; break; }
      const signature = JSON.stringify([view.url, view.text]);
      if (!seen.has(signature)) {
        if (result.views.length >= limits.views) { result.stopReason = 'view-limit'; break; }
        seen.add(signature); result.views.push(view); unchanged = 0;
        const block = `\n\n## ${view.title}\nURL: ${view.url}\nCaptured: ${view.capturedAt || result.retrievedAt}\n\n${view.text}`;
        result.text += block.slice(0, Math.max(0, limits.text - result.text.length));
      } else unchanged++;
      if (result.text.length >= limits.text) { result.stopReason = 'text-limit'; break; }
      if (result.views.length >= limits.views) { result.stopReason = 'view-limit'; break; }
      if (unchanged >= 3) { result.stopReason = 'no-progress'; break; }
      if (/captcha|verify (?:you are|that you)|access denied|sign in to continue/i.test(view.text.slice(0, 1500))) { result.stopReason = 'access-gate'; break; }
      const decision = captureDecisionSchema.parse(await plan(source, view, result.actions, signal));
      result.coverage = decision.coverage;
      if (decision.action === 'finish') {
        result.complete = result.views.some(view => !browserCaptureNeeded(view.text, '') && view.text.trim().length >= 80);
        result.stopReason = result.complete ? 'agent-finished' : 'content-unavailable'; break;
      }
      if (decision.action === 'click') {
        const control = view.controls.find(control => control.id === decision.target);
        if (!control || !safeControl(control, source.url)) { result.stopReason = 'invalid-action'; break; }
      }
      result.actions.push({ action: decision, url: view.url });
      try { await session.act(decision, signal); }
      catch {
        signal.throwIfAborted();
        const control = view.controls.find(control => control.id === decision.target);
        if (control) failed.add(`${view.url}:${control.id}:${control.label}`);
        result.coverage += ' One interaction failed; its content was not captured.';
      }
      result.stopReason = 'action-limit';
    }
  } catch (error) {
    caller.throwIfAborted();
    result.complete = false; result.stopReason = signal.aborted ? 'time-limit' : 'browser-error';
    result.coverage += ' Browser capture did not complete.';
    if (!result.views.length) throw error;
  }
  // An agent's finish is a coverage judgement, not proof that the entire website was captured.
  if (result.views.some(view => view.blockedRequests > 0)) result.coverage += ' Some network requests were blocked by capture policy.';
  result.text = result.text.trim();
  return result;
}
