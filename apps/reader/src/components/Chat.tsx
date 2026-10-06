import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUp, BookOpen, Check, ChartColumn, Copy, ExternalLink, Eye, FileSearch, FileText, GitCompare, History, ImagePlus, Link, MessageSquareText, Minus, NotebookPen, PenLine, Plus, RotateCcw, Search, SearchCheck, Square, SquarePen, Trash2, X } from 'lucide-react';
import { Conversation, ConversationContent, ConversationScrollButton } from './ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from './ai-elements/message';
import { InlineCitation, InlineCitationQuote, InlineCitationSource } from './ai-elements/inline-citation';
import { citationLabel, maxMessageImages } from '../../../../shared/chat-client';
import type { ChatActivity, ChatAsset, ChatImage, ChatJob } from '../../../../shared/chat';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link as RouterLink, useNavigate, useParams } from '@tanstack/react-router';
import { ApiError, postBlob, postJson } from '../lib/api';
import { conversationQuery, conversationsQuery, jobQuery, keys, terminalJob, type Conversation as SavedConversation, type HistoryItem, type SourceContext } from '../lib/queries';
import { conversationIdPattern, sourceHref } from '../app/router';
import '../styles/chat.css';

type Result = NonNullable<ChatJob['result']>;
type Citation = Result['citations'][number];
type Turn = { jobId: string; question: string; images?: ChatImage[]; result?: Result; failure?: string; activities?: ChatActivity[]; workedMs?: number; draft?: string };
type Active = { id: string; conversationId: string; question: string; images?: ChatImage[] };
type Draft = { key: string; preview: string; status: 'uploading' | 'ready' | 'failed'; image?: ChatImage; error?: string };
const endpoint = '/api/chat';
const fileUrl = (jobId: string, params: Record<string, string>) => `${endpoint}?${new URLSearchParams({ id: jobId, ...params })}`;
const uploadUrl = (id: string) => `${endpoint}?upload=${id}`;
const safeUrl = (value?: string | null) => value && /^https?:\/\//i.test(value) ? value : undefined;
const origin = { source: 'Document text', machine: 'Generated analysis', human: 'Human notes', metadata: 'Source facts', visual: 'Page or image' };
const imageTypes = ['image/png', 'image/jpeg', 'image/webp'];
const suggestions = [
  { icon: FileSearch, text: 'What kinds of sources are saved in the library?' },
  { icon: SearchCheck, text: 'Which saved sources have limited or missing text?' },
  { icon: ChartColumn, text: 'Find a chart in my saved PDFs and explain what it shows' },
  { icon: NotebookPen, text: 'Where do my notes disagree with the generated analysis?' },
  { icon: GitCompare, text: 'Compare the conclusions of three saved research papers' }
];
const sourceSuggestions = [
  { icon: FileSearch, text: 'Summarize the main points of this source' },
  { icon: SearchCheck, text: 'What evidence does this source give for its main claims?' },
  { icon: GitCompare, text: 'Which other saved sources cover the same topic?' }
];

/** Temporary uploads and rendered pages expire after a day; saved conversations outlive them. */
function ExpiringImage({ src, alt, className, ...rest }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`chat-expired${className ? ' ' + className : ''}`} role="img" aria-label={`${alt}: no longer available`}>Image no longer available. Temporary images are kept for one day.</span>;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} {...rest} />;
}

const readStorage = (storage: Storage, key: string) => { try { return storage.getItem(key); } catch { return null; } };
const readActive = (key: string): Active | undefined => { try { return JSON.parse(readStorage(sessionStorage, key) || 'null') || undefined; } catch { return undefined; } };

/** Scales a screenshot to the 2048px box the model reads at high detail and keeps it under the 5 MB server limit. */
async function prepareImage(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error('This image could not be read. Attach a PNG, JPEG or WebP image.'); });
  const scale = Math.min(1, 2048 / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && imageTypes.includes(file.type) && file.size <= 4.5 * 1024 * 1024) { bitmap.close(); return file; }
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  const encode = (type: string, quality?: number) => new Promise<Blob | null>(resolve => canvas.toBlob(resolve, type, quality));
  let blob = await encode('image/png');
  if (!blob || blob.size > 4.5 * 1024 * 1024) blob = await encode('image/jpeg', 0.9);
  if (!blob || blob.size > 5 * 1024 * 1024) throw new Error('Images must be 5 MB or smaller.');
  return blob;
}

