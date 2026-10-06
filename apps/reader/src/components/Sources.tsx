import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import type { Note } from '../../../../shared/corpus';
import { categoryTone, sourceTypeLabel } from '../lib/labels';
import SourceAsk from './SourceAsk';
import ReaderNotes from './ReaderNotes';
import OriginalText from './OriginalText';
import { buildSearchIndex, searchIds } from '../../../../shared/search';
import { libraryQuery, type LibraryEntry } from '../lib/queries';
import { sourcesRoute, type SourcesSearch } from '../app/router';

type Entry = LibraryEntry;
type Section = { id: string; heading: string; format: 'text' | 'bullets' | 'steps'; text: string | null; items: string[] };
const noEntries: Entry[] = [];
const year = (value: string | null) => value?.match(/\b(?:19|20)\d{2}\b/)?.[0] || 'Unknown';
const category = (note: Note) => note.schemaVersion === 2 ? note.category : null;
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
  const library = useQuery(libraryQuery);
  const entries = library.data ?? noEntries;
  const selected = search.source || '';
  // The field keeps its own value so typing never waits for the router; the URL follows it.
  const [query, setQuery] = useState(search.q || '');
  useEffect(() => { if (document.activeElement?.id !== 'search') setQuery(search.q || ''); }, [search.q]);
  const filters = { category: search.category || '', topic: search.topic || '', type: search.type || '', year: search.year || '' };
  const [filtersOpen, setFiltersOpen] = useState(false);
  const loading = library.isPending;
  const error = library.error ? (library.error as Error).message : '';
  // Typing and filters replace the entry, so Back leaves the list rather than undoing keystrokes.
  const setSearch = (change: Partial<SourcesSearch>) => void navigate({ search: previous => ({ ...previous, ...change }), replace: true });
  useEffect(() => { document.querySelector('.reading-pane')?.scrollTo(0, 0); }, [selected]);
  const current = entries.find(e => e.note.source.id === selected);
  const index = useMemo(() => buildSearchIndex(entries.map(({ note, searchText }) => ({
    id: note.source.id, title: note.source.title, authors: note.source.authors.join(' '),
    body: `${JSON.stringify(note.analysis)}\n${searchText}`, topics: (note.analysis?.topics || note.source.tags).join('\n'),
    category: category(note)?.id || '', type: note.source.itemType, year: year(note.source.publishedAt)
  }))), [entries]);
  const visible = useMemo(() => {
    const ids = searchIds(index, query, filters);
    const matched = new Set(ids);
    return query.trim() ? ids.map(id => entries.find(entry => entry.note.source.id === id)!).filter(Boolean)
      : entries.filter(entry => matched.has(entry.note.source.id));
  }, [entries, query, filters.category, filters.topic, filters.type, filters.year, index]);
  const options = {
    category: [...new Map(entries.flatMap(({ note }) => { const c = category(note); return c ? [[c.id, c.name] as const] : []; })).entries()],
    topic: [...new Set(entries.flatMap(({ note }) => note.analysis?.topics || note.source.tags))].sort().map(v => [v, v]),
    type: [...new Set(entries.map(({ note }) => note.source.itemType))].sort().map(v => [v, sourceTypeLabel(v)]),
    year: [...new Set(entries.map(({ note }) => year(note.source.publishedAt)))].sort().reverse().map(v => [v, v])
  };
  return <div className={`sources-shell ${selected ? 'is-reading' : 'is-index'}`}>
    <aside className="source-list" aria-label="Saved sources">
      <div className="source-list-head"><h1 className="source-list-title">Sources</h1>
        <div className="source-search"><label className="visually-hidden" htmlFor="search">Search sources</label>
          <input id="search" type="search" placeholder="Search titles, findings, notes" value={query} onChange={e => { setQuery(e.target.value); setSearch({ q: e.target.value || undefined }); }} />
          <button className="filter-toggle" type="button" aria-expanded={filtersOpen} aria-controls="filters" onClick={() => setFiltersOpen(!filtersOpen)}>Filters</button>
        </div>
        <div className="filters" id="filters" data-open={filtersOpen ? '' : undefined}>
          {(Object.keys(filters) as (keyof typeof filters)[]).map(key => <div key={key}>
            <label htmlFor={key}>{key.charAt(0).toUpperCase() + key.slice(1)}</label>
            <select id={key} value={filters[key]} onChange={e => setSearch({ [key]: e.target.value || undefined })}>
              <option value="">All</option>{options[key].map(([v, label]) => <option value={v} key={v}>{label}</option>)}
            </select></div>)}
        </div>
        <p id="search-status" role="status">{loading ? 'Loading sources…' : `${visible.length} sources`}</p>
        {error && <p role="alert">{error}</p>}
      </div>
      <ul className="source-rows" id="results">{visible.map(({ note }) => {
        const c = category(note);
        return <li key={note.source.id}><Link to="/sources/" search={previous => ({ ...previous, source: note.source.id })} aria-current={selected === note.source.id ? 'page' : undefined}
          data-tone={categoryTone(c?.id)}>
          <span className="source-meta">{c && <span className="category-chip">{c.name}</span>}<span>{sourceTypeLabel(note.source.itemType)} · {year(note.source.publishedAt)}</span></span>
          <span className="source-title">{note.source.title}</span><span className="source-summary">{note.analysis?.summary || note.extraction.reason || 'Metadata saved; analysis unavailable.'}</span>
          {note.extraction.status !== 'text' && <span className="status attention">Needs review</span>}
        </Link></li>;
      })}</ul>
    </aside>
    {current ? <Reading key={`reading:${current.note.source.id}`} entry={current} /> : <main id="main" className="reading-pane reading-empty">
      <p>{selected && !loading ? 'This source is unavailable. Select another source.' : 'Select a source to read it here.'}</p>
    </main>}
    {current && <SourceAsk key={`ask:${current.note.source.id}`} sourceId={current.note.source.id} title={current.note.source.title} />}
  </div>;
}

