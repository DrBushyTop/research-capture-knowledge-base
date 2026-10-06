---
version: 1
slug: "apps-reader-src-pages-chat"
primary_target: "apps/reader/src/pages/chat/[...path].astro"
related_targets: ["apps/reader/src/chat.ts", "apps/reader/src/components/Layout.astro", "apps/reader/src/styles/reader.css"]
---

# Ask your collection

Mode: Operate. Extend the existing research notebook world recorded in DESIGN.md.

The reader asks a question, waits for evidence gathering, then checks source citations. Keep the source scope and optional PDF page in the library margin. The white reading page holds a continuous conversation and a labeled question field. Use the existing Source Serif 4 title voice, Source Sans 3 machine interpretation, paper, blue controls, thin rules, and 72ch reading measure.

The private-only route must expose waiting, failure, expired-session and empty-collection states. Answers render as text. Each citation links to a saved note and identifies the evidence origin and PDF page or passage. Keep the form usable on Android widths and expose state changes to assistive technology. No new visual world or raster assets.

## Direction contract

THESIS: Follow a question through stored evidence. A continuous reading page keeps each answer beside its numbered citations and supplied passages.

OWN-WORLD: Extend the cool margin, white paper, blue controls, thin rules, and flat depth. Source Serif 4 carries the page title and submitted questions; Source Sans 3 carries machine answers and controls.

STORY: Choose the collection or a saved source, optionally request a stored page or image, ask a question, then inspect the cited evidence.

FIRST VIEWPORT: A 250px to 290px desktop margin holds source scope and the optional page selector. The white page contains an opening prompt and a labeled question field with the primary action below it, within 72ch. At 720px and below, the margin and reading page stack.

FORM: Code-led ordinary extension of the recorded research notebook. Preserve incumbent world seed 64af9218 from the reader brief; this extension introduces no new world or seed. Numbered citations connect each answer to its evidence list. Completion focuses the answer heading when focus remains in the form, and preserves focus elsewhere. Motion follows the incumbent reader.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