function usePhone() {
  const [phone, setPhone] = useState(false);
  useEffect(() => {
    const media = window.matchMedia('(max-width: 720px)');
    const update = () => setPhone(media.matches);
    update(); media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return phone;
}

const labelOf = (cite: Citation) => cite.label || citationLabel({ title: cite.title, authors: [], url: cite.sourceUrl || null });

function CitationDetail({ cite, jobId }: { cite: Citation; jobId: string }) {
  return <div className="chat-citation-detail">
    <InlineCitationSource title={cite.title} className="chat-citation-source">
      <p className="chat-citation-location"><strong>{labelOf(cite)}</strong> · {origin[cite.kind]} · {cite.locator}</p>
    </InlineCitationSource>
    {cite.assetId && <a className="chat-cited-image" href={fileUrl(jobId, { asset: cite.assetId })} target="_blank" rel="noreferrer"><ExpiringImage src={fileUrl(jobId, { asset: cite.assetId })} alt={cite.title} loading="lazy" />Open image</a>}
    {(cite.quote || cite.excerpt) && <InlineCitationQuote className="chat-citation-quote">{cite.quote || cite.excerpt}</InlineCitationQuote>}
    <div className="chat-source-links">
      <a href={sourceHref(cite.sourceId)} target="_blank" rel="noreferrer">Open note</a>
      {cite.pdf && <a href={fileUrl(jobId, { file: cite.sourceId, evidence: cite.evidenceId })} target="_blank" rel="noreferrer">Open PDF</a>}
      {safeUrl(cite.sourceUrl) && <a href={safeUrl(cite.sourceUrl)} target="_blank" rel="noreferrer">Open site</a>}
    </div>
  </div>;
}

/** One pill per run of adjacent citations. It names the first source and counts the rest. */
function CitationPill({ cites, jobId }: { cites: Citation[]; jobId: string }) {
  // Markdown blocks can retain their anchor renderer across viewport changes.
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const close = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(close.current), []);
  const enter = () => { clearTimeout(close.current); setOpen(true); };
  const leave = () => { close.current = setTimeout(() => setOpen(false), 180); };
  const hover = { onPointerEnter: (event: React.PointerEvent) => { if (event.pointerType === 'mouse') enter(); }, onPointerLeave: (event: React.PointerEvent) => { if (event.pointerType === 'mouse') leave(); } };
  const label = `Sources: ${cites.map(cite => cite.title).join('; ')}`;
  const button = <button className="chat-citation-button" type="button" aria-label={label} {...(phone ? {} : { ...hover, onClick: (event: React.MouseEvent) => { event.preventDefault(); enter(); } })}>
    <span className="chat-citation-label">{labelOf(cites[0])}</span>{cites.length > 1 && <span className="chat-citation-more">+{cites.length - 1}</span>}
  </button>;
  const details = cites.map(cite => <CitationDetail key={cite.evidenceId} cite={cite} jobId={jobId} />);
  if (phone) return <InlineCitation><Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>{button}</Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="chat-overlay" /><Dialog.Content className="chat-sheet chat-evidence-sheet" aria-describedby={undefined}>
      <Dialog.Title className="chat-sheet-title">{cites.length === 1 ? 'Source' : `${cites.length} sources`}</Dialog.Title>
      <Dialog.Close className="chat-icon-button chat-sheet-close" aria-label="Close source"><X size={20} /></Dialog.Close>
      {details}
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root></InlineCitation>;
  return <InlineCitation><Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild>{button}</Popover.Trigger>
    <Popover.Portal><Popover.Content className="chat-source-popover" sideOffset={6} collisionPadding={16} {...hover} onOpenAutoFocus={event => event.preventDefault()}>
      {details}
      <Popover.Close className="chat-icon-button chat-popover-close" aria-label="Close source"><X size={16} /></Popover.Close>
    </Popover.Content></Popover.Portal>
  </Popover.Root></InlineCitation>;
}

function ImageViewer({ url, title }: { url: string; title: string }) {
  const viewport = useRef<HTMLDivElement>(null);
  const image = useRef<HTMLImageElement>(null);
  const points = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef({ distance: 0, scale: 1, x: 0, y: 0 });
  const lastTap = useRef(0);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const constrain = (value: typeof view) => {
    const box = viewport.current; const img = image.current;
    if (!box || !img) return value;
    const scale = Math.min(6, Math.max(1, value.scale));
    const x = Math.max(0, (img.offsetWidth * scale - box.clientWidth) / 2);
    const y = Math.max(0, (img.offsetHeight * scale - box.clientHeight) / 2);
    return { scale, x: Math.max(-x, Math.min(x, value.x)), y: Math.max(-y, Math.min(y, value.y)) };
  };
  const zoom = (factor: number) => setView(previous => constrain({ ...previous, scale: previous.scale * factor }));
  const reset = () => setView({ scale: 1, x: 0, y: 0 });
  const start = () => {
    const values = [...points.current.values()];
    gesture.current = { scale: view.scale, x: view.x, y: view.y, distance: values.length > 1 ? Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y) : 0 };
  };
  return <Dialog.Content className="chat-image-viewer" aria-describedby={undefined}>
    <header><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="chat-icon-button" aria-label="Close image"><X size={20} /></Dialog.Close></header>
    <div ref={viewport} className="chat-image-viewport" tabIndex={0} role="region" aria-label="Image. Pinch or use zoom controls. Drag to pan."
      onDoubleClick={() => view.scale > 1 ? reset() : zoom(2)} onKeyDown={event => {
        if (['+', '=', '-', '0', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) event.preventDefault();
        if (event.key === '+' || event.key === '=') zoom(1.5);
        if (event.key === '-') zoom(1 / 1.5);
        if (event.key === '0') reset();
        const delta = { ArrowLeft: [40, 0], ArrowRight: [-40, 0], ArrowUp: [0, 40], ArrowDown: [0, -40] }[event.key];
        if (delta) setView(previous => constrain({ ...previous, x: previous.x + delta[0], y: previous.y + delta[1] }));
      }}
      onPointerDown={event => {
        event.currentTarget.setPointerCapture(event.pointerId);
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY }); start();
        if (event.pointerType === 'touch' && points.current.size === 1) {
          if (Date.now() - lastTap.current < 280) { view.scale > 1 ? reset() : zoom(2); lastTap.current = 0; }
          else lastTap.current = Date.now();
        }
      }}
      onPointerMove={event => {
        const previous = points.current.get(event.pointerId); if (!previous) return;
        points.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
        const values = [...points.current.values()];
        if (values.length > 1) {
          const distance = Math.hypot(values[1].x - values[0].x, values[1].y - values[0].y);
          if (gesture.current.distance) setView(constrain({ scale: gesture.current.scale * distance / gesture.current.distance, x: gesture.current.x, y: gesture.current.y }));
        } else setView(value => constrain({ ...value, x: value.x + event.clientX - previous.x, y: value.y + event.clientY - previous.y }));
      }} onPointerUp={event => { points.current.delete(event.pointerId); start(); }} onPointerCancel={event => { points.current.delete(event.pointerId); start(); }}>
      <img ref={image} src={url} alt={title} draggable={false} style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }} />
    </div>
    <footer><div><button type="button" className="chat-icon-button" aria-label="Zoom out" disabled={view.scale <= 1} onClick={() => zoom(1 / 1.5)}><Minus size={20} /></button>
      <span>{Math.round(view.scale * 100)}%</span><button type="button" className="chat-icon-button" aria-label="Zoom in" disabled={view.scale >= 6} onClick={() => zoom(1.5)}><Plus size={20} /></button>
      <button type="button" className="chat-icon-button" aria-label="Reset zoom" onClick={reset}><RotateCcw size={18} /></button></div><a href={url} target="_blank" rel="noreferrer">Open image</a></footer>
  </Dialog.Content>;
}

