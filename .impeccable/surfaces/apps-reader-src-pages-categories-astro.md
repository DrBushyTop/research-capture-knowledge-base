---
version: 1
slug: "apps-reader-src-pages-categories-astro"
primary_target: "apps/reader/src/components/Categories.tsx"
related_targets: ["apps/reader/src/styles/categories.css", "apps/reader/src/app/Layout.tsx", "apps/reader/src/styles/reader.css"]
---

# Categories admin

Mode: Operate. Either admin (pinaatti, DrBushyTop) edits category templates, tries a draft on one saved document, and starts document updates. Users are not technical, so labels describe effects in plain words and every model call is stated before it happens.

## Direction contract

THESIS: Edit a template, check it, save it for future captures, then decide separately which existing documents to update.

OWN-WORLD: Reader palette with the navy masthead, Source Sans 3 controls, Source Serif 4 for category names and document titles, white panels on the cool ground, 2px ink rules under page and list headers.

STORY: Templates tab edits and previews. Documents tab selects and confirms with count and cost. Updates tab shows queued, processing, updating reader, done, failed (retry), replaced by newer update, stopped.

Evidence: `.impeccable/review/categories-*.png` (desktop 1440 and iPhone 14, synthetic mock on port 8772).
