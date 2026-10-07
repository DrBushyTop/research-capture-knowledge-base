---
version: 1
slug: "apps-reader-src-pages-index-astro"
primary_target: "apps/reader/src/components/Sources.tsx"
related_targets: ["apps/reader/src/styles/sources.css", "apps/reader/src/app/Layout.tsx", "apps/reader/src/styles/reader.css", "apps/reader/src/components/ReaderNotes.tsx", "apps/reader/src/components/OriginalText.tsx", "apps/reader/src/components/SourceAsk.tsx", "apps/reader/src/lib/usePhone.ts"]
---

# Reader surface

Mode: Read. Scope: the private Sources list and selected-source reading pane at `/sources/`. The user delegated judgement; the background prototype established the notebook direction. This production surface extends that world, with code-led implementation.

## Direction contract

THESIS: A library margin gives finding a place beside sustained reading. Evidence origins remain visible in the note.

OWN-WORLD: Cool white reading surfaces, blue selection, Source Sans 3 controls and Source Serif 4 note titles. Simple rows and readable sections carry the collection.

STORY: Find a saved source, read its interpretation and limitations, then return to personal commentary.

FIRST VIEWPORT: A 280px to 330px source list beside a reading pane without a line-length cap. The list starts with search and a Filters button for category, topic, type, and year. Browsing groups newest saves by Last 7 days and month; search keeps relevance order. A note begins with category, source type, date, serif title, authors, and source actions. Generated summary, analysis sections, human notes, original text, and Details follow. At 720px and below, the selected source in the URL switches between list and reading views; filters open in a bottom sheet and section navigation becomes a native select. Desktop list and reading panes scroll independently.

FORM: Notebook composition from prototype variant A; existing-world surface seed 64af9218. The delegated direction preserves the tested prototype rather than asking for another aesthetic choice.

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