function ImageDialog({ url, title, children }: { url: string; title: string; children: ReactNode }) {
  return <Dialog.Root>
    <Dialog.Trigger asChild>{children}</Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="chat-overlay" /><ImageViewer url={url} title={title} /></Dialog.Portal>
  </Dialog.Root>;
}

function Attachment({ asset, jobId }: { asset: ChatAsset; jobId: string }) {
  const url = fileUrl(jobId, { asset: asset.id });
  const title = `${asset.title}${asset.page ? ` · Page ${asset.page}` : ''}`;
  if (asset.kind === 'image') return <figure className="chat-image">
    <ImageDialog url={url} title={title}><button type="button" aria-label={`Expand ${asset.title}${asset.page ? `, page ${asset.page}` : ''}`}>
      <ExpiringImage src={url} alt={`${asset.title}${asset.page ? `, page ${asset.page}` : ''}`} loading="lazy" />
    </button></ImageDialog><figcaption>{title}</figcaption></figure>;
  const href = asset.kind === 'site' ? safeUrl(asset.sourceUrl) : url;
  if (!href) return null;
  return <a className="chat-file" href={href} target="_blank" rel="noreferrer">
    {asset.kind === 'pdf' ? <FileText size={20} /> : <Link size={20} />}<span>{asset.title}<small>{asset.kind === 'pdf' ? 'PDF' : 'Website'}</small></span>
  </a>;
}

function UserImages({ images }: { images: ChatImage[] }) {
  return <div className="chat-user-images">{images.map((image, i) => <ImageDialog key={image.id} url={uploadUrl(image.id)} title={`Attached image ${i + 1}`}>
    <button type="button" aria-label={`Expand attached image ${i + 1}`}><ExpiringImage src={uploadUrl(image.id)} alt={`Attached image ${i + 1}`} width={image.width} height={image.height} loading="lazy" /></button>
  </ImageDialog>)}</div>;
}

