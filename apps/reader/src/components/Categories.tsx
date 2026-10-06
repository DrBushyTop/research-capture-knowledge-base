import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Archive, ArchiveRestore, Copy, List, ListOrdered, Pilcrow, Plus, RefreshCw, RotateCcw, Square, Trash2, X } from 'lucide-react';
import type { Template, TemplateAnalysis } from '../../../../shared/categories';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useBlocker } from '@tanstack/react-router';
import { ApiError, forgetPrivateData, isAuthError, postJson } from '../lib/api';
import { activeBatchStates as active, categoriesQuery, keys, previewQuery, type CategorySource, type Overview } from '../lib/queries';
import { categoriesRoute } from '../app/router';
import '../styles/categories.css';

type Source = CategorySource;
type Section = Template['sections'][number];
type Tab = 'templates' | 'documents' | 'updates';
type Confirm = { mode: 'apply' | 'reclassify'; categoryId: string; requestId: string };

const endpoint = '/api/categories';
const maxSelected = 200;
const states: Record<string, string> = {
  pending: 'Queued', processing: 'Processing', 'updating-reader': 'Updating reader', complete: 'Done',
  failed: 'Failed', superseded: 'Replaced by newer update', cancelled: 'Stopped'
};
const formats: { value: Section['format']; label: string; icon: typeof List }[] = [
  { value: 'text', label: 'Paragraph', icon: Pilcrow },
  { value: 'bullets', label: 'Bullets', icon: List },
  { value: 'steps', label: 'Numbered steps', icon: ListOrdered }
];

