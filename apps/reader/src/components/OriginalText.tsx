import { useEffect, useState } from 'react';
import { FileText } from 'lucide-react';

type Props = { sourceId: string; artifactMime?: string | null; sourceUrl?: string | null };
type State = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error'; message: string };
const documentTypes: Record<string, 'pdf' | 'image'> = { 'application/pdf': 'pdf', 'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image' };

/** Saved original text and retained file for one source, read from the private chat API. */
export default function OriginalText({ sourceId, artifactMime, sourceUrl }: Props) {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const kind = artifactMime ? documentTypes[artifactMime] : undefined;
  const documentUrl = `/api/chat?document=${encodeURIComponent(sourceId)}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/chat?source=${encodeURIComponent(sourceId)}`, { credentials: 'same-origin', signal: controller.signal }).then(async response => {
      if (response.status === 401 || response.status === 403 || !response.headers.get('content-type')?.includes('application/json')) throw new Error('Sign in with an invited account to read the original text.');
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || 'Original text could not be loaded.');
      setState({ status: 'ready', text: String(value.text || '') });
    }).catch(error => { if (!controller.signal.aborted) setState({ status: 'error', message: (error as Error).message }); });
    return () => controller.abort();
  }, [sourceId]);
  const long = state.status === 'ready' && state.text.length > 2400;
  return <>
    {kind === 'image' && (imageFailed ? <p className="original-missing">The saved image could not be loaded.</p>
      : <a className="original-image" href={documentUrl} target="_blank" rel="noreferrer"><img src={documentUrl} alt="Saved original image" loading="lazy" onError={() => setImageFailed(true)} /></a>)}
    {kind === 'pdf' && <a className="original-file" href={documentUrl} target="_blank" rel="noreferrer"><FileText size={20} aria-hidden="true" /><span>Open saved PDF<small>Original file</small></span></a>}
    {state.status === 'loading' && <p className="original-missing" aria-busy="true">Loading original text…</p>}
    {state.status === 'error' && <p className="original-missing" role="alert">{state.message}</p>}
    {state.status === 'ready' && (state.text ? <>
      <div className={`original-text${long && !expanded ? ' is-clipped' : ''}`}>{state.text}</div>
      {long && <button type="button" className="original-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : 'Show full text'}</button>}
    </> : <p className="original-missing">No saved text for this source.{!kind && sourceUrl && <> <a href={sourceUrl} rel="noreferrer">Open the original website</a>.</>}</p>)}
  </>;
}