function Reading({ entry: { note, humanHtml } }: { entry: Entry }) {
  const { source, analysis } = note, c = category(note), content = sections(note);
  const captureLabel = note.extraction.truncated ? 'Partial capture' : note.extraction.status === 'metadata-only' ? 'Source text unavailable' : note.extraction.status === 'image' ? 'Image-based analysis' : 'Capture details';
  return <main id="main" className="reading-pane" data-tone={categoryTone(c?.id)}>
    <article className="research-note"><nav className="reading-back" aria-label="Breadcrumb"><Link to="/sources/" search={previous => ({ ...previous, source: undefined })}>Sources</Link></nav>
      <header className="note-head">
        <p className="note-kind"><Link className={`category-chip${c ? '' : ' is-unset'}`} to="/categories/" search={{ source: source.id }}>{c?.name || 'Set category'}</Link>
          <span>{sourceTypeLabel(source.itemType)}</span><span>{source.publishedAt?.slice(0, 10)}</span></p>
        <h1>{source.title}</h1><p className="citation">{source.authors.join(', ') || 'Authors not provided'}</p>
        <div className="note-actions"><button className="ask-button" type="button" data-ask-open aria-controls="source-ask" aria-expanded="false">Ask about this source</button>
          {source.url && <a href={source.url} target="_blank" rel="noreferrer">Original</a>}{source.doi && <a href={`https://doi.org/${encodeURIComponent(source.doi)}`} target="_blank" rel="noreferrer">DOI</a>}
        </div>
      </header>
      <nav className="note-tabs" aria-label="Note sections"><a href="#analysis">Summary</a>{content.map(s => <a key={s.id} href={`#section-${s.id}`}>{s.heading}</a>)}<a href="#human">Notes</a><a href="#original">Original text</a><a href="#source">Details</a></nav>
      <section id="analysis" className="summary-section">{note.extraction.reason && <a className="capture-status" href="#capture-details">{captureLabel}</a>}<h2>Summary <span className="origin-tag">Generated</span></h2><p>{analysis?.summary || 'Analysis unavailable.'}</p>
        <ul className="topic-list">{(analysis?.topics || source.tags).map(t => <li key={t}>{t}</li>)}</ul></section>
      {content.map(s => <section className="analysis-section" id={`section-${s.id}`} key={s.id}><h2>{s.heading}</h2>
        {s.format === 'text' ? <p>{s.text}</p> : s.format === 'steps' ? <ol>{s.items.map((item, i) => <li key={i}>{item}</li>)}</ol> : <ul>{s.items.map((item, i) => <li key={i}>{item}</li>)}</ul>}</section>)}
      <section id="human" className="human-section"><h2>Notes <span className="origin-tag is-human">Human</span></h2>
        {humanHtml && <div className="human-prose" dangerouslySetInnerHTML={{ __html: humanHtml }} />}<ReaderNotes sourceId={source.id} /></section>
      <section id="original" className="original-section"><h2>Original text <span className="origin-tag is-source">Source</span></h2><OriginalText sourceId={source.id} artifactMime={note.extraction.artifactMime} sourceUrl={source.url} /></section>
      <section id="source" className="details-section"><h2>Details</h2><dl className="facts">
        <div><dt>Captured</dt><dd>{new Date(source.capturedAt).toLocaleDateString()}</dd></div><div><dt>Source type</dt><dd>{sourceTypeLabel(source.itemType)}</dd></div>
        <div><dt>Text</dt><dd>{note.extraction.method}</dd></div><div><dt>Analysis prepared</dt><dd>{new Date(note.processing.processedAt).toLocaleDateString()}</dd></div>
        {c && <div><dt>Category</dt><dd>{c.name}, template {c.templateRevision} · {c.assignment}</dd></div>}
      </dl>{note.extraction.reason && <details id="capture-details" className="capture-details"><summary>{captureLabel}</summary><p>{note.extraction.reason}</p></details>}</section>
    </article><button className="ask-fab" type="button" data-ask-open aria-controls="source-ask" aria-expanded="false">Ask</button>
  </main>;
}
