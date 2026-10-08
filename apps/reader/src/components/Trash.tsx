import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { RotateCcw, Trash2 } from 'lucide-react';
import { revisionOf, trashQuery, useLifecycleChange, type TrashItem } from '../lib/lifecycle';
import { ConfirmDelete } from './SourceLifecycle';
import '../styles/trash.css';

const when = (value: string | null) => { const time = value ? Date.parse(value) : 0; return time ? new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : ''; };

export default function Trash() {
  const trash = useQuery(trashQuery);
  const items = trash.data ?? [];
  return <main id="main" className="trash-page" tabIndex={-1}>
    <h1>Trash</h1>
    <p className="trash-intro">Sources here are out of the library, search and new chats. Restore brings back the saved copy with its analysis and notes.</p>
    {trash.isPending && <p aria-busy="true">Loading Trash…</p>}
    {trash.error && !trash.data && <p role="alert">{trash.error.message} <button type="button" className="trash-retry" onClick={() => void trash.refetch()}>Try again</button></p>}
    {trash.data && !items.length && <p className="trash-empty">Trash is empty.</p>}
    {!!items.length && <ul className="trash-list">{items.map(item => <TrashRow key={item.sourceId} item={item} />)}</ul>}
  </main>;
}

function TrashRow({ item }: { item: TrashItem }) {
  const change = useLifecycleChange();
  const { lifecycle, sourceId } = item;
  const title = item.title || item.entry?.note.source.title || 'Source';
  const purging = lifecycle.state === 'purging';
  const act = (action: 'restore' | 'purge' | 'retry') => change.mutate({ sourceId, action, revision: revisionOf(lifecycle), entry: item.entry });
  return <li className="trash-row" aria-busy={purging && !lifecycle.error || undefined}>
    <div className="trash-row-text">
      {purging ? <span className="trash-title">{title}</span> : <Link className="trash-title" to="/sources/" search={{ source: sourceId }}>{title}</Link>}
      <span className="trash-meta">{purging ? lifecycle.error ? 'Deletion stopped before cleanup finished' : 'Deleting permanently…' : `Moved to Trash${when(lifecycle.changedAt) ? ' ' + when(lifecycle.changedAt) : ''}`}</span>
      {purging && lifecycle.error && <span className="trash-row-error" role="alert">{lifecycle.error}</span>}
      {change.error && <span className="trash-row-error" role="alert">{change.error.message}</span>}
    </div>
    <div className="trash-actions">
      {lifecycle.state === 'trashed' && <>
        <button type="button" disabled={change.isPending} onClick={() => act('restore')}><RotateCcw size={16} aria-hidden="true" />Restore</button>
        <ConfirmDelete title={title} pending={change.isPending} onConfirm={() => act('purge')}>
          <button type="button" className="is-danger" disabled={change.isPending}><Trash2 size={16} aria-hidden="true" />Delete permanently</button>
        </ConfirmDelete>
      </>}
      {purging && lifecycle.error && <button type="button" disabled={change.isPending} onClick={() => act('retry')}>Retry cleanup</button>}
    </div>
  </li>;
}
