import { useLayoutEffect, useRef } from 'react';
import { MessageResponse, type MessageResponseProps } from './ai-elements/message';

/** Reveal newly mounted Markdown blocks without replaying earlier paragraphs. */
export function ChatResponse({ reveal, className, ...props }: MessageResponseProps & { reveal: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = container.current;
    if (!reveal || !element) return;
    const seen = new WeakSet<Element>();
    const revealBlocks = () => {
      const markdown = element.querySelector('.chat-markdown');
      if (!markdown) return;
      for (const block of markdown.children) {
        if (seen.has(block)) continue;
        seen.add(block);
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) block.classList.add('chat-text-reveal');
      }
    };
    const clearReveal = (event: AnimationEvent) => {
      if (event.animationName === 'chat-text-reveal' && event.target instanceof Element) event.target.classList.remove('chat-text-reveal');
    };
    revealBlocks();
    // Also catch the lazy Markdown renderer becoming ready after the first render.
    const observer = new MutationObserver(revealBlocks);
    observer.observe(element, { childList: true, subtree: true });
    element.addEventListener('animationend', clearReveal);
    element.addEventListener('animationcancel', clearReveal);
    return () => {
      observer.disconnect();
      element.removeEventListener('animationend', clearReveal);
      element.removeEventListener('animationcancel', clearReveal);
    };
  }, [reveal]);
  return <div ref={container} className={className}><MessageResponse className="chat-markdown" mode="static" controls={false} {...props} /></div>;
}
