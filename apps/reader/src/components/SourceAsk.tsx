import { lazy, Suspense, useEffect, useRef, useState } from 'react';

const Chat = lazy(() => import('./Chat'));

const overlayQuery = '(max-width: 1199px)';

/** Conversation panel beside a source. Buttons marked data-ask-open in the page open it.
 * Below the three-column breakpoint the panel covers the page, so it becomes a modal dialog with an inert background. */
export default function SourceAsk({ sourceId, title }: { sourceId: string; title: string }) {
  const panel = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [overlay, setOverlay] = useState(false);
  const close = () => {
    setOpen(false);
    // Wait for the page to show its Ask buttons again; the phone button is hidden while the panel is open.
    setTimeout(() => {
      const target = trigger.current?.isConnected && trigger.current.getClientRects().length ? trigger.current : [...document.querySelectorAll<HTMLElement>('[data-ask-open]')].find(button => button.getClientRects().length);
      target?.focus();
    }, 50);
  };
  useEffect(() => {
    const media = window.matchMedia(overlayQuery);
    const update = () => setOverlay(media.matches);
    update(); media.addEventListener('change', update);
    const shell = document.querySelector<HTMLElement>('.sources-shell');
    const show = (button?: HTMLElement) => { trigger.current = button || null; setOpen(true); setMounted(true); };
    const click = (event: MouseEvent) => { const button = (event.target as Element).closest<HTMLElement>('[data-ask-open]'); if (button) show(button); };
    document.addEventListener('click', click);
    if (location.hash === '#ask') show();
    return () => { media.removeEventListener('change', update); document.removeEventListener('click', click); shell?.removeAttribute('data-ask'); };
  }, [sourceId]);
  useEffect(() => {
    document.querySelector<HTMLElement>('.sources-shell')?.toggleAttribute('data-ask', open);
    document.querySelectorAll('[data-ask-open]').forEach(button => button.setAttribute('aria-expanded', String(open)));
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      // Nested citation and image dialogs handle their own Escape.
      if (event.key !== 'Escape' || event.defaultPrevented || document.querySelector('[role=dialog]:not(#source-ask)')) return;
      close();
    };
    document.addEventListener('keydown', key);
    let tries = 0;
    const focus = setInterval(() => { const input = panel.current?.querySelector<HTMLTextAreaElement>('#chat-message'); if (input || ++tries > 40) { input?.focus(); clearInterval(focus); } }, 50);
    return () => { clearInterval(focus); document.removeEventListener('keydown', key); };
  }, [open]);
  useEffect(() => {
    if (!open || !overlay || !panel.current) return;
    // Everything except the panel's own ancestors. Portals opened later stay interactive.
    const node = panel.current;
    const covered = [...document.body.children, ...(document.querySelector('.sources-shell')?.children || [])]
      .filter((element): element is HTMLElement => element instanceof HTMLElement && !element.contains(node) && !element.inert && element.tagName !== 'SCRIPT');
    covered.forEach(element => { element.inert = true; });
    return () => covered.forEach(element => { element.inert = false; });
  }, [open, overlay]);
  const modal = open && overlay;
  return <div ref={panel} id="source-ask" className="source-ask" hidden={!open}
    {...(modal ? { role: 'dialog', 'aria-modal': true, 'aria-label': `Ask about ${title}` } : {})}>
    {mounted && <Suspense fallback={<p className="source-ask-loading" role="status">Loading chat…</p>}>
      <Chat embedded source={{ sourceId, title }} onClose={close} />
    </Suspense>}
  </div>;
}