const api = <T = any,>(body: unknown) => postJson<T>(endpoint, body);
const clone = <T,>(value: T): T => structuredClone(value);
const identifier = (prefix: string) => prefix + '-' + crypto.randomUUID().slice(0, 8);
const blankSection = (): Section => ({ id: identifier('section'), heading: '', instructions: '', format: 'bullets' });
const order = (status: string) => status === 'failed' ? 0 : active.includes(status) ? 1 : 2;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const categoryOf = (source: Source) => source.assignment?.categoryId || source.category?.id || '';
const dateTime = (value: string) => new Date(value).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function Categories() {
  const queryClient = useQueryClient();
  const linked = categoriesRoute.useSearch().source;
  const overview = useQuery(categoriesQuery);
  const data = overview.data;
  const [tab, setTab] = useState<Tab>('templates');
  const [draft, setDraft] = useState<Template>();
  const [baseline, setBaseline] = useState('');
  const [isNew, setIsNew] = useState(false);
  const [pendingSwitch, setPendingSwitch] = useState<() => void>();
  const [notice, setNotice] = useState<{ kind: 'error' | 'done' | 'conflict'; text: string }>();
  const loadError = overview.error && !data ? overview.error.message : '';
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [previewSource, setPreviewSource] = useState('');
  const [previewId, setPreviewId] = useState('');
  const [preview, setPreview] = useState<TemplateAnalysis>();
  const [previewError, setPreviewError] = useState('');
  const previewJob = useQuery({ ...previewQuery(previewId), enabled: !!previewId });
  const [selected, setSelected] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [query, setQuery] = useState('');
  const [confirm, setConfirm] = useState<Confirm>();
  const [focusSource, setFocusSource] = useState('');
  const [draftRevision, setDraftRevision] = useState(0);
  const tabs = useRef<Record<Tab, HTMLButtonElement | null>>({ templates: null, documents: null, updates: null });
  const dirty = !!draft && JSON.stringify(draft) !== baseline;

  function select(template: Template, fresh = false, revision = data?.registry.revision || 0) {
    setDraft(clone(template)); setDraftRevision(revision); setPreviewId(''); setBaseline(fresh ? '' : JSON.stringify(template)); setIsNew(fresh);
    setPreview(undefined); setPreviewError(''); setNotice(undefined);
  }
  // The categories, source views and saved analysis can all change after a category write.
  async function load() {
    void queryClient.invalidateQueries({ queryKey: keys.library });
    return queryClient.fetchQuery({ ...categoriesQuery, staleTime: 0 });
  }
  const started = useRef(false);
  useEffect(() => {
    if (!data || started.current) return;
    started.current = true;
    const match = linked ? data.sources.find(s => s.id === linked) : undefined;
    const current = data.registry.categories.find(c => c.id === (match && categoryOf(match))) || data.registry.categories[0];
    select(current, false, data.registry.revision);
    if (match) {
      setTab('documents'); setSelected([match.id]); setFocusSource(match.id); setPreviewSource(match.id);
      setConfirm({ mode: 'apply', requestId: crypto.randomUUID(), categoryId: data.registry.categories.find(c => !c.archived && c.id !== categoryOf(match))?.id || '' });
    } else setPreviewSource(data.sources[0]?.id || '');
  }, [data]);
  const running = !!data?.batches.some(b => b.entries.some(e => active.includes(e.status)));
  const wasRunning = useRef(running);
  useEffect(() => {
    // Finished documents have new analysis and possibly new text for the reader.
    if (wasRunning.current && !running) {
      void queryClient.invalidateQueries({ queryKey: keys.library });
      void queryClient.invalidateQueries({ queryKey: ['source-text'] });
    }
    wasRunning.current = running;
  }, [running]);
  useEffect(() => {
    const value = previewJob.data;
    if (!previewId || !value || value.status === 'pending') return;
    if (value.status === 'complete') setPreview(value.result); else setPreviewError(value.error || 'The preview failed. Try again.');
    setPreviewId('');
  }, [previewJob.data]);
  useEffect(() => {
    const failure = previewJob.error as ApiError | null;
    if (!previewId || !failure || failure.status === 503) return;
    setPreviewError(failure.message); setPreviewId('');
  }, [previewJob.error]);
  const blocker = useBlocker({ shouldBlockFn: () => true, disabled: !dirty, withResolver: true });
  useEffect(() => {
    if (!focusSource || tab !== 'documents') return;
    document.getElementById('doc-' + focusSource)?.scrollIntoView({ block: 'center' });
  }, [focusSource, tab]);

  async function run(action: () => Promise<void>) {
    setBusy(true); setNotice(undefined);
    try { await action(); }
    catch (e) {
      const error = e as ApiError;
      if (isAuthError(error)) { forgetPrivateData(queryClient); return; }
      setNotice(error.status === 409
        ? { kind: 'conflict', text: 'Someone else saved categories while you were editing. Your changes are still here. Reload the latest categories, check your changes, then save again.' }
        : { kind: 'error', text: error.message });
    } finally { setBusy(false); }
  }
  function guard(next: () => void) { if (dirty) setPendingSwitch(() => next); else next(); }
  function edit(next: Template) { setDraft(next); setPreview(undefined); setPreviewId(''); }
  function editSection(id: string, change: Partial<Section>) {
    if (draft) edit({ ...draft, sections: draft.sections.map(s => s.id === id ? { ...s, ...change } : s) });
  }
  function move(index: number, offset: number) {
    if (!draft) return;
    const sections = clone(draft.sections);
    [sections[index], sections[index + offset]] = [sections[index + offset], sections[index]];
    edit({ ...draft, sections });
    requestAnimationFrame(() => document.getElementById(`move-${sections[index + offset].id}-${offset < 0 ? 'up' : 'down'}`)?.focus());
  }
  function create(duplicate = false) {
    guard(() => {
      const base = duplicate && draft ? clone(draft) : undefined;
      select(base ? { ...base, id: identifier('category'), name: base.name + ' (copy)', revision: 1, archived: false, sections: base.sections.map(s => ({ ...s, id: identifier('section') })) }
        : { id: identifier('category'), name: '', description: '', revision: 1, archived: false, sections: [blankSection()] }, true);
      setTab('templates');
      requestAnimationFrame(() => document.getElementById('template-name')?.focus());
    });
  }
  async function reloadKeepingDraft() {
    await run(async () => {
      const value = await load();
      const saved = draft && value?.registry.categories.find(c => c.id === draft.id);
      if (saved) { setBaseline(JSON.stringify(saved)); setDraft({ ...draft!, revision: saved.revision }); }
      if (value) setDraftRevision(value.registry.revision);
      setNotice({ kind: 'done', text: 'Latest categories loaded. Your unsaved changes are kept. Save when ready.' });
    });
  }
  function save() {
    if (!data || !draft) return;
    setSaving(true);
    run(async () => {
      const result = await api({ action: 'save', registryRevision: draftRevision, template: draft });
      const saved: Template = result.registry.categories.find((c: Template) => c.id === draft.id);
      queryClient.setQueryData<Overview>(keys.categories, previous => previous && { ...previous, registry: result.registry }); select(saved, false, result.registry.revision);
      const count = data.sources.filter(s => categoryOf(s) === saved.id).length;
      setNotice({ kind: 'done', text: `Saved. New captures in ${saved.name} use this template.${count ? ` ${plural(count, 'existing document')} keep their current analysis until you update them in Documents.` : ''}` });
      await load();
    }).finally(() => setSaving(false));
  }
  function startPreview() {
    if (!draft) return;
    run(async () => {
      setPreview(undefined); setPreviewError('');
      const result = await api({ action: 'preview', sourceId: previewSource, template: draft });
      setPreviewId(result.id);
    });
  }
  function startUpdate() {
    if (!data || !confirm) return;
    run(async () => {
      await api({ action: 'update', batch: { requestId: confirm.requestId, registryRevision: data.registry.revision, mode: confirm.mode, ...(confirm.mode === 'apply' && confirm.categoryId ? { categoryId: confirm.categoryId } : {}), sourceIds: selected } });
      setConfirm(undefined); setSelected([]); setFocusSource('');
      await load(); setTab('updates');
      setNotice({ kind: 'done', text: `Update started for ${plural(selected.length, 'document')}. Existing notes stay readable until each one finishes.` });
    });
  }
  function batchAction(action: 'cancel' | 'retry', id: string, sourceId?: string) {
    run(async () => { await api({ action, id, ...(sourceId ? { sourceId } : {}) }); await load(); });
  }
  function tabKey(event: KeyboardEvent<HTMLButtonElement>, current: Tab) {
    const order: Tab[] = ['templates', 'documents', 'updates'];
    const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (!offset) return;
    event.preventDefault();
    const next = order[(order.indexOf(current) + offset + order.length) % order.length];
    setTab(next); tabs.current[next]?.focus();
  }

  const categories = data?.registry.categories || [];
  const counts = useMemo(() => {
    const result: Record<string, number> = {};
    for (const source of data?.sources || []) { const id = categoryOf(source); result[id] = (result[id] || 0) + 1; }
    return result;
  }, [data]);
  const shown = (data?.sources || []).filter(s =>
    (!filter || (filter === 'outdated' ? s.needsUpdate : filter === 'none' ? !categoryOf(s) : categoryOf(s) === filter))
    && (!query || s.title.toLowerCase().includes(query.toLowerCase())));
  const ready = !!draft?.name.trim() && !!draft.description.trim() && draft.sections.every(s => s.heading.trim() && s.instructions.trim());
  const uncategorised = selected.filter(id => { const s = data?.sources.find(x => x.id === id); return !s || !categoryOf(s); }).length;
  const activeBatches = data?.batches.filter(b => b.entries.some(e => active.includes(e.status))).length || 0;
  const outdated = data?.sources.filter(s => s.needsUpdate).length || 0;
  const nameOf = (id: string) => categories.find(c => c.id === id)?.name || 'Not categorised';

  if (!data) return <main id="main" className="cat-page">
    <h1 className="cat-title">Categories</h1>
    {loadError ? <div className="cat-notice error" role="alert"><p>{loadError}</p><button className="cat-button" onClick={() => void overview.refetch()}><RefreshCw size={18} aria-hidden />Try again</button></div>
      : <div className="cat-skeleton" role="status" aria-label="Loading categories"><span /><span /><span /></div>}
  </main>;

  const tabButton = (id: Tab, label: string, badge?: ReactNode) => <button ref={el => { tabs.current[id] = el; }} role="tab" id={`tab-${id}`} aria-controls={`panel-${id}`}
    aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} onKeyDown={e => tabKey(e, id)} onClick={() => setTab(id)}>{label}{badge}</button>;

  return <main id="main" className="cat-page">
    <header className="cat-header">
      <h1 className="cat-title">Categories</h1>
      <div className="cat-tabs" role="tablist" aria-label="Category settings">
        {tabButton('templates', 'Templates')}
        {tabButton('documents', 'Documents', outdated ? <span className="cat-badge" aria-label={`${outdated} need updates`}>{outdated}</span> : null)}
        {tabButton('updates', 'Updates', activeBatches ? <span className="cat-badge live" aria-label={`${activeBatches} running`}>{activeBatches}</span> : null)}
      </div>
    </header>

    {notice && <div className={`cat-notice ${notice.kind}`} role={notice.kind === 'done' ? 'status' : 'alert'}>
      <p>{notice.text}</p>
      {notice.kind === 'conflict' && <button className="cat-button" disabled={busy} onClick={reloadKeepingDraft}><RefreshCw size={18} aria-hidden />Reload latest categories</button>}
      <button className="cat-icon" aria-label="Dismiss message" onClick={() => setNotice(undefined)}><X size={18} aria-hidden /></button>
    </div>}

    {blocker.status === 'blocked' && <div className="cat-notice conflict" role="alertdialog" aria-label="Unsaved changes">
      <p>You have unsaved changes to {draft?.name || 'this new category'}. Leave and discard them?</p>
      <div className="cat-row"><button className="cat-button danger" autoFocus onClick={() => blocker.proceed()}>Discard changes</button>
        <button className="cat-button" onClick={() => { blocker.reset(); document.getElementById('template-name')?.focus(); }}>Keep editing</button></div>
    </div>}

    {pendingSwitch && <div className="cat-notice conflict" role="alertdialog" aria-label="Unsaved changes">
      <p>You have unsaved changes to {draft?.name || 'this new category'}. Discard them?</p>
      <div className="cat-row"><button className="cat-button danger" autoFocus onClick={() => { const next = pendingSwitch; setPendingSwitch(undefined); setBaseline(JSON.stringify(draft)); next(); }}>Discard changes</button>
        <button className="cat-button" onClick={() => { setPendingSwitch(undefined); document.getElementById('template-name')?.focus(); }}>Keep editing</button></div>
    </div>}

    <section id="panel-templates" role="tabpanel" aria-labelledby="tab-templates" hidden={tab !== 'templates'} className="cat-templates">
      <nav className="cat-rail" aria-label="Category list">
        <ul>{categories.map(c => <li key={c.id}><button aria-current={draft?.id === c.id ? 'true' : undefined} className={c.archived ? 'archived' : undefined} disabled={saving} onClick={() => draft?.id !== c.id && guard(() => select(c))}>
          <span>{c.name}</span><small>{c.archived ? 'Archived' : plural(counts[c.id] || 0, 'doc')}</small></button></li>)}
          {isNew && <li><button aria-current="true"><span>{draft?.name || 'New category'}</span><small>Not saved</small></button></li>}
        </ul>
        <button className="cat-button" onClick={() => create()} disabled={categories.length >= 40}><Plus size={18} aria-hidden />New category</button>
      </nav>
      <label className="cat-picker"><span>Category</span>
        <select value={isNew ? '' : draft?.id} onChange={e => { const c = categories.find(x => x.id === e.target.value); if (c) guard(() => select(c)); }}>
          {isNew && <option value="">{draft?.name || 'New category'} (not saved)</option>}
          {categories.map(c => <option key={c.id} value={c.id}>{c.name}{c.archived ? ' (archived)' : ''}</option>)}
        </select>
        <button className="cat-button" onClick={() => create()} disabled={categories.length >= 40}><Plus size={18} aria-hidden />New</button>
      </label>

      {draft && <form className="cat-editor" aria-busy={saving} onSubmit={e => { e.preventDefault(); save(); }}><fieldset className="cat-editor-fields" disabled={saving}>
        <div className="cat-editor-head">
          <label className="cat-name"><span>Category name</span>
            <input id="template-name" maxLength={80} required value={draft.name} placeholder="For example: Recipe" onChange={e => edit({ ...draft, name: e.target.value })} /></label>
          {!isNew && <button type="button" className="cat-button quiet" onClick={() => create(true)}><Copy size={18} aria-hidden />Duplicate</button>}
        </div>
        {draft.archived && <p className="cat-archived-note">Archived. New captures are never sorted into this category. Documents already in it keep their analysis.</p>}
        <label className="cat-field"><span>When to use this category</span>
          <small id="desc-help">Describe which saved items belong here. The model reads this when it sorts new captures.</small>
          <textarea aria-describedby="desc-help" required maxLength={1200} rows={3} value={draft.description} placeholder="For example: Recipes with ingredients and steps for cooking or baking." onChange={e => edit({ ...draft, description: e.target.value })} /></label>

        <div className="cat-sections-head"><h2>Analysis sections</h2><p>Each saved document in this category gets these sections, in this order, after its summary.</p></div>
        <ol className="cat-sections">{draft.sections.map((section, index) => <li key={section.id}>
          <div className="cat-section-top">
            <span className="cat-step" aria-hidden>{index + 1}</span>
            <label className="cat-field grow"><span>Heading</span>
              <input required maxLength={100} value={section.heading} placeholder="For example: Ingredients" onChange={e => editSection(section.id, { heading: e.target.value })} /></label>
            <div className="cat-section-tools">
              <button type="button" id={`move-${section.id}-up`} className="cat-icon" aria-label={`Move ${section.heading || 'section ' + (index + 1)} up`} disabled={index === 0} onClick={() => move(index, -1)}><ArrowUp size={18} aria-hidden /></button>
              <button type="button" id={`move-${section.id}-down`} className="cat-icon" aria-label={`Move ${section.heading || 'section ' + (index + 1)} down`} disabled={index === draft.sections.length - 1} onClick={() => move(index, 1)}><ArrowDown size={18} aria-hidden /></button>
              <button type="button" className="cat-icon danger" aria-label={`Remove ${section.heading || 'section ' + (index + 1)}`} disabled={draft.sections.length === 1} onClick={() => edit({ ...draft, sections: draft.sections.filter(s => s.id !== section.id) })}><Trash2 size={18} aria-hidden /></button>
            </div>
          </div>
          <fieldset className="cat-format"><legend>Show as</legend>
            {formats.map(f => <label key={f.value}><input type="radio" name={`format-${section.id}`} value={f.value} checked={section.format === f.value} onChange={() => editSection(section.id, { format: f.value })} /><f.icon size={17} aria-hidden /><span>{f.label}</span></label>)}
          </fieldset>
          <label className="cat-field"><span>What to include</span>
            <textarea required maxLength={2000} rows={2} value={section.instructions} placeholder="Tell the model what to write here, and what to leave out." onChange={e => editSection(section.id, { instructions: e.target.value })} /></label>
        </li>)}</ol>
        <button type="button" className="cat-button add" disabled={draft.sections.length >= 12} onClick={() => edit({ ...draft, sections: [...draft.sections, blankSection()] })}><Plus size={18} aria-hidden />Add section{draft.sections.length >= 12 ? ' (12 maximum)' : ''}</button>

        <section className="cat-preview" aria-labelledby="preview-title">
          <h2 id="preview-title">Try this template</h2>
          <p>Runs your unsaved template on one saved document so you can check the result. Nothing is saved. Each try uses a model call, up to 20 per hour. When a document has no saved text, sections stay empty rather than guessed.</p>
          <div className="cat-row wrap">
            <label className="cat-field grow"><span>Document</span>
              <select value={previewSource} onChange={e => { setPreviewSource(e.target.value); setPreview(undefined); setPreviewId(''); }}>
                <option value="">Choose a document</option>
                {data.sources.map(s => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select></label>
            <button type="button" className="cat-button" disabled={busy || !!previewId || !ready || !previewSource} onClick={startPreview}>{previewId ? 'Running…' : 'Run preview'}</button>
          </div>
          {!ready && <p className="cat-hint">Fill in the name, when to use, and every section first.</p>}
          {previewId && <div className="cat-skeleton" role="status" aria-label="Preview running"><span /><span /><span /></div>}
          {previewError && <p className="cat-inline-error" role="alert">{previewError}</p>}
          {preview && <article className="cat-preview-result" aria-label="Preview result">
            <p className="cat-preview-label">Preview only · not saved</p>
            <h3>Summary</h3><p>{preview.summary}</p>
            {preview.sections.map(s => <section key={s.id}><h3>{s.heading}</h3>
              {s.format === 'text' ? <p>{s.text || 'Nothing reported.'}</p>
                : !s.items.length ? <p>Nothing reported.</p>
                : s.format === 'steps' ? <ol>{s.items.map((v, i) => <li key={i}>{v}</li>)}</ol>
                : <ul>{s.items.map((v, i) => <li key={i}>{v}</li>)}</ul>}</section>)}
          </article>}
        </section>

        {!isNew && draft.id !== 'other' && <div className="cat-archive">
          <div><h2>{draft.archived ? 'Restore category' : 'Archive category'}</h2>
            <p>{draft.archived ? 'New captures can be sorted into this category again after you save.' : 'Stops sorting new captures into this category after you save. Nothing is deleted.'}</p></div>
          <button type="button" className="cat-button quiet" onClick={() => edit({ ...draft, archived: !draft.archived })}>{draft.archived ? <><ArchiveRestore size={18} aria-hidden />Restore</> : <><Archive size={18} aria-hidden />Archive</>}</button>
        </div>}

        </fieldset><div className={'cat-savebar' + (dirty ? ' dirty' : '')}>
          <p>{saving ? 'Saving…' : dirty ? (isNew ? 'New category, not saved' : 'Unsaved changes') : `Saved · version ${draft.revision}`}<small>Saving changes future captures only.</small></p>
          <div className="cat-row">
            {dirty && !isNew && <button type="button" className="cat-button quiet" onClick={() => select(categories.find(c => c.id === draft.id)!)}><RotateCcw size={18} aria-hidden />Discard</button>}
            {isNew && <button type="button" className="cat-button quiet" onClick={() => select(categories[0])}>Cancel</button>}
            <button type="submit" className="cat-button primary" disabled={busy || !dirty || !ready}>Save</button>
          </div>
        </div>
      </form>}
    </section>

    <section id="panel-documents" role="tabpanel" aria-labelledby="tab-documents" hidden={tab !== 'documents'} className="cat-documents">
      <p className="cat-lead">Choose documents to redo their analysis with the current templates, or to move them to another category. Human notes are never changed.</p>
      <div className="cat-doc-filters">
        <label className="cat-field grow"><span>Find</span><input type="search" value={query} placeholder="Title" onChange={e => setQuery(e.target.value)} /></label>
        <label className="cat-field"><span>Show</span>
          <select value={filter} onChange={e => setFilter(e.target.value)}>
            <option value="">All documents ({data.sources.length})</option>
            <option value="outdated">Older template ({outdated})</option>
            <option value="none">Not categorised ({counts[''] || 0})</option>
            {categories.map(c => <option key={c.id} value={c.id}>{c.name} ({counts[c.id] || 0})</option>)}
          </select></label>
      </div>
      <div className="cat-select-all">
        <label className="cat-check"><input type="checkbox" checked={!!shown.length && shown.every(s => selected.includes(s.id))} disabled={!shown.length}
          onChange={e => setSelected(e.target.checked ? [...new Set([...selected, ...shown.map(s => s.id)])] : selected.filter(id => !shown.some(s => s.id === id)))} />
          <span>Select all {shown.length} shown</span></label>
        {!!selected.length && <button className="cat-link" onClick={() => { setSelected([]); setConfirm(undefined); }}>Clear selection</button>}
      </div>
      {shown.length ? <ul className="cat-doc-list">{shown.map(s => {
        const busyState = s.status !== 'complete';
        return <li key={s.id} id={'doc-' + s.id} className={focusSource === s.id ? 'focus' : undefined}>
          <input type="checkbox" id={'pick-' + s.id} checked={selected.includes(s.id)} onChange={e => setSelected(e.target.checked ? [...selected, s.id] : selected.filter(id => id !== s.id))} />
          <div>
            <label htmlFor={'pick-' + s.id} className="cat-doc-title">{s.title}</label>
            <p className="cat-doc-meta">
              <span className={'cat-tag' + (categoryOf(s) ? '' : ' none')}>{nameOf(categoryOf(s))}</span>
              {s.assignment?.method === 'manual' && <span>Chosen by admin</span>}
              {s.needsUpdate && s.category && <span className="warn">Older template (version {s.category.templateRevision})</span>}
              {busyState && <span className={s.status === 'failed' ? 'bad' : 'live'}>{states[s.status]}</span>}
              <Link to="/sources/" search={{ source: s.id }}>Open</Link>
            </p>
          </div>
        </li>;
      })}</ul> : <p className="cat-empty">No documents match. Clear the search or choose another filter.</p>}

      {!!selected.length && <div className="cat-actionbar" role="region" aria-label="Selected documents">
        {confirm ? <div className="cat-confirm">
          {confirm.mode === 'apply' ? <>
            <h2>Update analysis for {plural(selected.length, 'document')}</h2>
            <fieldset className="cat-choice"><legend>Category</legend>
              <label><input type="radio" name="apply-category" checked={!confirm.categoryId} onChange={() => setConfirm({ ...confirm, categoryId: '' })} /><span>Keep each document's category</span></label>
              <label><input type="radio" name="apply-category" checked={!!confirm.categoryId} onChange={() => setConfirm({ ...confirm, categoryId: categories.find(c => !c.archived)!.id })} /><span>Move to</span>
                <select aria-label="New category" value={confirm.categoryId} onChange={e => setConfirm({ ...confirm, categoryId: e.target.value })}>
                  {!confirm.categoryId && <option value="">Choose…</option>}
                  {categories.filter(c => !c.archived).map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select></label>
            </fieldset>
            {!confirm.categoryId && uncategorised > 0 && <p className="cat-inline-error">{plural(uncategorised, 'selected document')} {uncategorised === 1 ? 'has' : 'have'} no category. Choose one to move them to, or use Check categories.</p>}
            <p className="cat-cost">Uses {plural(selected.length, 'model call')}. Old notes stay readable until each new analysis is ready.{confirm.categoryId ? ' Moved documents keep the chosen category when categories are checked later.' : ''}</p>
          </> : <>
            <h2>Check categories for {plural(selected.length, 'document')}</h2>
            <p className="cat-cost">The model sorts each document again, then redoes its analysis. Uses model calls for all {selected.length}. Documents with a category chosen by an admin keep it.</p>
          </>}
          <div className="cat-row">
            <button className="cat-button primary" disabled={busy || selected.length > maxSelected || (confirm.mode === 'apply' && !confirm.categoryId && uncategorised > 0)} onClick={startUpdate}>Start update</button>
            <button className="cat-button quiet" onClick={() => setConfirm(undefined)}>Back</button>
          </div>
        </div> : <>
          <p><strong>{selected.length}</strong> selected{selected.length > maxSelected ? <span className="bad"> · {maxSelected} maximum</span> : ''}</p>
          <div className="cat-row">
            <button className="cat-button primary" disabled={busy || selected.length > maxSelected} onClick={() => setConfirm({ mode: 'apply', categoryId: '', requestId: crypto.randomUUID() })}>Update analysis</button>
            <button className="cat-button" disabled={busy || selected.length > maxSelected} onClick={() => setConfirm({ mode: 'reclassify', categoryId: '', requestId: crypto.randomUUID() })}>Check categories</button>
          </div>
        </>}
      </div>}
    </section>

    <section id="panel-updates" role="tabpanel" aria-labelledby="tab-updates" hidden={tab !== 'updates'} className="cat-updates">
      <p className="cat-lead">Progress refreshes every few seconds while updates run. “Updating reader” means the analysis is ready and appears after the next reader build. Stopping affects queued documents. One already processing may still finish.</p>
      {!data.batches.length && <p className="cat-empty">No updates yet. Select documents in Documents to start one.</p>}
      {data.batches.map(batch => {
        const done = batch.entries.filter(e => ['complete', 'superseded', 'cancelled'].includes(e.status)).length;
        const failed = batch.entries.filter(e => e.status === 'failed').length;
        const pending = batch.entries.filter(e => e.status === 'pending').length;
        const live = batch.entries.some(e => active.includes(e.status));
        return <article key={batch.id} className="cat-batch">
          <header>
            <div><h2>{dateTime(batch.createdAt)} · {plural(batch.entries.length, 'document')}</h2>
              <p>{batch.cancelled ? 'Stopped' : live ? 'Running' : failed ? 'Finished with failures' : 'Finished'} · {done} done{failed ? ` · ${failed} failed` : ''}</p></div>
            {!batch.cancelled && pending > 0 && <button className="cat-button quiet" disabled={busy} onClick={() => batchAction('cancel', batch.id)}><Square size={16} aria-hidden />Stop {pending} queued</button>}
          </header>
          <div className="cat-progress" aria-hidden><span style={{ width: `${(done / batch.entries.length) * 100}%` }} /><span className="bad" style={{ width: `${(failed / batch.entries.length) * 100}%` }} /></div>
          <ul>{[...batch.entries].sort((a, b) => order(a.status) - order(b.status)).map(entry => <li key={entry.sourceId}>
            <Link to="/sources/" search={{ source: entry.sourceId }}>{data.sources.find(s => s.id === entry.sourceId)?.title || entry.sourceId}</Link>
            <span className={`cat-state ${entry.status}`}>{states[entry.status] || entry.status}</span>
            {entry.error && <p>{entry.error}</p>}
            {entry.status === 'failed' && !batch.cancelled && <button className="cat-button quiet small" disabled={busy} onClick={() => batchAction('retry', batch.id, entry.sourceId)}><RotateCcw size={16} aria-hidden />Retry</button>}
          </li>)}</ul>
        </article>;
      })}
    </section>
  </main>;
}
