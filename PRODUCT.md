# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Astro static reader from the implementation brief. TypeScript worker and shared schemas selected under the user's delegated judgement on 2026-10-05.

## Users

One person captures research through Zotero on Android and desktop, then finds and reads it later on either device. Desktop capture still requires user acceptance testing.

## Product Purpose

A private personal research corpus that keeps source facts, machine interpretation, limitations, and human notes distinguishable.

## Operating Context

Capture happens in Zotero. Processing happens asynchronously. Canonical notes are Markdown and JSON in a private GitHub repository. The signed-in reader offers static search and topic, source-type, and publication-year filters.

## Capabilities and Constraints

Human notes survive reprocessing. Source artifacts remain private and outside Git. Publication eligibility is explicit and conservative. All four MVP phases are in scope. The user delegated implementation and visual choices; the background reader prototype established the notebook composition.

## Evidence on Hand

The brief and CONTEXT.md define product behavior. Android captures and a cloud PDF have been verified. Prototype content is synthetic; the production reader uses the real validated corpus. No medical recommendations or public publication are authorized.

## Product Principles

- Make facts distinguishable from interpretation.
- Show missing text and review needs beside the source.
- Keep finding and reading comfortable on phone and desktop.
- Preserve human commentary.

## Interface copy

Use functional labels and necessary instructions. Omit slogans, taglines and descriptive filler such as "Your research, ready to read" or "All your documents, searchable". Chat is a freeform conversation. The model searches and inspects the corpus; users do not select a source or PDF page before asking. Citations open supporting evidence, with tap support on phones.
