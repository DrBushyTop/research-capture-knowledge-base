import { useEffect, useRef, useState, type ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUp, Check, ChartColumn, Copy, ExternalLink, FileSearch, FileText, GitCompare, History, ImagePlus, Link, Minus, NotebookPen, Plus, RotateCcw, SearchCheck, Square, SquarePen, Trash2, X } from 'lucide-react';
import { Conversation, ConversationContent, ConversationScrollButton } from './ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from './ai-elements/message';
import { InlineCitation, InlineCitationQuote, InlineCitationSource } from './ai-elements/inline-citation';
import { citationLabel, maxMessageImages } from '../../../../shared/chat-client';
import type { ChatActivity, ChatAsset, ChatConversation, ChatImage, ChatJob } from '../../../../shared/chat';
import '../styles/chat.css';

type Result = NonNullable<ChatJob['result']>;
type Citation = Result['citations'][number];
type Turn = { jobId: string; question: string; images?: ChatImage[]; result?: Result; failure?: string; activities?: ChatActivity[] };
type SourceContext = { sourceId: string; title: string };
type HistoryItem = { id: string; title: string; updatedAt: string; sourceContext?: SourceContext };
type Conversation = ChatConversation & { sourceContext?: SourceContext };
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
const noteUrl = (sourceId: string) => `/research/${encodeURIComponent(sourceId)}/`;

/** Temporary uploads and rendered pages expire after a day; saved conversations outlive them. */
function ExpiringImage({ src, alt, className, ...rest }: React.ImgHTMLAttributes<HTMLImageElement> & { src: string; alt: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <span className={`chat-expired${className ? ' ' + className : ''}`} role="img" aria-label={`${alt}: no longer available`}>Image no longer available. Temporary images are kept for one day.</span>;
  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} {...rest} />;
}

class RequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 401 || response.status === 403 || !response.headers.get('content-type')?.includes('application/json')) throw new RequestError('Sign in with an invited account to use chat.', 403);
  const value = await response.json();
  if (!response.ok) throw new RequestError(value.error || 'Chat is unavailable. Try again.', response.status);
  return value as T;
}
async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  return parse<T>(await fetch(endpoint + path, { credentials: 'same-origin', signal,
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) }));
}

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
      <a href={noteUrl(cite.sourceId)} target="_blank" rel="noreferrer">Open note</a>
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
  const recentKey = source ? `research-chat-source:${source.sourceId}` : 'research-chat';
  const activeKey = source ? `research-chat-active:${source.sourceId}` : 'research-chat-active';
  const [context, setContext] = useState<SourceContext | undefined>(source);
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [question, setQuestion] = useState('');
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [active, setActive] = useState<Active>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirming, setConfirming] = useState<string>();
  const [deleting, setDeleting] = useState<string>();
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const busy = !!active || sending || loading;
  const uploading = drafts.some(draft => draft.status === 'uploading');
  const ready = drafts.filter(draft => draft.status === 'ready').map(draft => draft.image!);
  const refreshHistory = async () => { try { setHistory(await request<HistoryItem[]>('?conversations=1')); } catch { /* A send or open reports authentication errors. */ } };
  const openConversation = async (id: string) => {
    setHistoryOpen(false); setLoading(true); setError('');
    try {
      const value = await request<Conversation>(`?conversation=${id}`);
      setConversationId(id); setTurns(value.turns); setContext(value.sourceContext); localStorage.setItem(recentKey, id);
    } catch (error) { setError((error as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => {
    let live = true;
    const restore = async () => {
      const linked = embedded ? null : new URLSearchParams(location.search).get('conversation');
      if (linked) window.history.replaceState(null, '', location.pathname);
      let pending: Active | undefined;
      try {
        const recent = localStorage.getItem(recentKey);
        pending = JSON.parse(sessionStorage.getItem(activeKey) || 'null') || undefined;
        const id = linked && /^[a-f0-9]{32}$/.test(linked) ? linked : pending?.conversationId || recent;
        if (id) {
          const value = await request<Conversation>(`?conversation=${id}`);
          if (!live) return;
          setConversationId(id); if (linked) localStorage.setItem(recentKey, id); setContext(value.sourceContext ?? source);
          // A pending answer from another conversation stays stored so that conversation can resume it.
          const own = pending?.conversationId === id ? pending : undefined;
          setTurns(own && !value.turns.some(turn => turn.jobId === own.id) ? [...value.turns, { jobId: own.id, question: own.question, images: own.images }] : value.turns);
          if (own) setActive(own);
        }
      } catch {
        localStorage.removeItem(recentKey);
        if (!linked || pending?.conversationId === linked) sessionStorage.removeItem(activeKey);
      }
      finally { if (live) { setLoading(false); if (!embedded) void refreshHistory(); } }
    };
    void restore();
    if (embedded) return () => { live = false; };
    const resize = () => {
      if (!root.current) return;
      const top = root.current.getBoundingClientRect().top;
      const viewport = window.visualViewport;
      root.current.style.height = `${Math.max(240, (viewport?.height || window.innerHeight) + (viewport?.offsetTop || 0) - top)}px`;
    };
    resize(); window.addEventListener('resize', resize); window.visualViewport?.addEventListener('resize', resize); window.visualViewport?.addEventListener('scroll', resize);
    const masthead = document.querySelector('.masthead');
    const observer = new ResizeObserver(resize); if (masthead) observer.observe(masthead);
    return () => { live = false; observer.disconnect(); window.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('resize', resize); window.visualViewport?.removeEventListener('scroll', resize); };
  }, []);

  useEffect(() => {
    if (!input.current) return;
    input.current.style.height = 'auto'; input.current.style.height = `${Math.min(input.current.scrollHeight, 180)}px`;
  }, [question, turns.length === 0]);

  useEffect(() => {
    if (!active) return;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const job = await request<{ status: ChatJob['status']; result?: Result; activities?: ChatActivity[]; error?: string }>(`?id=${active.id}`, undefined, controller.signal);
        if (controller.signal.aborted) return;
        setTurns(previous => previous.map(turn => turn.jobId === active.id ? { ...turn, result: job.result, activities: job.activities,
          failure: job.status === 'failed' ? job.error || 'No answer returned. Try again.' : job.status === 'cancelled' ? 'Stopped' : undefined } : turn));
        if (['complete', 'failed', 'cancelled'].includes(job.status)) {
          setActive(undefined); setStopping(false); sessionStorage.removeItem(activeKey);
          setAnnouncement(job.status === 'complete' ? 'Answer ready' : job.status === 'cancelled' ? 'Stopped' : 'Answer failed');
          if (job.status === 'failed') setError(job.error || 'No answer returned. Try again.');
          void refreshHistory(); return;
        }
        setError(''); timer = setTimeout(() => void poll(), 2000);
      } catch (error) {
        if (!controller.signal.aborted) {
          setError((error as Error).message);
          if (error instanceof RequestError && [400, 401, 403, 404, 410].includes(error.status)) {
            setTurns(previous => previous.map(turn => turn.jobId === active.id ? { ...turn, failure: (error as Error).message } : turn));
            setActive(undefined); setStopping(false); sessionStorage.removeItem(activeKey); setAnnouncement('Answer unavailable');
          } else timer = setTimeout(() => void poll(), 5000);
        }
      }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [active?.id]);

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
          const image = await parse<ChatImage>(await fetch(`${endpoint}?upload=1`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': blob.type }, body: blob }));
          setDrafts(previous => previous.map(draft => draft.key === key ? { ...draft, status: 'ready', image } : draft));
        } catch (error) {
          setDrafts(previous => previous.map(draft => draft.key === key ? { ...draft, status: 'failed', error: (error as Error).message } : draft));
        }
      })();
    }
  };
  const removeDraft = (key: string) => setDrafts(previous => previous.filter(draft => { if (draft.key === key) URL.revokeObjectURL(draft.preview); return draft.key !== key; }));
  const clearDrafts = () => setDrafts(previous => { previous.forEach(draft => URL.revokeObjectURL(draft.preview)); return []; });

  const send = async (retry?: Turn | string) => {
    const submitted = (typeof retry === 'string' ? retry : retry ? retry.question : question).trim();
    const images = typeof retry === 'object' ? retry.images || [] : retry ? [] : ready;
    if (busy || uploading || (!submitted && !images.length)) return;
    if (!retry && drafts.some(draft => draft.status === 'failed')) { setError('Remove the images that failed to upload.'); return; }
    setSending(true); setError('');
    try {
      const job = await request<{ id: string; conversationId: string }>('', { question: submitted, ...(images.length ? { images: images.map(image => image.id) } : {}), ...(conversationId ? { conversationId } : source ? { sourceId: source.sourceId } : {}) });
      const next = { ...job, question: submitted, images };
      setConversationId(job.conversationId); localStorage.setItem(recentKey, job.conversationId); sessionStorage.setItem(activeKey, JSON.stringify(next));
      setTurns(previous => [...previous, { jobId: job.id, question: submitted, images }]); setActive(next);
      if (!retry) { setQuestion(''); clearDrafts(); }
      if (!conversationId) setContext(source);
      setAnnouncement('Answering');
    } catch (error) { setError((error as Error).message); } finally { setSending(false); }
  };
  const stop = async () => {
    if (!active || stopping) return;
    setStopping(true);
    try { await request('', { action: 'cancel', id: active.id }); } catch (error) { setError((error as Error).message); setStopping(false); }
  };
  const newChat = () => { setConversationId(undefined); setContext(source); setTurns([]); setQuestion(''); clearDrafts(); setError(''); setHistoryOpen(false); localStorage.removeItem(recentKey); input.current?.focus(); };
  const remove = async (id: string) => {
    setDeleting(id); setError('');
    try {
      await request('', { action: 'delete', conversationId: id });
      setHistory(previous => previous.filter(item => item.id !== id));
      if (id === conversationId) {
        sessionStorage.removeItem(activeKey); setActive(undefined); setStopping(false);
        setConversationId(undefined); setContext(source); setTurns([]); localStorage.removeItem(recentKey);
      }
      setAnnouncement('Chat deleted');
    } catch (error) { setError((error as Error).message); } finally { setDeleting(undefined); setConfirming(undefined); }
  };

  const historyList = <>
    <button className="chat-new" type="button" disabled={busy} onClick={newChat}><SquarePen size={18} />New chat</button>
    <h2>Recent</h2>
    {history.length ? <ul>{history.map(item => <li key={item.id} className={confirming === item.id ? 'is-confirming' : undefined}>
      {confirming === item.id ? <div className="chat-confirm" role="group" aria-label={`Delete ${item.title}?`}>
        <span>Delete this chat?</span>
        <button type="button" className="chat-confirm-delete" disabled={deleting === item.id} onClick={() => void remove(item.id)}>{deleting === item.id ? 'Deleting…' : 'Delete'}</button>
        <button type="button" disabled={deleting === item.id} onClick={() => setConfirming(undefined)}>Cancel</button>
      </div> : <>
        <button type="button" className="chat-history-open" aria-current={item.id === conversationId ? 'page' : undefined} disabled={busy} onClick={() => void openConversation(item.id)}>
          <span>{item.title}</span>{item.sourceContext && <small><FileText size={12} aria-hidden="true" /><span>{item.sourceContext.title}</span></small>}</button>
        <button type="button" className="chat-icon-button chat-history-delete" aria-label={`Delete ${item.title}`} disabled={!!deleting} onClick={() => setConfirming(item.id)}><Trash2 size={16} /></button>
      </>}
    </li>)}</ul> : <p className="chat-history-empty">No conversations</p>}
  </>;

  const composer = <div className="chat-composer-area">
    {error && <div className="chat-error" role="alert"><p>{error}</p>{error.startsWith('Sign in') && <a href={`/.auth/login/github?post_login_redirect_uri=${encodeURIComponent(location.pathname)}`}>Sign in</a>}</div>}
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
        {active ? <button className="chat-send" type="button" aria-label={stopping ? 'Stopping' : 'Stop'} disabled={stopping} onClick={() => void stop()}><Square size={15} fill="currentColor" /></button>
          : <button className="chat-send" type="submit" aria-label="Send" disabled={busy || uploading || (!question.trim() && !ready.length)}><ArrowUp size={21} strokeWidth={2.4} /></button>}
      </div>
    </form>
  </div>;

  const empty = !turns.length && !loading;
  const Main = embedded ? 'section' : 'main';
  const contextLine = context && <p className="chat-context"><FileText size={15} aria-hidden="true" /><span>{embedded && context.sourceId === source?.sourceId ? 'Started from this source' : <>Started from <a href={noteUrl(context.sourceId)}>{context.title}</a></>}</span></p>;
  return <div ref={root} className={`discussion-chat${embedded ? ' is-embedded' : ''}`}>
    {!embedded && <aside className="chat-history" aria-label="Chat history">{historyList}</aside>}
    <Main {...(embedded ? { 'aria-label': 'Ask about this source' } : { id: 'main', tabIndex: -1 })} className={`chat-main${empty ? ' is-empty' : ''}`}>
      <header className="chat-toolbar">{embedded ? <h2>Ask</h2> : <h1>Chat</h1>}<div>
        {!embedded && <button type="button" className="chat-icon-button chat-history-toggle" aria-label="History" disabled={busy} onClick={() => { void refreshHistory(); setHistoryOpen(true); }}><History size={20} /></button>}
        {embedded && conversationId && <a className="chat-icon-button" href={`/?conversation=${conversationId}`} aria-label="Continue in Chat" title="Continue in Chat"><ExternalLink size={18} /></a>}
        <button type="button" className="chat-icon-button" aria-label="New chat" disabled={busy} onClick={newChat}><SquarePen size={19} /></button>
        {onClose && <button type="button" className="chat-icon-button" aria-label="Close" onClick={onClose}><X size={20} /></button>}
      </div></header>
      {!empty && contextLine}
      {empty ? <section className="chat-start" aria-labelledby={embedded ? undefined : 'chat-start-title'} aria-label={embedded ? 'New conversation' : undefined}>
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
              {turn.result ? <Answer turn={turn as Turn & { result: Result }} /> : <div className="chat-working">
                <p>{turn.failure || (stopping && turn.jobId === active?.id ? 'Stopping…' : 'Answering…')}</p>
                {turn.failure && <button className="chat-retry" type="button" disabled={busy} onClick={() => void send(turn)}>Retry</button>}
                {!!turn.activities?.length && <details><summary>Activity</summary><ul>{turn.activities.map((item, i) => <li key={i}>{item.tool === 'search_corpus' ? item.title : `${item.tool === 'inspect_media' ? 'Viewing' : 'Reading'}: ${item.title}`}</li>)}</ul></details>}
              </div>}
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
