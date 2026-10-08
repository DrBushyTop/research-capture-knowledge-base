import { useEffect, useMemo, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { ArrowRight, ChevronDown, ExternalLink, ListTree, MessageSquareText, SlidersHorizontal, X } from 'lucide-react';
import type { Note } from '../../../../shared/corpus';
import { categoryTone, sourceTypeLabel } from '../lib/labels';
import { usePhone } from '../lib/usePhone';
import SourceAsk from './SourceAsk';
import ReaderNotes from './ReaderNotes';
import OriginalText from './OriginalText';
import { buildSearchIndex, searchIds } from '../../../../shared/search';
import { libraryQuery, type LibraryEntry } from '../lib/queries';
import { sourcesRoute, type SourcesSearch } from '../app/router';

type Entry = LibraryEntry;
type Section = { id: string; heading: string; format: 'text' | 'bullets' | 'steps'; text: string | null; items: string[] };
type FilterKey = 'category' | 'topic' | 'type' | 'year';
const filterKeys: FilterKey[] = ['category', 'topic', 'type', 'year'];
const filterLabels: Record<FilterKey, string> = { category: 'Category', topic: 'Topic', type: 'Type', year: 'Year' };
const noEntries: Entry[] = [];
const year = (value: string | null) => value?.match(/\b(?:19|20)\d{2}\b/)?.[0] || 'Unknown';
const knownYear = (value: string | null) => value?.match(/\b(?:19|20)\d{2}\b/)?.[0];
const category = (note: Note) => note.schemaVersion === 2 ? note.category : null;
const needsReview = (note: Note) => note.extraction.status !== 'text';
const savedTime = (note: Note) => Date.parse(note.source.capturedAt) || 0;
const shortDate = (time: number) => new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(new Date(time).getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
const longDate = (value: string) => { const time = Date.parse(value); return time ? new Date(time).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Unknown'; };
/** Saves from the last week stay together; older saves group by month. */
function savedGroup(time: number, now: number) {
  if (!time) return 'Date unknown';
  if (now - time < 7 * 864e5) return 'Last 7 days';
  const date = new Date(time);
  return date.toLocaleDateString('en-GB', { month: 'long', ...(date.getFullYear() === new Date(now).getFullYear() ? {} : { year: 'numeric' }) });
}
function sections(note: Note): Section[] {
  const a = note.analysis;
  if (!a) return [];
  if ('sections' in a) return a.sections;
  return [
    { id: 'findings', heading: 'Key findings', items: a.keyFindings },
    { id: 'methods', heading: 'Study details', items: [a.studyType && `Study type: ${a.studyType}`, a.population && `Population: ${a.population}`,
      a.participantCount !== null && `Participants: ${a.participantCount}`, a.intervention && `Intervention: ${a.intervention}`, a.comparator && `Comparator: ${a.comparator}`].filter((value): value is string => typeof value === 'string' && Boolean(value)) },
    { id: 'outcomes', heading: 'Reported outcomes', items: a.outcomes },
    { id: 'claims', heading: 'Claims and their evidence', items: a.claims.map(c => `${c.text}\nEvidence: ${c.evidence}`) },
    { id: 'relevance', heading: 'Why this is relevant', items: a.relevance },
    { id: 'limitations', heading: 'Limitations', items: a.limitations },
    { id: 'funding', heading: 'Funding', items: a.funding ? [a.funding] : [] }
  ].filter(s => s.items.length).map(s => ({ ...s, format: 'bullets', text: null }));
}

export default function Sources() {
  const search = sourcesRoute.useSearch();
  const navigate = useNavigate({ from: '/sources' });
  const phone = usePhone();
  const library = useQuery(libraryQuery);
  const entries = library.data ?? noEntries;
  const selected = search.source || '';
  // The field keeps its own value so typing never waits for the router; the URL follows it.
  const [query, setQuery] = useState(search.q || '');
  useEffect(() => { if (document.activeElement?.id !== 'search') setQuery(search.q || ''); }, [search.q]);
  const filters: Record<FilterKey, string> = { category: search.category || '', topic: search.topic || '', type: search.type || '', year: search.year || '' };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const loading = library.isPending;
  const error = library.error ? (library.error as Error).message : '';
  // Typing and filters replace the entry, so Back leaves the list rather than undoing keystrokes.
  const setSearch = (change: Partial<SourcesSearch>) => void navigate({ search: previous => ({ ...previous, ...change }), replace: true });
  useEffect(() => {
    document.querySelector('.reading-pane')?.scrollTo(0, 0);
    // Phones scroll the whole page while reading.
    if (selected && window.matchMedia('(max-width: 720px)').matches) window.scrollTo(0, 0);
  }, [selected]);
  const index = useMemo(() => buildSearchIndex(entries.map(({ note, searchText }) => ({
    id: note.source.id, title: note.source.title, authors: note.source.authors.join(' '),
    body: `${JSON.stringify(note.analysis)}\n${searchText}`, topics: (note.analysis?.topics || note.source.tags).join('\n'),
    category: category(note)?.id || '', type: note.source.itemType, year: year(note.source.publishedAt)
  }))), [entries]);
  const searching = !!query.trim();
  const visible = useMemo(() => {
    const ids = searchIds(index, query, filters);
    const matched = new Set(ids);
    // Search results keep their relevance order; browsing shows the newest saves first.
    return searching ? ids.map(id => entries.find(entry => entry.note.source.id === id)!).filter(Boolean)
      : entries.filter(entry => matched.has(entry.note.source.id)).sort((a, b) => savedTime(b.note) - savedTime(a.note));
  }, [entries, query, filters.category, filters.topic, filters.type, filters.year, index]);
  const groups = useMemo(() => {
    if (searching) return [{ label: '', entries: visible }];
    const now = Date.now(), result: { label: string; entries: Entry[] }[] = [];
    for (const entry of visible) {
      const label = savedGroup(savedTime(entry.note), now);
      if (result.at(-1)?.label === label) result.at(-1)!.entries.push(entry); else result.push({ label, entries: [entry] });
    }
    return result;
  }, [visible, searching]);
  const position = visible.findIndex(entry => entry.note.source.id === selected);
  const current = entries.find(e => e.note.source.id === selected);
  const next = position >= 0 ? visible[position + 1] : undefined;
  const options: Record<FilterKey, (readonly [string, string])[]> = {
    category: [...new Map(entries.flatMap(({ note }) => { const c = category(note); return c ? [[c.id, c.name] as const] : []; })).entries()],
    topic: [...new Set(entries.flatMap(({ note }) => note.analysis?.topics || note.source.tags))].sort().map(v => [v, v] as const),
    type: [...new Set(entries.map(({ note }) => note.source.itemType))].sort().map(v => [v, sourceTypeLabel(v)] as const),
    year: [...new Set(entries.map(({ note }) => year(note.source.publishedAt)))].sort().reverse().map(v => [v, v] as const)
  };
  const active = filterKeys.filter(key => filters[key]);
  const narrowed = searching || active.length > 0;
  const clearFilters = () => setSearch(Object.fromEntries(filterKeys.map(key => [key, undefined])));
  const fields = <div className="filters" id="filters">
    {filterKeys.map(key => <div key={key}>
      <label htmlFor={key}>{filterLabels[key]}</label>
      <select id={key} value={filters[key]} onChange={e => setSearch({ [key]: e.target.value || undefined })}>
        <option value="">All</option>{options[key].map(([v, label]) => <option value={v} key={v}>{label}</option>)}
      </select></div>)}
  </div>;
  return <div className={`sources-shell ${selected ? 'is-reading' : 'is-index'}`}>
    <aside className="source-list" aria-label="Saved sources">
      <div className="source-list-head"><h1 className="source-list-title">Sources</h1>
        <div className="source-search"><label className="visually-hidden" htmlFor="search">Search sources</label>
          <input id="search" type="search" placeholder={entries.length ? `Search ${entries.length} sources` : 'Search sources'} value={query} onChange={e => { setQuery(e.target.value); setSearch({ q: e.target.value || undefined }); }} />
          <button className="filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls={phone ? undefined : 'filters'} onClick={() => setFiltersOpen(!filtersOpen)}>
            <SlidersHorizontal size={16} aria-hidden="true" />Filters{active.length > 0 && <span id="filter-count"><span className="visually-hidden">, </span>{active.length}<span className="visually-hidden"> active</span></span>}
          </button>
        </div>
        {filtersOpen && !phone && fields}
        {active.length > 0 && <ul className="active-filters" aria-label="Active filters">{active.map(key => {
          const value = options[key].find(([v]) => v === filters[key])?.[1] || filters[key];
          return <li key={key}><button type="button" aria-label={`Remove ${filterLabels[key].toLowerCase()} filter: ${value}`} onClick={() => setSearch({ [key]: undefined })}>{value}<X size={14} aria-hidden="true" /></button></li>;
        })}</ul>}
        <p id="search-status" role="status" className={loading || narrowed ? undefined : 'visually-hidden'}>{loading ? 'Loading sources…' : narrowed ? `${visible.length} of ${entries.length} sources` : `${entries.length} sources`}</p>
        {error && <p role="alert">{error}</p>}
      </div>
      <div className="source-rows" id="results">{groups.map(group => <section key={group.label || 'results'} aria-label={group.label || 'Search results'}>
        {group.label && <h2 className="source-group">{group.label}</h2>}
        <ul>{group.entries.map(({ note }) => {
          const c = category(note), review = needsReview(note);
          const summary = note.analysis?.summary || (review ? '' : note.extraction.reason || 'Analysis unavailable.');
          return <li key={note.source.id}><Link to="/sources/" search={previous => ({ ...previous, source: note.source.id })} aria-current={selected === note.source.id ? 'page' : undefined}
            data-tone={categoryTone(c?.id)}>
            <span className="source-meta">{c && <span className="category-chip">{c.name}</span>}
              <span>{[sourceTypeLabel(note.source.itemType), knownYear(note.source.publishedAt)].filter(Boolean).join(' · ')}</span>
              {review && <span className="source-review">Needs review</span>}
              {savedTime(note) > 0 && <time dateTime={note.source.capturedAt}><span className="visually-hidden">Saved </span>{shortDate(savedTime(note))}</time>}
            </span>
            <span className="source-title">{note.source.title}</span>
            {summary && <span className="source-summary">{summary}</span>}
          </Link></li>;
        })}</ul>
      </section>)}</div>
    </aside>
    {current ? <Reading key={`reading:${current.note.source.id}`} entry={current} next={next} /> : <main id="main" className="reading-pane reading-empty">
      <p>{selected && !loading ? 'This source is unavailable. Select another source.' : 'Select a source to read it here.'}</p>
    </main>}
    {current && <SourceAsk key={`ask:${current.note.source.id}`} sourceId={current.note.source.id} title={current.note.source.title} />}
    <Dialog.Root open={filtersOpen && phone} onOpenChange={setFiltersOpen}><Dialog.Portal>
      <Dialog.Overlay className="sheet-overlay" />
      <Dialog.Content className="filter-sheet" aria-describedby={undefined}>
        <Dialog.Title className="filter-sheet-title">Filters</Dialog.Title>
        <Dialog.Close className="filter-sheet-close" aria-label="Close filters"><X size={20} /></Dialog.Close>
        {fields}
        <div className="filter-sheet-actions">
          <button type="button" disabled={!active.length} onClick={clearFilters}>Clear all</button>
          <Dialog.Close className="filter-sheet-done">Show {visible.length} {visible.length === 1 ? 'source' : 'sources'}</Dialog.Close>
        </div>
      </Dialog.Content>
    </Dialog.Portal></Dialog.Root>
  </div>;
}

function Topics({ topics }: { topics: string[] }) {
  const [all, setAll] = useState(false);
  if (!topics.length) return null;
  const hidden = topics.length - 3;
  return <p className="topic-list"><span className="visually-hidden">Topics: </span>{(all ? topics : topics.slice(0, 3)).join(' / ')}
    {hidden > 0 && <> <button type="button" className="topic-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : `+${hidden} more`}</button></>}
  </p>;
}

/** The section currently under the sticky section bar. Captures scrolling of the reading pane and the phone page. */
function useCurrentSection(ids: string[]) {
  const [current, setCurrent] = useState(ids[0]);
  useEffect(() => {
    let frame = 0;
    const update = () => {
      frame = 0;
      const bar = document.querySelector('.note-sections')?.getBoundingClientRect().bottom ?? 0;
      let found = ids[0];
      for (const id of ids) { const top = document.getElementById(id)?.getBoundingClientRect().top; if (top !== undefined && top - bar < 48) found = id; }
      // At the end of the note the last sections never reach the bar; pick the last one in view.
      const pane = document.querySelector('.reading-pane');
      const atEnd = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4 && (!pane || pane.scrollHeight <= pane.clientHeight || pane.scrollTop + pane.clientHeight >= pane.scrollHeight - 4);
      if (atEnd && window.scrollY + (pane?.scrollTop || 0) > 0) for (const id of ids) { const top = document.getElementById(id)?.getBoundingClientRect().top; if (top !== undefined && top < window.innerHeight - 80) found = id; }
      setCurrent(found);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    document.addEventListener('scroll', schedule, { capture: true, passive: true });
    update();
    return () => { cancelAnimationFrame(frame); document.removeEventListener('scroll', schedule, { capture: true }); };
  }, [ids.join('\n')]);
  return [current, setCurrent] as const;
}

/** The phone Ask button shrinks to its icon while the reader scrolls down and returns on the way back up. */
function useScrollingDown() {
  const [down, setDown] = useState(false);
  useEffect(() => {
    let last = window.scrollY;
    const scroll = () => {
      const y = window.scrollY;
      if (Math.abs(y - last) < 12) return;
      setDown(y > last && y > 160); last = y;
    };
    window.addEventListener('scroll', scroll, { passive: true });
    return () => window.removeEventListener('scroll', scroll);
  }, []);
  return down;
}

function Reading({ entry: { note, humanHtml }, next }: { entry: Entry; next?: Entry }) {
  const { source, analysis } = note, c = category(note), content = sections(note);
  const captureLabel = note.extraction.truncated ? 'Partial capture' : note.extraction.status === 'metadata-only' ? 'Source text unavailable' : note.extraction.status === 'image' ? 'Image-based analysis' : 'Capture details';
  const outline = [{ id: 'analysis', label: 'Summary' }, ...content.map(s => ({ id: `section-${s.id}`, label: s.heading })),
    { id: 'human', label: 'Notes' }, { id: 'original', label: 'Original text' }, { id: 'source', label: 'Details' }];
  const [section, setSection] = useCurrentSection(outline.map(item => item.id));
  const tabs = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = tabs.current, link = nav?.querySelector<HTMLElement>('[aria-current]');
    if (!nav || !link) return;
    if (link.offsetLeft < nav.scrollLeft || link.offsetLeft + link.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollLeft = link.offsetLeft - 24;
  }, [section]);
  const compactAsk = useScrollingDown();
  return <main id="main" className="reading-pane" data-tone={categoryTone(c?.id)}>
    <article className="research-note"><nav className="reading-back" aria-label="Breadcrumb"><Link to="/sources/" search={previous => ({ ...previous, source: undefined })}>Sources</Link></nav>
      <header className="note-head">
        <p className="note-kind">{c && <span className="category-chip">{c.name}</span>}
          <span>{sourceTypeLabel(source.itemType)}</span>{source.publishedAt && <span>{source.publishedAt.slice(0, 10)}</span>}</p>
        <h1>{source.title}</h1><p className="citation">{source.authors.join(', ') || 'Authors not provided'}</p>
        <div className="note-actions"><button className="ask-button" type="button" data-ask-open aria-controls="source-ask" aria-expanded="false">Ask about this source</button>
          {source.url && <a href={source.url} target="_blank" rel="noreferrer">Original<ExternalLink size={14} aria-hidden="true" /></a>}
          {source.doi && <a href={`https://doi.org/${encodeURIComponent(source.doi)}`} target="_blank" rel="noreferrer">DOI<ExternalLink size={14} aria-hidden="true" /></a>}
        </div>
      </header>
      <div className="note-sections">
        <nav ref={tabs} className="note-tabs" aria-label="Note sections">{outline.map(item => <a key={item.id} href={`#${item.id}`} aria-current={section === item.id ? 'true' : undefined}>{item.label}</a>)}</nav>
        <div className="note-jump"><ListTree size={18} aria-hidden="true" /><label className="visually-hidden" htmlFor="note-jump">Jump to section</label>
          <select id="note-jump" value={section} onChange={event => { setSection(event.target.value); document.getElementById(event.target.value)?.scrollIntoView(); }}>
            {outline.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select><ChevronDown size={18} aria-hidden="true" /></div>
      </div>
      <section id="analysis" className="summary-section">{note.extraction.reason && <a className="capture-status" href="#capture-details">{captureLabel}</a>}<h2>Summary <span className="origin-tag">Generated</span></h2><p>{analysis?.summary || 'Analysis unavailable.'}</p>
        <Topics topics={analysis?.topics || source.tags} /></section>
      {content.map(s => <section className="analysis-section" id={`section-${s.id}`} key={s.id}><h2>{s.heading}</h2>
        {s.format === 'text' ? <p>{s.text}</p> : s.format === 'steps' ? <ol>{s.items.map((item, i) => <li key={i}>{item}</li>)}</ol> : <ul>{s.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}</section>)}
      <section id="human" className="human-section"><h2>Notes <span className="origin-tag is-human">Human</span></h2>
        {humanHtml && <div className="human-prose" dangerouslySetInnerHTML={{ __html: humanHtml }} />}<ReaderNotes sourceId={source.id} /></section>
      <section id="original" className="original-section"><h2>Original text <span className="origin-tag is-source">Source</span></h2><OriginalText key={note.generationId} sourceId={source.id} artifactMime={note.extraction.artifactMime} artifacts={note.extraction.artifacts} sourceUrl={source.url} /></section>
      <section id="source" className="details-section"><h2>Details</h2><dl className="facts">
        <div><dt>Captured</dt><dd>{longDate(source.capturedAt)}</dd></div><div><dt>Source type</dt><dd>{sourceTypeLabel(source.itemType)}</dd></div>
        <div><dt>Text</dt><dd>{note.extraction.method}</dd></div><div><dt>Analysis prepared</dt><dd>{longDate(note.processing.processedAt)}</dd></div>
        <div><dt>Category</dt><dd>{c ? `${c.name}, template ${c.templateRevision} · ${c.assignment}` : 'Not set'}{' '}
          <Link className="category-change" to="/categories/" search={{ source: source.id }}>{c ? 'Change category' : 'Set category'}</Link></dd></div>
      </dl>{note.extraction.reason && <details id="capture-details" className="capture-details"><summary>{captureLabel}</summary><p>{note.extraction.reason}</p></details>}</section>
      {next && <Link className="next-source" to="/sources/" search={previous => ({ ...previous, source: next.note.source.id })}>
        <span>Next source</span><strong>{next.note.source.title}</strong><ArrowRight size={20} aria-hidden="true" />
      </Link>}
    </article>
    <div className="ask-fab-wrap"><button className="ask-fab" type="button" data-ask-open data-compact={compactAsk || undefined} aria-controls="source-ask" aria-expanded="false" aria-label="Ask about this source">
      <MessageSquareText size={20} aria-hidden="true" /><span>Ask</span>
    </button></div>
  </main>;
}
