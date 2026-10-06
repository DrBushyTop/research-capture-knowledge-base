# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro static reader from the implementation brief. TypeScript worker and shared schemas selected under the user's delegated judgement on 2026-10-05.

## Users

Two signed-in people, pinaatti and DrBushyTop, are the only readers and both are admins. They save sources through Zotero on Android and desktop, then find, read and discuss them on either device. Either admin configures categories and analysis templates in the app without technical knowledge. Desktop capture still requires user acceptance testing.

## Product Purpose

A private personal corpus for research, news, recipes, guides, social posts and other saved material. Source facts, generated analysis and human notes remain distinguishable.

## Operating Context

Capture happens in Zotero. Processing happens asynchronously. Canonical notes are Markdown and JSON in a private GitHub repository. The signed-in reader offers search, filters and freeform chat. The Categories page edits templates (name, when to use, ordered analysis sections shown as paragraph, bullets or numbered steps), previews a draft on one saved document, and starts separate document updates. Saving affects future captures only. Settings are versioned privately; no Git or JSON editing. The reader is private only. Public presentation is deferred and has no UI.

## Capabilities and Constraints

Human notes survive reprocessing. Source artifacts remain private and outside Git. Publication eligibility is explicit and conservative. The four initial MVP phases are implemented. Editable categories, category-specific analysis and bulk re-evaluation are the next extension described in the brief. Existing notes stay readable during re-evaluation.

## Evidence on Hand

The brief and CONTEXT.md define product behavior. Android captures and a cloud PDF have been verified. Prototype content is synthetic; the production reader uses the real validated corpus. No medical recommendations or public publication are authorized.

## Product Principles

- Make facts distinguishable from interpretation.
- Show missing text and review needs beside the source.
- Keep finding and reading comfortable on phone and desktop.
- Preserve human commentary.

## Interface copy

Use functional labels and necessary instructions. Omit slogans, taglines and descriptive filler such as "Your research, ready to read" or "All your documents, searchable". Chat is a freeform conversation. The model searches and inspects the corpus; users do not select a source or PDF page before asking. Citations open supporting evidence, with tap support on phones.
