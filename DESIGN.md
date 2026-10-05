---
name: Research reader prototype
description: Three throwaway layouts for finding and reading private research notes
colors:
  ink: "#202d3d"
  muted: "#546476"
  paper: "#ffffff"
  ground: "#edf1f5"
  line: "#d6dee7"
  blue: "#2356a5"
  blue-wash: "#eaf1fc"
  attention: "#8b4810"
  attention-wash: "#fff1df"
typography:
  body:
    fontFamily: "Source Sans 3, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.55
  reading-title:
    fontFamily: "Source Serif 4, serif"
    fontSize: "clamp(1.85rem, 3vw, 2.65rem)"
    fontWeight: 600
    lineHeight: 1.18
    letterSpacing: "-0.02em"
rounded:
  input: "6px"
  selection: "7px"
  limitation: "8px"
  switcher: "16px"
components:
  status:
    backgroundColor: "{colors.blue-wash}"
    textColor: "#284e81"
    rounded: "4px"
    padding: "0.2rem 0.5rem"
---

# Reader prototype design

## Overview

This branch explores a reader through a notebook margin, an evidence desk, and a library register. The parent implementation agent reviewed variant A's mobile structure and chose the notebook as the production direction. These files describe the prototype, not a requirement to merge its fixtures or route.

## Colors

White reading surfaces sit beside blue-gray library controls. Blue marks selection and links. Brown marks missing text and attention states, always accompanied by a written label.

## Typography

Source Sans 3 carries controls, source facts, and machine analysis. Source Serif 4 distinguishes the long reading title and human commentary. Body text measures at most 72 characters in variant A. Phones use a 16px base.

## Layout

The notebook uses a 255–300px library margin beside a reading column, within 1300px. At 720px and below it stacks the list and note. The evidence desk pairs source facts with interpretation; the register pairs source rows with the selected record. The 980px breakpoint reduces padding; the 720px breakpoint stacks broad regions.

## Elevation & Depth

Content uses surface color and one-pixel rules. The development switcher alone uses a soft offset shadow; it is absent from a production build.

## Shapes

Inputs have small rounded corners. Status labels are compact rectangles. Limitations use an eight-pixel corner. Long source notes remain an open reading surface.

## Components

Each source choice shows type, title, and review/processing state. Filters use visible labels and 44px controls. A note presents source facts, machine interpretation, limitations, and human commentary as separate sections. Mobile selection moves to the note, with a return control to the source list.

## Do's and Don'ts

- Do state missing text before presenting interpretation.
- Do preserve the written origin of every section.
- Do carry publication restrictions in source context.
- Do use a separate library route in production if a growing source list would precede the entire note on a phone.
- Don't promote synthetic research statements or prototype routes into the corpus.