const stepIcon = { search_corpus: Search, read_source: BookOpen, inspect_media: Eye, commentary: MessageSquareText };
/** Present-tense label for the live status line. Only real tool events and the model's own commentary reach here. */
function stepLabel(step: ChatActivity) {
  if (step.tool === 'commentary') return step.title;
  if (step.tool === 'search_corpus') return step.title === 'All sources' ? 'Listing saved sources' : `Searching saved sources: ${step.title}`;
  return `${step.tool === 'inspect_media' ? 'Viewing' : 'Reading'} ${step.title}`;
}
const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
function stepSummary(steps: ChatActivity[], workedMs?: number) {
  const count = (tool: ChatActivity['tool']) => steps.filter(step => step.tool === tool).length;
  const parts = [count('search_corpus') && plural(count('search_corpus'), 'search', 'searches'), count('read_source') && plural(count('read_source'), 'source read', 'source reads'),
    count('inspect_media') && plural(count('inspect_media'), 'page viewed', 'pages viewed')].filter(Boolean);
  const seconds = workedMs ? Math.max(1, Math.round(workedMs / 1000)) : 0;
  const time = seconds ? `Worked for ${seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`}` : '';
  return [time, parts.join(', ')].filter(Boolean).join(' · ') || plural(steps.length, 'step', 'steps');
}

/** Expandable record of what the answer actually did. While running its summary is the latest step. */
function Steps({ steps, summary, live = false }: { steps: ChatActivity[]; summary: ReactNode; live?: boolean }) {
  return <details className={`chat-steps${live ? ' is-live' : ''}`}>
    <summary>{summary}</summary>
    <ol>{steps.map((step, i) => {
      const Icon = stepIcon[step.tool] || Search;
      return <li key={step.id || `c${i}`} className={step.tool === 'commentary' ? 'is-commentary' : undefined}>
        <Icon size={15} aria-hidden="true" />
        <span>{step.tool === 'commentary' ? step.title : <>{stepLabel(step)}{step.detail && <small> · {step.detail}</small>}</>}</span>
      </li>;
    })}</ol>
  </details>;
}

function Working({ turn, stopping, busy, retry }: { turn: Turn; stopping: boolean; busy: boolean; retry: () => void }) {
  const steps = turn.activities || [];
  const latest = steps.at(-1);
  const commentary = [...steps].reverse().find(step => step.tool === 'commentary');
  const label = stopping ? 'Stopping…' : turn.draft ? 'Writing the answer' : latest ? stepLabel(latest) : 'Answering…';
  const LiveIcon = turn.draft ? PenLine : latest ? stepIcon[latest.tool] : undefined;
  return <div className="chat-working" aria-busy={!turn.failure}>
    {!turn.failure && commentary && !turn.draft && <p className="chat-commentary">{commentary.title}</p>}
    {turn.failure ? <p>{turn.failure}</p> : !steps.length ? <p className="chat-live"><span className="chat-pulse" aria-hidden="true" />{label}</p> : null}
    {!!steps.length && <Steps steps={steps} live={!turn.failure} summary={turn.failure ? stepSummary(steps) : <span className="chat-live"><span className="chat-pulse" aria-hidden="true" />{LiveIcon && <LiveIcon size={15} aria-hidden="true" />}<span>{label}</span></span>} />}
    {turn.draft && <div className={`chat-draft${turn.failure ? ' is-partial' : ''}`}>
      {turn.failure && <p className="chat-draft-note">Partial answer, not verified. Citations are not available yet.</p>}
      <MessageResponse className="chat-markdown" mode="static" controls={false} components={{
        a: ({ href, children }) => safeUrl(href) ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>,
        img: ({ alt }) => <span>{alt}</span>
      }}>{turn.draft}</MessageResponse>
    </div>}
    {turn.failure && <button className="chat-retry" type="button" disabled={busy} onClick={retry}>Retry</button>}
  </div>;
}

function Answer({ turn }: { turn: Turn & { result: Result } }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const citations = turn.result.citations;
  const byId = (id: string) => citations.find(cite => cite.evidenceId === id);
  const text = turn.result.answer.replace(/\[e_[a-f0-9]{16}\](?:[ \t]*\[e_[a-f0-9]{16}\])*/g, run => ` [source](#cite-${[...new Set(run.match(/e_[a-f0-9]{16}/g))].join(',')})`);
  const copy = async () => {
    try { await navigator.clipboard.writeText(turn.result.answer.replace(/\s*\[e_[a-f0-9]{16}\]/g, '')); setCopied(true); timer.current = setTimeout(() => setCopied(false), 2000); } catch { /* Clipboard permission can be unavailable. */ }
  };
  return <Message from="assistant" className="chat-message chat-assistant"><MessageContent>
    {!!turn.activities?.length && <Steps steps={turn.activities} summary={stepSummary(turn.activities, turn.workedMs)} />}
    <MessageResponse className="chat-markdown" mode="static" controls={false} components={{
      a: ({ href, children }) => {
        const ids = href?.match(/^#cite-((?:e_[a-f0-9]{16},?)+)$/)?.[1].split(',');
        const cites = ids?.map(byId).filter((cite): cite is Citation => !!cite);
        if (cites?.length) return <CitationPill cites={cites} jobId={turn.jobId} />;
        return safeUrl(href) ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
      },
      img: ({ alt }) => <span>{alt}</span>
    }}>{text}</MessageResponse>
    {!!turn.result.attachments.length && <div className="chat-attachments">{turn.result.attachments.map(asset => <Attachment key={asset.id} asset={asset} jobId={turn.jobId} />)}</div>}
    <div className="chat-answer-actions">
      <button type="button" className="chat-icon-button chat-copy" aria-label={copied ? 'Copied' : 'Copy answer'} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
      {!!citations.length && <details className="chat-sources"><summary>{citations.length === 1 ? '1 source' : `${citations.length} sources`}</summary><ul>
        {citations.map(cite => <li key={cite.evidenceId}><CitationPill cites={[cite]} jobId={turn.jobId} /><span>{cite.title}</span></li>)}
      </ul></details>}
    </div>
  </MessageContent></Message>;
}

type Props = {
  /** Starts new conversations with this source as soft context. The model can still search every saved source. */
  source?: SourceContext;
  /** Renders inside a reading view: no history margin, own resume key, optional close action. */
  embedded?: boolean;
  onClose?: () => void;
};

export default function Chat({ source, embedded = false, onClose }: Props = {}) {
  const phone = usePhone();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const recentKey = source ? `research-chat-source:${source.sourceId}` : 'research-chat';
  const activeKey = source ? `research-chat-active:${source.sourceId}` : 'research-chat-active';
  // The global chat keeps its conversation in the URL; a source panel remembers its own in this browser.
  const routeId = useParams({ strict: false, select: params => (params as { conversationId?: string }).conversationId });
  const [panelId, setPanelId] = useState<string | undefined>(() => embedded ? readStorage(localStorage, recentKey) || undefined : undefined);
  const conversationId = embedded ? panelId : routeId;
  const validId = !conversationId || conversationIdPattern.test(conversationId);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  // Turns asked in this tab. Saved conversations hold only finished answers, so pending and failed turns live here.
  const [local, setLocal] = useState<(Turn & { conversationId: string })[]>([]);
  const [active, setActive] = useState<Active>();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirming, setConfirming] = useState<string>();
  const [stopping, setStopping] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const detail = useQuery({ ...conversationQuery(conversationId || ''), enabled: !!conversationId && validId });
  const history = useQuery({ ...conversationsQuery, enabled: !embedded });
  const job = useQuery({ ...jobQuery(active?.id || ''), enabled: !!active });
  const loading = !!conversationId && validId && detail.isPending;
  const unavailable = !!conversationId && (!validId || (!!detail.error && !detail.data));
  const context = conversationId ? detail.data?.sourceContext ?? (detail.data ? undefined : source) : source;
  const saved = detail.data?.turns ?? [];
  const savedIds = new Set(saved.map(turn => turn.jobId));
  const turns: Turn[] = [...saved, ...local.filter(turn => turn.conversationId === conversationId && !savedIds.has(turn.jobId))];

  const remember = (id: string) => { try { localStorage.setItem(recentKey, id); } catch { /* Storage can be disabled. */ } };
  const forget = () => { try { localStorage.removeItem(recentKey); } catch { /* Storage can be disabled. */ } };
  const finish = () => { setActive(undefined); setStopping(false); try { sessionStorage.removeItem(activeKey); } catch { /* Storage can be disabled. */ } };
  const patchLocal = (jobId: string, change: Partial<Turn>) => setLocal(previous => previous.map(turn => turn.jobId === jobId ? { ...turn, ...change } : turn));

  // The plain chat address reopens the conversation this browser used last, including one still answering.
  const restored = useRef(false);
  useEffect(() => {
    if (embedded || restored.current) return;
    restored.current = true;
    if (routeId) return;
    const id = readActive(activeKey)?.conversationId || readStorage(localStorage, recentKey);
    if (id && conversationIdPattern.test(id)) void navigate({ to: '/chat/$conversationId/', params: { conversationId: id }, replace: true });
  }, []);
  useEffect(() => {
    if (!conversationId) return;
    if (detail.data) remember(conversationId);
    else if (detail.error || !validId) { if (readStorage(localStorage, recentKey) === conversationId) forget(); }
  }, [conversationId, detail.data, detail.error]);
  // A stored running answer resumes when its conversation is open; one from another conversation stays stored for it.
  useEffect(() => {
    const pending = readActive(activeKey);
    if (pending && pending.conversationId === conversationId && active?.id !== pending.id) {
      setActive(pending);
      setLocal(previous => previous.some(turn => turn.jobId === pending.id) ? previous : [...previous, { conversationId: pending.conversationId, jobId: pending.id, question: pending.question, images: pending.images }]);
    } else if (active && active.conversationId !== conversationId) { setActive(undefined); setStopping(false); }
  }, [conversationId]);

  useEffect(() => {
    if (embedded) return;
    const resize = () => {
      if (!root.current) return;
      const top = root.current.getBoundingClientRect().top;
      const viewport = window.visualViewport;
      root.current.style.height = `${Math.max(240, (viewport?.height || window.innerHeight) + (viewport?.offsetTop || 0) - top)}px`;
    };
    resize(); window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize);
    const masthead = document.querySelector('.masthead');
    const observer = new ResizeObserver(resize); if (masthead) observer.observe(masthead);
    return () => { observer.disconnect(); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize); };
  }, []);

  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto'; input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`;
  }, [question, turns.length === 0]);

  useEffect(() => {
    if (!active) return;
    const value = job.data;
    if (value) {
      patchLocal(active.id, { result: value.result, activities: value.activities, draft: value.draft,
        failure: value.status === 'failed' ? value.error || 'No answer returned. Try again.' : value.status === 'cancelled' ? 'Stopped' : undefined });
      if (terminalJob(value.status)) {
        finish();
        setAnnouncement(value.status === 'complete' ? 'Answer ready' : value.status === 'cancelled' ? 'Stopped' : 'Answer failed');
        if (value.status === 'failed') setError(value.error || 'No answer returned. Try again.');
        void queryClient.invalidateQueries({ queryKey: keys.conversation(active.conversationId) });
        void queryClient.invalidateQueries({ queryKey: keys.conversations });
        queryClient.removeQueries({ queryKey: keys.job(active.id) });
      } else setError('');
    } else if (job.error) {
      setError(job.error.message);
      if (job.error instanceof ApiError && [400, 401, 403, 404, 410].includes(job.error.status)) {
        patchLocal(active.id, { failure: job.error.message }); finish(); setAnnouncement('Answer unavailable');
      }
    }
  }, [job.data, job.error, job.errorUpdatedAt]);

  const addImages = (files: File[]) => {
    const images = files.filter(file => file.type.startsWith('image/'));
    if (!images.length) return;
    const room = maxMessageImages - drafts.length;
    if (images.length > room) setError(`Attach up to ${maxMessageImages} images per message.`);
    for (const file of images.slice(0, Math.max(0, room))) {
      const key = crypto.randomUUID();
      setDrafts(previous => [...previous, { key, preview: URL.createObjectURL(file), status: 'uploading' }]);
      void (async () => {
        try {
          const blob = await prepareImage(file);
          const image = await postBlob<ChatImage>(`${endpoint}?upload=1`, blob);
          setDrafts(previous => previous.map(draft => draft.key === key ? { ...draft, status: 'ready', image } : draft));
        } catch (error) {
          setDrafts(previous => previous.map(draft => draft.key === key ? { ...draft, status: 'failed', error: (error as Error).message } : draft));
        }
      })();
    }
  };
  const removeDraft = (key: string) => setDrafts(previous => previous.filter(draft => { if (draft.key === key) URL.revokeObjectURL(draft.preview); return draft.key !== key; }));
  const clearDrafts = () => setDrafts(previous => { previous.forEach(draft => URL.revokeObjectURL(draft.preview)); return []; });
  useEffect(() => () => clearDrafts(), []);

  const ask = useMutation({
    mutationFn: (body: { question: string; images: ChatImage[] }) => postJson<{ id: string; conversationId: string }>(endpoint, { question: body.question, ...(body.images.length ? { images: body.images.map(image => image.id) } : {}),
      ...(conversationId ? { conversationId } : source ? { sourceId: source.sourceId } : {}) }, 'Chat is unavailable. Try again.'),
    onMutate: () => setError(''),
    onError: failure => setError(failure.message)
  });
  const busy = !!active || ask.isPending || loading;
  const uploading = drafts.some(draft => draft.status === 'uploading');
  const ready = drafts.filter(draft => draft.status === 'ready').map(draft => draft.image!);

  const send = async (retry?: Turn | string) => {
    const submitted = (typeof retry === 'string' ? retry : retry ? retry.question : question).trim();
    const images = typeof retry === 'object' ? retry.images || [] : retry ? [] : ready;
    if (busy || uploading || unavailable || (!submitted && !images.length)) return;
    if (!retry && drafts.some(draft => draft.status === 'failed')) { setError('Remove the images that failed to upload.'); return; }
    const created = await ask.mutateAsync({ question: submitted, images }).catch(() => undefined);
    if (!created) return;
    const next = { ...created, question: submitted, images };
    try { sessionStorage.setItem(activeKey, JSON.stringify(next)); } catch { /* The answer still shows in this tab. */ }
    remember(created.conversationId);
    setLocal(previous => [...previous, { conversationId: created.conversationId, jobId: created.id, question: submitted, images }]);
    setActive(next);
    if (!retry) { setQuestion(''); clearDrafts(); }
    setAnnouncement('Answering');
    if (!conversationId) {
      // The server stores the new conversation with no finished turns yet.
      queryClient.setQueryData<SavedConversation>(keys.conversation(created.conversationId), previous => previous ?? { id: created.conversationId, owner: '', createdAt: '', updatedAt: '', turns: [], ...(source ? { sourceContext: source } : {}) });
      if (embedded) setPanelId(created.conversationId);
      else void navigate({ to: '/chat/$conversationId/', params: { conversationId: created.conversationId } });
    }
  };
  const stop = useMutation({
    mutationFn: (id: string) => postJson(endpoint, { action: 'cancel', id }, 'Chat is unavailable. Try again.'),
    onMutate: () => setStopping(true),
    // The job poll reports the cancelled state.
    onError: failure => { setError(failure.message); setStopping(false); }
  });
  const startNew = () => {
    setQuestion(''); clearDrafts(); setError(''); setHistoryOpen(false); forget();
    if (embedded) setPanelId(undefined); else void navigate({ to: '/' });
    input.current?.focus();
  };
  const remove = useMutation({
    mutationFn: (id: string) => postJson(endpoint, { action: 'delete', conversationId: id }, 'Chat is unavailable. Try again.'),
    onMutate: () => setError(''),
    onSuccess: (_, id) => {
      queryClient.setQueryData<HistoryItem[]>(keys.conversations, previous => previous?.filter(item => item.id !== id));
      queryClient.removeQueries({ queryKey: keys.conversation(id) });
      if (readActive(activeKey)?.conversationId === id) finish();
      setLocal(previous => previous.filter(turn => turn.conversationId !== id));
      if (id === conversationId) {
        forget();
        if (embedded) setPanelId(undefined); else void navigate({ to: '/', replace: true });
      }
      setAnnouncement('Chat deleted');
    },
    onError: failure => setError(failure.message),
    onSettled: () => setConfirming(undefined)
  });
  const deleting = remove.isPending ? remove.variables : undefined;
  const items = history.data ?? [];

  const historyList = <>
    <button className="chat-new" type="button" disabled={busy} onClick={startNew}><SquarePen size={18} />New chat</button>
    <h2>Recent</h2>
    {items.length ? <ul>{items.map(item => <li key={item.id} className={confirming === item.id ? 'is-confirming' : undefined}>
      {confirming === item.id ? <div className="chat-confirm" role="group" aria-label={`Delete ${item.title}?`}>
        <span>Delete this chat?</span>
        <button type="button" className="chat-confirm-delete" disabled={deleting === item.id} onClick={() => remove.mutate(item.id)}>{deleting === item.id ? 'Deleting…' : 'Delete'}</button>
        <button type="button" disabled={deleting === item.id} onClick={() => setConfirming(undefined)}>Cancel</button>
      </div> : <>
        <RouterLink className="chat-history-open" to="/chat/$conversationId/" params={{ conversationId: item.id }} aria-current={item.id === conversationId ? 'page' : undefined}
          disabled={busy} aria-disabled={busy || undefined} onClick={() => { setHistoryOpen(false); setError(''); }}>
          <span>{item.title}</span>{item.sourceContext && <small><FileText size={12} aria-hidden="true" /><span>{item.sourceContext.title}</span></small>}</RouterLink>
        <button type="button" className="chat-icon-button chat-history-delete" aria-label={`Delete ${item.title}`} disabled={!!deleting} onClick={() => setConfirming(item.id)}><Trash2 size={16} /></button>
      </>}
    </li>)}</ul> : <p className="chat-history-empty">{history.isPending ? 'Loading…' : history.error ? 'History could not load.' : 'No conversations'}</p>}
  </>;

  const composer = <div className="chat-composer-area">
    {error && <div className="chat-error" role="alert"><p>{error}</p>{error.startsWith('Sign in') && <a href="/login.html">Sign in</a>}</div>}
    <form className={`chat-composer${dragging ? ' is-dragging' : ''}`} onSubmit={event => { event.preventDefault(); void send(); }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={() => setDragging(false)} onDrop={event => { event.preventDefault(); setDragging(false); addImages([...event.dataTransfer.files]); }}>
      {!!drafts.length && <ul className="chat-drafts" aria-label="Attached images">{drafts.map((draft, i) => <li key={draft.key} className={`is-${draft.status}`}>
        <img src={draft.preview} alt={`Attached image ${i + 1}`} />
        {draft.status !== 'ready' && <span className="chat-draft-state">{draft.status === 'uploading' ? 'Uploading…' : 'Failed'}</span>}
        <button type="button" className="chat-draft-remove" aria-label={`Remove image ${i + 1}${draft.error ? `: ${draft.error}` : ''}`} title={draft.error} onClick={() => removeDraft(draft.key)}><X size={14} /></button>
      </li>)}</ul>}
      <div className="chat-composer-row">
        <input ref={picker} type="file" accept={imageTypes.join(',')} multiple hidden onChange={event => { addImages([...(event.target.files || [])]); event.target.value = ''; }} />
        <button type="button" className="chat-icon-button chat-attach" aria-label="Attach images" disabled={drafts.length >= maxMessageImages} onClick={() => picker.current?.click()}><ImagePlus size={20} /></button>
        <label className="chat-sr-only" htmlFor="chat-message">Message</label>
        <textarea ref={input} id="chat-message" rows={1} maxLength={8000} value={question} placeholder={source ? 'Ask about this or other sources' : 'Ask about saved sources or paste a screenshot'} onChange={event => setQuestion(event.target.value)}
          onPaste={event => { const files = [...event.clipboardData.files]; if (files.some(file => file.type.startsWith('image/'))) { event.preventDefault(); addImages(files); } }}
          onKeyDown={event => { if (!phone && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
        {active ? <button className="chat-send" type="button" aria-label={stopping ? 'Stopping' : 'Stop'} disabled={stopping} onClick={() => { if (active && !stopping) stop.mutate(active.id); }}><Square size={15} fill="currentColor" /></button>
          : <button className="chat-send" type="submit" aria-label="Send" disabled={busy || uploading || (!question.trim() && !ready.length)}><ArrowUp size={21} strokeWidth={2.4} /></button>}
      </div>
    </form>
  </div>;

  const empty = !turns.length && !loading && !unavailable;
  const Main = embedded ? 'section' : 'main';
  const contextLine = context && <p className="chat-context"><FileText size={15} aria-hidden="true" /><span>{embedded && context.sourceId === source?.sourceId ? 'Started from this source' : <>Started from <RouterLink to="/sources/" search={{ source: context.sourceId }}>{context.title}</RouterLink></>}</span></p>;
  return <div ref={root} className={`discussion-chat${embedded ? ' is-embedded' : ''}`}>
    {!embedded && <aside className="chat-history" aria-label="Chat history">{historyList}</aside>}
    <Main {...(embedded ? { 'aria-label': 'Ask about this source' } : { id: 'main', tabIndex: -1 })} className={`chat-main${empty ? ' is-empty' : ''}`}>
      <header className="chat-toolbar">{embedded ? <h2>Ask</h2> : <h1>Chat</h1>}<div>
        {!embedded && <button type="button" className="chat-icon-button chat-history-toggle" aria-label="History" disabled={busy} onClick={() => { void history.refetch(); setHistoryOpen(true); }}><History size={20} /></button>}
        {embedded && conversationId && <RouterLink className="chat-icon-button" to="/chat/$conversationId/" params={{ conversationId }} aria-label="Continue in Chat" title="Continue in Chat"><ExternalLink size={18} /></RouterLink>}
        <button type="button" className="chat-icon-button" aria-label="New chat" disabled={busy && !unavailable} onClick={startNew}><SquarePen size={19} /></button>
        {onClose && <button type="button" className="chat-icon-button" aria-label="Close" onClick={onClose}><X size={20} /></button>}
      </div></header>
      {!empty && !unavailable && contextLine}
      {unavailable ? <section className="chat-start" aria-label="Conversation unavailable">
        <p className="chat-error" role="alert">{validId ? detail.error?.message || 'This conversation could not be opened.' : 'This chat address is not valid.'} It may have been deleted. Start a new chat or pick one from history.</p>
        <button className="chat-new" type="button" onClick={startNew}><SquarePen size={18} />New chat</button>
      </section> : empty ? <section className="chat-start" aria-labelledby={embedded ? undefined : 'chat-start-title'} aria-label={embedded ? 'New conversation' : undefined}>
        {embedded ? <p className="chat-start-source">{source?.title}</p> : <h2 id="chat-start-title">Ask about your saved sources</h2>}
        {composer}
        <ul className="chat-suggestions" aria-label="Suggested questions">{(source ? sourceSuggestions : suggestions).map(({ icon: Icon, text }) => <li key={text}>
          <button type="button" disabled={busy || uploading} onClick={() => void send(text)}><Icon size={18} aria-hidden="true" /><span>{text}</span></button>
        </li>)}</ul>
      </section> : <>
        <Conversation className="chat-conversation" aria-label="Conversation" aria-live="off" initial="instant" resize="instant">
          <ConversationContent className="chat-messages">
            {turns.map(turn => <div className="chat-turn" key={turn.jobId}>
              <Message from="user" className="chat-message chat-user"><MessageContent>
                {!!turn.images?.length && <UserImages images={turn.images} />}
                {turn.question && <p>{turn.question}</p>}
              </MessageContent></Message>
              {turn.result ? <Answer turn={turn as Turn & { result: Result }} /> : <Working turn={turn} stopping={stopping && turn.jobId === active?.id} busy={busy} retry={() => void send(turn)} />}
            </div>)}
          </ConversationContent>
          <ConversationScrollButton aria-label="Scroll to latest message" className="chat-scroll-button" />
        </Conversation>
        {composer}
      </>}
      <p className="chat-sr-only" role="status" aria-live="polite">{announcement}</p>
    </Main>
    {!embedded && <Dialog.Root open={historyOpen} onOpenChange={setHistoryOpen}><Dialog.Portal><Dialog.Overlay className="chat-overlay" /><Dialog.Content className="chat-history-drawer" aria-describedby={undefined}>
      <Dialog.Title className="chat-sr-only">Chat history</Dialog.Title><Dialog.Close className="chat-icon-button chat-sheet-close" aria-label="Close history"><X size={20} /></Dialog.Close>{historyList}
    </Dialog.Content></Dialog.Portal></Dialog.Root>}
  </div>;
}
