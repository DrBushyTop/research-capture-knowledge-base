import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { sourceTextQuery } from '../lib/queries';
import { FileText } from 'lucide-react';

type Props = { sourceId: string; artifactMime?: string | null; sourceUrl?: string | null };
type State = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error'; message: string };
const documentTypes: Record<string, 'pdf' | 'image'> = { 'application/pdf': 'pdf', 'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image' };

/** Saved original text and retained file for one source, read from the private chat API. */
export default function OriginalText({ sourceId, artifactMime, sourceUrl }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [imageFailed, setImageFailed] = useState(false);
  const kind = artifactMime ? documentTypes[artifactMime] : undefined;
  const documentUrl = `/api/chat?document=${encodeURIComponent(sourceId)}`;
  const text = useQuery(sourceTextQuery(sourceId));
  const state: State = text.data ? { status: 'ready', text: String(text.data.text || '') } : text.error ? { status: 'error', message: text.error.message } : { status: 'loading' };
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
