---
version: 1
slug: "apps-reader-src-pages-chat"
primary_target: "apps/reader/src/components/Chat.tsx"
related_targets: ["apps/reader/src/styles/chat.css", "apps/reader/src/app/Layout.tsx", "apps/reader/src/app/masthead.ts", "apps/reader/src/styles/reader.css", "apps/reader/src/lib/usePhone.ts"]
---

# Private chat

Mode: Operate. The reader sends messages and continues a discussion. Sol searches the saved corpus and reads or inspects documents when useful. The conversation retains recent turns, exposes inline citations, and can return images, PDFs and sites.

Use the established reader palette and typography with functional controls only. Desktop history uses the cool margin; phone history uses a drawer. The discussion uses the available horizontal space, with a visible bottom composer and tap-accessible evidence sheets. Phone image viewing permits zooming and panning. The model chooses corpus tools; global chat does not require a source or page selection. Source chat starts with a selected source as context but can still search the whole corpus.

## Direction contract

THESIS: Read and continue a freeform discussion. Sol decides when to search or inspect saved material. The message view and bottom composer are the main controls.

OWN-WORLD: Preserve the cool library margin, white page, Source Sans 3, blue controls and thin rules. Source titles in the note reader retain Source Serif 4. Chat uses the sans serif reading voice.

STORY: Send a message, continue the discussion, open an inline citation or returned file, and resume a recent conversation from history. Keep copy to functional labels and necessary instructions.

FIRST VIEWPORT: Chat fills the viewport width below the masthead. Desktop history sits in a 260px margin. Messages and the bottom composer fill the remaining white pane with responsive side padding and an 1180px cap. Desktop answer paragraphs and lists stay within 90ch, while charts and tables use the available width. At 720px and below history moves into a drawer. Standalone Chat portals History and New chat into the 52px masthead row and removes its own toolbar. Phone messages use 0.9rem side padding and the composer uses 0.6rem. Citation details open in a bottom sheet. Images fit within a full-screen phone viewer before zooming and panning.

FORM: Code-led extension of the incumbent reader, retaining world seed 64af9218. AI Elements conversation and Markdown primitives run within the React app. Inline citations show a source label and adjacent-source count, use validated source data, and support mouse hover, click, touch tap, and keyboard activation. A phone evidence sheet shows the actual cited thumbnail when available, an excerpt or quote, source location, and available note, PDF, site, and image links. Metadata supports source URLs, PDF availability, and asset IDs for newly captured and existing material.

Phone Enter adds a newline; desktop Enter sends and Shift+Enter adds a newline. IME composition does not send. Stop cancels an answer. Failed turns expose Retry without replacing an independent draft. Completion announces its state without focusing an answer heading. The composer shows focus through its blue border. Respect reduced motion and safe areas.

Returned images open with bounded zoom and pan. Phone viewing fills the viewport, with pinch, double tap, drag, plus and minus controls, reset, and keyboard controls. The implementation keeps the zoom scale between 100% and 600%. PDF and site attachments open their returned files or validated source URLs. The interface uses vector icons; document images are returned private-corpus assets.

FINISH: Review desktop discussion, phone discussion, evidence sheet, and image viewer states. Record source-code checks separately from browser emulation and physical-device acceptance. Keep DESIGN.md and its sidecar aligned with the shipped components. Review captures use synthetic chart data; they are evidence of UI behavior rather than corpus findings.

## Recorded evidence

The finish review verdict is ship. The documentation check on 2026-10-06 inspected `Chat.tsx`, `chat.css`, the route, shared evidence validation, and the final desktop and phone captures. The recorded layout and components agree with that source and those captures. The incumbent palette and typography tokens remain unchanged; the chat records add its observed states and components.

- [Desktop discussion](../review/desktop.png) shows the full-width pane, 240px history margin, wide returned chart, and bottom composer. The browser viewport was 1440 by 1000; the tool normalized the capture to 1280 by 889.
- [Phone discussion](../review/mobile.png) shows the history control, inline citation, returned image, and bottom composer at a 390 by 844 CSS-pixel viewport with device pixel ratio 2.
- [Phone evidence](../review/mobile-citation.png) shows the dim backdrop, Source 1 heading, actual cited thumbnail, supplied quote, and image, note, PDF, and site links in the bottom sheet.
- [Phone image viewer](../review/mobile-image.png) shows the full-width image with close, zoom, reset, and original-image controls.

The build's browser verification checked inline and expanded source-list citations after desktop-to-phone and phone-to-desktop viewport changes. They used the phone sheet and desktop popover as appropriate. It also measured the phone viewer image at 390 CSS pixels at 100% zoom and 585 CSS pixels at 150% zoom. Source review confirmed mouse-only hover handling, Retry preserving an independent draft, and citation-owned breakpoint state so retained Markdown blocks respond to viewport changes.

The chart and quoted passage are synthetic review fixtures. Source inspection covered the pinch, double tap, and pan handlers; these captures and browser checks do not certify physical Android gestures. The existing sign-in typography drift remains outside this chat update.

The 2026-10-07 documentation refresh checked current React source only. The captures above remain historical evidence, not verification of the current masthead, 260px history margin, 90ch answer measure, source-label citation pills, or updated composer. The composer now says "Ask your library", with "Ask about this source" in source chat. Source chat retains its own toolbar on phones. Activity summaries and answer actions use tightened negative margins recorded in DESIGN.md.
