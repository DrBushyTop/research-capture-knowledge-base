import { useEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import * as Popover from '@radix-ui/react-popover';
import { ArrowUp, Check, Copy, FileText, History, Link, Minus, Plus, RotateCcw, Square, X } from 'lucide-react';
import { Conversation, ConversationContent, ConversationScrollButton } from './ai-elements/conversation';
import { Message, MessageContent, MessageResponse } from './ai-elements/message';
import { InlineCitation, InlineCitationQuote, InlineCitationSource } from './ai-elements/inline-citation';
import type { ChatActivity, ChatAsset, ChatConversation, ChatJob } from '../../../../shared/chat';
import '../styles/chat.css';

type Result = NonNullable<ChatJob['result']>;
type Citation = Result['citations'][number];
type Turn = { jobId: string; question: string; result?: Result; failure?: string; activities?: ChatActivity[] };
type HistoryItem = { id: string; title: string; updatedAt: string };
type Active = { id: string; conversationId: string; question: string };
const endpoint = '/api/chat';
const fileUrl = (jobId: string, params: Record<string, string>) => `${endpoint}?${new URLSearchParams({ id: jobId, ...params })}`;
const safeUrl = (value?: string | null) => value && /^https?:\/\//i.test(value) ? value : undefined;
const origin = { source: 'Document text', machine: 'Generated analysis', human: 'Human notes', metadata: 'Source facts', visual: 'Page or image' };

class RequestError extends Error { constructor(message: string, readonly status: number) { super(message); } }

async function request<T>(path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(endpoint + path, { credentials: 'same-origin', signal,
    ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  if (response.status === 401 || response.status === 403 || !response.headers.get('content-type')?.includes('application/json')) throw new RequestError('Sign in with an invited account to use chat.', 403);
  const value = await response.json();
  if (!response.ok) throw new RequestError(value.error || 'Chat is unavailable. Try again.', response.status);
  return value as T;
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

function CitationDetail({ cite, jobId }: { cite: Citation; jobId: string }) {
  return <>
    <InlineCitationSource title={cite.title} className="chat-citation-source">
      <p className="chat-citation-location">{origin[cite.kind]} · {cite.locator}</p>
    </InlineCitationSource>
    {cite.assetId && <a className="chat-cited-image" href={fileUrl(jobId, { asset: cite.assetId })} target="_blank" rel="noreferrer"><img src={fileUrl(jobId, { asset: cite.assetId })} alt={cite.title} loading="lazy" />Open image</a>}
    {(cite.quote || cite.excerpt) && <InlineCitationQuote className="chat-citation-quote">{cite.quote || cite.excerpt}</InlineCitationQuote>}
    <div className="chat-source-links">
      <a href={`/research/${encodeURIComponent(cite.sourceId)}/`} target="_blank" rel="noreferrer">Open note</a>
      {cite.pdf && <a href={fileUrl(jobId, { file: cite.sourceId, evidence: cite.evidenceId })} target="_blank" rel="noreferrer">Open PDF</a>}
      {safeUrl(cite.sourceUrl) && <a href={safeUrl(cite.sourceUrl)} target="_blank" rel="noreferrer">Open site</a>}
    </div>
  </>;
}

function CitationButton({ cite, number, jobId }: { cite: Citation; number: number; jobId: string }) {
  // Markdown blocks can retain their anchor renderer across viewport changes.
  const phone = usePhone();
  const [open, setOpen] = useState(false);
  const close = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(close.current), []);
  const enter = () => { clearTimeout(close.current); setOpen(true); };
  const leave = () => { close.current = setTimeout(() => setOpen(false), 180); };
  const button = <button className="chat-citation-button" type="button" aria-label={`Source ${number}: ${cite.title}`}>{number}</button>;
  if (phone) return <InlineCitation><Dialog.Root open={open} onOpenChange={setOpen}>
    <Dialog.Trigger asChild>{button}</Dialog.Trigger>
    <Dialog.Portal><Dialog.Overlay className="chat-overlay" /><Dialog.Content className="chat-sheet chat-evidence-sheet" aria-describedby={undefined}>
      <Dialog.Title className="chat-sheet-title">Source {number}</Dialog.Title>
      <Dialog.Close className="chat-icon-button chat-sheet-close" aria-label="Close source"><X size={20} /></Dialog.Close>
      <CitationDetail cite={cite} jobId={jobId} />
    </Dialog.Content></Dialog.Portal>
  </Dialog.Root></InlineCitation>;
  return <InlineCitation><Popover.Root open={open} onOpenChange={setOpen}>
    <Popover.Trigger asChild><button className="chat-citation-button" type="button" onPointerEnter={event => { if (event.pointerType === 'mouse') enter(); }} onPointerLeave={event => { if (event.pointerType === 'mouse') leave(); }} aria-label={`Source ${number}: ${cite.title}`}>{number}</button></Popover.Trigger>
    <Popover.Portal><Popover.Content className="chat-source-popover" sideOffset={8} collisionPadding={16} onPointerEnter={event => { if (event.pointerType === 'mouse') enter(); }} onPointerLeave={event => { if (event.pointerType === 'mouse') leave(); }} onOpenAutoFocus={event => event.preventDefault()}>
      <CitationDetail cite={cite} jobId={jobId} />
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

function Attachment({ asset, jobId }: { asset: ChatAsset; jobId: string }) {
  const url = fileUrl(jobId, { asset: asset.id });
  if (asset.kind === 'image') return <Dialog.Root>
    <figure className="chat-image"><Dialog.Trigger asChild><button type="button" aria-label={`Expand ${asset.title}${asset.page ? `, page ${asset.page}` : ''}`}>
      <img src={url} alt={`${asset.title}${asset.page ? `, page ${asset.page}` : ''}`} loading="lazy" />
    </button></Dialog.Trigger><figcaption>{asset.title}{asset.page ? ` · Page ${asset.page}` : ''}</figcaption></figure>
    <Dialog.Portal><Dialog.Overlay className="chat-overlay" /><ImageViewer url={url} title={`${asset.title}${asset.page ? ` · Page ${asset.page}` : ''}`} /></Dialog.Portal>
  </Dialog.Root>;
  const href = asset.kind === 'site' ? safeUrl(asset.sourceUrl) : url;
  if (!href) return null;
  return <a className="chat-file" href={href} target="_blank" rel="noreferrer">
    {asset.kind === 'pdf' ? <FileText size={22} /> : <Link size={22} />}<span>{asset.title}<small>{asset.kind === 'pdf' ? 'PDF' : 'Website'}</small></span>
  </a>;
}

function Answer({ turn }: { turn: Turn & { result: Result } }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  const citations = turn.result.citations;
  const text = turn.result.answer.replace(/\[(e_[a-f0-9]{16})\]/g, (_, id: string) => `[${citations.findIndex(cite => cite.evidenceId === id) + 1}](#cite-${id})`);
  const copy = async () => {
    try { await navigator.clipboard.writeText(turn.result.answer.replace(/\[e_[a-f0-9]{16}\]/g, '')); setCopied(true); timer.current = setTimeout(() => setCopied(false), 2000); } catch { /* Clipboard permission can be unavailable. */ }
  };
  return <Message from="assistant" className="chat-message chat-assistant"><MessageContent>
    <MessageResponse className="chat-markdown" mode="static" controls={false} components={{
      a: ({ href, children }) => {
        const id = href?.match(/^#cite-(e_[a-f0-9]{16})$/)?.[1];
        const number = citations.findIndex(cite => cite.evidenceId === id);
        if (number >= 0) return <CitationButton cite={citations[number]} number={number + 1} jobId={turn.jobId} />;
        return safeUrl(href) ? <a href={href} target="_blank" rel="noreferrer">{children}</a> : <span>{children}</span>;
      },
      img: ({ alt }) => <span>{alt}</span>
    }}>{text}</MessageResponse>
    {!!turn.result.attachments.length && <div className="chat-attachments">{turn.result.attachments.map(asset => <Attachment key={asset.id} asset={asset} jobId={turn.jobId} />)}</div>}
    {!!citations.length && <details className="chat-sources"><summary>{citations.length === 1 ? '1 source' : `${citations.length} sources`}</summary><div>
      {citations.map((cite, i) => <div key={cite.evidenceId}><CitationButton cite={cite} number={i + 1} jobId={turn.jobId} /><span>{cite.title}</span></div>)}
    </div></details>}
    <button type="button" className="chat-icon-button chat-copy" aria-label={copied ? 'Copied' : 'Copy answer'} onClick={() => void copy()}>{copied ? <Check size={16} /> : <Copy size={16} />}</button>
  </MessageContent></Message>;
}

export default function Chat() {
  const phone = usePhone();
  const root = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [conversationId, setConversationId] = useState<string>();
  const [active, setActive] = useState<Active>();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const busy = !!active || sending || loading;
  const refreshHistory = async () => { try { setHistory(await request<HistoryItem[]>('?conversations=1')); } catch { /* A send or open reports authentication errors. */ } };
  const openConversation = async (id: string) => {
    setHistoryOpen(false); setLoading(true); setError('');
    try {
      const value = await request<ChatConversation>(`?conversation=${id}`);
      setConversationId(id); setTurns(value.turns); localStorage.setItem('research-chat', id);
    } catch (error) { setError((error as Error).message); } finally { setLoading(false); }
  };

  useEffect(() => {
    let live = true;
    const restore = async () => {
      try {
        const recent = localStorage.getItem('research-chat');
        const pending: Active | undefined = JSON.parse(sessionStorage.getItem('research-chat-active') || 'null') || undefined;
        const id = pending?.conversationId || recent;
        if (id) {
          const value = await request<ChatConversation>(`?conversation=${id}`);
          if (!live) return;
          setConversationId(id); setTurns(pending && !value.turns.some(turn => turn.jobId === pending.id) ? [...value.turns, { jobId: pending.id, question: pending.question }] : value.turns);
          if (pending) setActive(pending);
        }
      } catch { localStorage.removeItem('research-chat'); sessionStorage.removeItem('research-chat-active'); }
      finally { if (live) { setLoading(false); void refreshHistory(); } }
    };
    void restore();
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
  }, [question]);

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
          setActive(undefined); setStopping(false); sessionStorage.removeItem('research-chat-active');
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
            setActive(undefined); setStopping(false); sessionStorage.removeItem('research-chat-active'); setAnnouncement('Answer unavailable');
          } else timer = setTimeout(() => void poll(), 5000);
        }
      }
    };
    void poll(); return () => { controller.abort(); clearTimeout(timer); };
  }, [active?.id]);

  const send = async (retryQuestion?: string) => {
    if (busy || !(retryQuestion || question).trim()) return;
    setSending(true); setError('');
    const submitted = (retryQuestion || question).trim();
    try {
      const job = await request<{ id: string; conversationId: string }>('', { question: submitted, ...(conversationId ? { conversationId } : {}) });
      const next = { ...job, question: submitted };
      setConversationId(job.conversationId); localStorage.setItem('research-chat', job.conversationId); sessionStorage.setItem('research-chat-active', JSON.stringify(next));
      setTurns(previous => [...previous, { jobId: job.id, question: submitted }]); setActive(next); if (!retryQuestion) setQuestion(''); setAnnouncement('Answering');
    } catch (error) { setError((error as Error).message); } finally { setSending(false); }
  };
  const stop = async () => {
    if (!active || stopping) return;
    setStopping(true);
    try { await request('', { action: 'cancel', id: active.id }); } catch (error) { setError((error as Error).message); setStopping(false); }
  };
  const newChat = () => { setConversationId(undefined); setTurns([]); setQuestion(''); setError(''); setHistoryOpen(false); localStorage.removeItem('research-chat'); input.current?.focus(); };
  const historyList = <><button className="chat-new" type="button" disabled={busy} onClick={newChat}><Plus size={18} />New chat</button><h2>History</h2>
    {history.length ? <ul>{history.map(item => <li key={item.id}><button type="button" aria-current={item.id === conversationId ? 'page' : undefined} disabled={busy} onClick={() => void openConversation(item.id)}>{item.title}</button></li>)}</ul> : <p className="chat-history-empty">No conversations</p>}</>;

  return <div ref={root} className="discussion-chat">
    <aside className="chat-history" aria-label="Chat history">{historyList}</aside>
    <main id="main" className="chat-main" tabIndex={-1}>
      <header className="chat-toolbar"><h1>Chat</h1><div>
        <button type="button" className="chat-icon-button chat-history-toggle" aria-label="History" disabled={busy} onClick={() => { void refreshHistory(); setHistoryOpen(true); }}><History size={20} /></button>
        <button type="button" className="chat-icon-button" aria-label="New chat" disabled={busy} onClick={newChat}><Plus size={21} /></button>
      </div></header>
      <Conversation className="chat-conversation" aria-label="Conversation" aria-live="off" initial="instant" resize="instant">
        <ConversationContent className="chat-messages">
          {turns.map(turn => <div className="chat-turn" key={turn.jobId}>
            <Message from="user" className="chat-message chat-user"><MessageContent>{turn.question}</MessageContent></Message>
            {turn.result ? <Answer turn={turn as Turn & { result: Result }} /> : <div className="chat-working">
              <p>{turn.failure || (stopping && turn.jobId === active?.id ? 'Stopping…' : 'Answering…')}</p>
              {turn.failure && <button className="chat-retry" type="button" disabled={busy} onClick={() => void send(turn.question)}>Retry</button>}
              {!!turn.activities?.length && <details><summary>Activity</summary><ul>{turn.activities.map((item, i) => <li key={i}>{item.tool === 'search_corpus' ? item.title : `${item.tool === 'inspect_media' ? 'Viewing' : 'Reading'}: ${item.title}`}</li>)}</ul></details>}
            </div>}
          </div>)}
        </ConversationContent>
        <ConversationScrollButton aria-label="Scroll to latest message" className="chat-scroll-button" />
      </Conversation>
      <div className="chat-composer-area">
        {error && <div className="chat-error" role="alert"><p>{error}</p>{error.startsWith('Sign in') && <a href="/.auth/login/github?post_login_redirect_uri=/chat/">Sign in</a>}</div>}
        <form className="chat-composer" onSubmit={event => { event.preventDefault(); void send(); }}>
          <label className="chat-sr-only" htmlFor="chat-message">Message</label>
          <textarea ref={input} id="chat-message" rows={1} maxLength={8000} value={question} placeholder="Message" onChange={event => setQuestion(event.target.value)} onKeyDown={event => {
            if (!phone && event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); }
          }} />
          {active ? <button className="chat-send" type="button" aria-label={stopping ? 'Stopping' : 'Stop'} disabled={stopping} onClick={() => void stop()}><Square size={17} fill="currentColor" /></button>
            : <button className="chat-send" type="submit" aria-label="Send" disabled={busy || !question.trim()}><ArrowUp size={22} /></button>}
        </form>
      </div>
      <p className="chat-sr-only" role="status" aria-live="polite">{announcement}</p>
    </main>
    <Dialog.Root open={historyOpen} onOpenChange={setHistoryOpen}><Dialog.Portal><Dialog.Overlay className="chat-overlay" /><Dialog.Content className="chat-history-drawer" aria-describedby={undefined}>
      <Dialog.Title className="chat-sr-only">Chat history</Dialog.Title><Dialog.Close className="chat-icon-button chat-sheet-close" aria-label="Close history"><X size={20} /></Dialog.Close>{historyList}
    </Dialog.Content></Dialog.Portal></Dialog.Root>
  </div>;
}
