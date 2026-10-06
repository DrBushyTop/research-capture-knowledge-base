import { useEffect, useRef, useState } from 'react';
import type { ReaderNote } from '../../../../shared/reader-notes';

export default function ReaderNotes({ sourceId }: { sourceId: string }) {
  const [note, setNote] = useState<ReaderNote>();
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const dirty = useRef(false);
  const key = `reader-note-draft:${sourceId}`;
  const endpoint = `/api/chat?notes=${encodeURIComponent(sourceId)}`;
  const read = async (response: Response): Promise<ReaderNote> => {
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('Notes could not load. Open the private reader and sign in.');
    const result = await response.json();
    if (!response.ok) {
      if (response.status === 409) setConflict(true);
      throw new Error(result.error || 'Notes could not be saved. Your draft is kept.');
    }
    return result;
  };
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal }).then(read).then(value => {
      setNote(value);
      let saved: string | null = null;
      try { saved = localStorage.getItem(key); } catch { /* Storage can be disabled. */ }
      setDraft(saved ?? value.markdown);
      if (saved !== null && saved !== value.markdown) setEditing(true);
    }).catch(error => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [sourceId]);
  dirty.current = editing && draft !== note?.markdown;
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (dirty.current) event.preventDefault(); };
    const beforeNavigate = (event: Event) => {
      if (dirty.current && !window.confirm('Leave this source? Your unsaved note draft will stay in this browser.')) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('astro:before-preparation', beforeNavigate);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('astro:before-preparation', beforeNavigate);
    };
  }, []);
  const change = (value: string) => {
    setDraft(value);
    try { localStorage.setItem(key, value); } catch { /* The in-memory draft remains. */ }
  };
  const save = async () => {
    if (!note) return;
    setBusy(true); setError('');
    try {
      const saved = await read(await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, revision: note.revision, markdown: draft }) }));
      setNote(saved); setEditing(false); setConflict(false);
      try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  const latest = async () => {
    setBusy(true); setError('');
    try {
      setNote(await read(await fetch(endpoint)));
      setConflict(false);
      // Keep the draft, so the user can merge the latest text before saving.
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  };
  return <div className="reader-notes">
    {error && <p role="alert">{error}</p>}
    {!note && !error && <p aria-busy="true">Loading notes…</p>}
    {note && <>
      {editing ? <>
        {conflict && <button type="button" disabled={busy} onClick={() => void latest()}>Load latest notes, keep my draft</button>}
        {draft !== note.markdown && note.markdown && <details><summary>Current saved notes</summary><p className="reader-note-text">{note.markdown}</p></details>}
        <label htmlFor="reader-note-draft">Your notes</label>
        <textarea id="reader-note-draft" value={draft} maxLength={20000} disabled={busy} onChange={event => change(event.target.value)} rows={7} />
        <div className="reader-note-actions">
          <button type="button" disabled={busy || conflict || draft === note.markdown} onClick={() => void save()}>{busy ? 'Saving…' : 'Save notes'}</button>
          <button type="button" disabled={busy} onClick={() => {
            if (dirty.current && !window.confirm('Discard your unsaved changes?')) return;
            setDraft(note.markdown); setEditing(false); setError(''); setConflict(false);
            try { localStorage.removeItem(key); } catch { /* Storage can be disabled. */ }
          }}>Cancel</button>
        </div>
        <p className="note-help">Shared with the other reader. Reprocessing keeps these notes.</p>
      </> : <>
        {note.markdown ? <p className="reader-note-text human-prose">{note.markdown}</p> : <p>No reader notes yet.</p>}
        <button type="button" onClick={() => setEditing(true)}>{note.markdown ? 'Edit notes' : 'Add notes'}</button>
        {note.updatedAt && <p className="note-help" role="status">Saved {new Date(note.updatedAt).toLocaleString()}</p>}
      </>}
    </>}
  </div>;
}
