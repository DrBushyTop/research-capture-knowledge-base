import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useBlocker } from '@tanstack/react-router';
import type { ReaderNote } from '../../../../shared/reader-notes';
import { ApiError, postJson } from '../lib/api';
import { keys, notesQuery } from '../lib/queries';

const leaveMessage = 'Leave this source? Your unsaved note draft will stay in this browser.';

export default function ReaderNotes({ sourceId }: { sourceId: string }) {
  const queryClient = useQueryClient();
  const notes = useQuery(notesQuery(sourceId));
  const note = notes.data;
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const started = useRef(false);
  const key = `reader-note-draft:${sourceId}`;
  // The draft starts from the browser-saved copy once; later refetches update only the saved note shown beside it.
  useEffect(() => {
    if (!note || started.current) return;
    started.current = true;
    let saved: string | null = null;
    try { saved = localStorage.getItem(key); } catch { /* Storage can be disabled. */ }
    setDraft(saved ?? note.markdown);
    if (saved !== null && saved !== note.markdown) setEditing(true);
  }, [note]);
  const dirty = editing && !!note && draft !== note.markdown;
  useBlocker({
    disabled: !dirty,
    // Search and filter changes keep the same source open, so only leaving the source asks.
    shouldBlockFn: ({ current, next }) => (current.pathname !== next.pathname || (current.search as { source?: string }).source !== (next.search as { source?: string }).source) && !window.confirm(leaveMessage)
  });
  const change = (value: string) => {
    setDraft(value);
    try { localStorage.setItem(key, value); } catch { /* The in-memory draft remains. */ }
  };
  const save = useMutation({
    mutationFn: (body: { revision: number; markdown: string }) => postJson<ReaderNote>(`/api/chat?notes=${encodeURIComponent(sourceId)}`, { sourceId, ...body }, 'Notes could not be saved. Your draft is kept.'),
    onMutate: () => setError(''),
    onSuccess: saved => {
      queryClient.setQueryData(keys.notes(sourceId), saved);
      // Human notes are part of the reading view and the search corpus.
      void queryClient.invalidateQueries({ queryKey: keys.library });
      setEditing(false); setConflict(false);
      try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
    },
    onError: failure => { if (failure instanceof ApiError && failure.status === 409) setConflict(true); setError(failure.message); }
  });
  const latest = async () => {
    setError('');
    // Keep the draft, so the user can merge the latest text before saving.
    const result = await notes.refetch();
    if (result.error) setError(result.error.message); else setConflict(false);
  };
  const busy = save.isPending || (conflict && notes.isFetching);
  const loadError = notes.error && !note ? notes.error.message : '';
  return <div className="reader-notes">
    {(error || loadError) && <p role="alert">{error || loadError}</p>}
    {!note && !loadError && <p aria-busy="true">Loading notes…</p>}
    {note && <>
      {editing ? <>
        {conflict && <button type="button" disabled={busy} onClick={() => void latest()}>Load latest notes, keep my draft</button>}
        {draft !== note.markdown && note.markdown && <details><summary>Current saved notes</summary><p className="reader-note-text">{note.markdown}</p></details>}
        <label htmlFor="reader-note-draft">Your notes</label>
        <textarea id="reader-note-draft" value={draft} maxLength={20000} disabled={busy} onChange={event => change(event.target.value)} rows={7} />
        <div className="reader-note-actions">
          <button type="button" disabled={busy || conflict || draft === note.markdown} onClick={() => save.mutate({ revision: note.revision, markdown: draft })}>{save.isPending ? 'Saving…' : 'Save notes'}</button>
          <button type="button" disabled={busy} onClick={() => {
            if (dirty && !window.confirm('Discard your unsaved changes?')) return;
            setDraft(note.markdown); setEditing(false); setError(''); setConflict(false);
            try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
          }}>Cancel</button>
        </div>
        <p className="note-help">Shared with the other reader. Reprocessing keeps these notes.</p>
      </> : <>
        {note.markdown ? <p className="reader-note-text human-prose">{note.markdown}</p> : <p>No reader notes yet.</p>}
        <button type="button" onClick={() => { setDraft(note.markdown); setEditing(true); }}>{note.markdown ? 'Edit notes' : 'Add notes'}</button>
        {note.updatedAt && <p className="note-help" role="status">Saved {new Date(note.updatedAt).toLocaleString()}</p>}
      </>}
    </>}
  </div>;
}
