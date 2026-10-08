import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { sourceDocumentQuery } from '../lib/queries';
import { FileText } from 'lucide-react';
import { MessageResponse } from './ai-elements/message';
import type { ExtractionArtifact } from '../../../../shared/corpus';

type Props = { sourceId: string; artifactMime?: string | null; artifacts?: ExtractionArtifact[]; sourceUrl?: string | null };
type State = { status: 'loading' } | { status: 'ready'; text: string } | { status: 'error'; message: string };
const documentTypes: Record<string, 'pdf' | 'image' | 'docx' | 'text'> = { 'application/pdf': 'pdf', 'image/png': 'image', 'image/jpeg': 'image', 'image/webp': 'image',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx', 'text/plain': 'text', 'text/markdown': 'text', 'text/csv': 'text', 'application/json': 'text' };

/** Saved original text and retained file for one source, read from the private chat API. */
export default function OriginalText({ sourceId, artifactMime, artifacts, sourceUrl }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const kind = artifactMime ? documentTypes[artifactMime] : undefined;
  const files = artifacts || (artifactMime ? [{ mime: artifactMime, key: undefined, title: undefined, hash: 'original' }] : []);
  const readableFiles = files.filter(file => file.mime === 'application/pdf' || file.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || file.mime.startsWith('text/') || file.mime === 'application/json');
  const [selectedKey, setSelectedKey] = useState(artifacts?.find(file => file.analyzed && file.status === 'text')?.key || readableFiles[0]?.key);
  const text = useInfiniteQuery(sourceDocumentQuery(sourceId, selectedKey));
  const loaded = text.data?.pages.map(page => page.sections?.length ? page.sections.map(section => `${section.page ? `\n\n<!-- PDF page ${section.page} -->\n\n` : ''}${section.text}`).join('') : page.text || '').join('') || '';
  const state: State = text.data ? { status: 'ready', text: loaded } : text.error ? { status: 'error', message: text.error.message } : { status: 'loading' };
  const long = state.status === 'ready' && state.text.length > 2400;
  const selectedMime = text.data?.pages[0]?.artifact?.mime || readableFiles.find(file => file.key === selectedKey)?.mime || artifactMime;
  const pdfMarkdown = state.status === 'ready' && (/<!-- PDF page \d+ -->/.test(state.text) || selectedMime === 'application/pdf' || selectedMime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  return <>
    {files.map(file => {
      const type = documentTypes[file.mime];
      const identity = file.key || file.hash;
      const documentUrl = `/api/chat?document=${encodeURIComponent(sourceId)}${file.key ? '&attachment=' + encodeURIComponent(file.key) : ''}`;
      return type === 'image' ? failedImages.includes(identity) ? <p key={identity} className="original-missing">The saved image could not be loaded.</p>
        : <a key={identity} className="original-image" href={documentUrl} target="_blank" rel="noreferrer"><img src={documentUrl} alt={file.title || 'Saved original image'} loading="lazy" onError={() => setFailedImages(value => [...value, identity])} /></a>
        : type && <a key={identity} className="original-file" href={documentUrl} target="_blank" rel="noreferrer"><FileText size={20} aria-hidden="true" /><span>{type === 'pdf' ? 'Open saved PDF' : type === 'docx' ? 'Download saved DOCX' : 'Download saved text'}<small>{file.title || 'Original file'}</small></span></a>;
    })}
    {readableFiles.length > 1 && <label className="original-picker">Read attachment <select value={selectedKey || ''} onChange={event => { setSelectedKey(event.target.value); setExpanded(false); }}>
      {readableFiles.map(file => <option key={file.key || file.hash} value={file.key || ''}>{file.title || file.key || file.mime}</option>)}
    </select></label>}
    {text.data?.pages[0]?.captureCommentary?.description && <details className="original-capture-notes"><summary>Saved Zotero description or caption</summary>
      <div className="original-text">{text.data.pages[0].captureCommentary.description}</div>
      {text.data.pages[0].captureCommentary.descriptionTruncated && <p className="original-missing">Only part of the saved description is shown.</p>}
    </details>}
    {text.data?.pages[0]?.captureCommentary?.text && <details className="original-capture-notes"><summary>Saved Zotero notes and annotations</summary>
      <div className="original-text">{text.data.pages[0].captureCommentary.text}</div>
      {text.data.pages[0].captureCommentary.truncated && <p className="original-missing">Only part of the saved capture notes is shown.</p>}
    </details>}
    {state.status === 'loading' && <p className="original-missing" aria-busy="true">Loading original text…</p>}
    {state.status === 'error' && <p className="original-missing" role="alert">{state.message}</p>}
    {state.status === 'ready' && (state.text ? <>
      <div className={`original-text${pdfMarkdown ? ' is-markdown' : ''}${long && !expanded ? ' is-clipped' : ''}`}>{pdfMarkdown
        ? <MessageResponse mode="static" controls={false} components={{
          img: () => null,
          a: ({ children }) => <span>{children}</span>
        }}>{state.text.replace(/<!-- PDF page (\d+) -->/g, '\n\n**PDF page $1**\n\n')}</MessageResponse>
        : state.text}</div>
      {long && <button type="button" className="original-more" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'Show less' : text.hasNextPage ? 'Show loaded text' : 'Show full text'}</button>}
      {text.hasNextPage && <button type="button" className="original-more" disabled={text.isFetchingNextPage} onClick={() => { setExpanded(true); void text.fetchNextPage(); }}>{text.isFetchingNextPage ? 'Loading more text...' : 'Load more original text'}</button>}
    </> : <p className="original-missing">No saved text for this source.{!kind && sourceUrl && <> <a href={sourceUrl} rel="noreferrer">Open the original website</a>.</>}</p>)}
    {text.data?.pages[0]?.complete === false && <p className="original-missing">{text.data.pages[0].reason || 'Some content could not be extracted. The original file remains available.'}</p>}
  </>;
}
