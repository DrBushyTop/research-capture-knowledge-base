---
name: Research library
description: A private research notebook with a library margin and readable evidence sections.
colors:
  ink: "#202d3d"
  muted: "#546476"
  paper: "#fff"
  ground: "#edf1f5"
  line: "#d6dee7"
  blue: "#2356a5"
  blue-wash: "#eaf1fc"
  status-ink: "#284e81"
  attention: "#8b4810"
  attention-wash: "#fff1df"
  field-line: "#a8b5c5"
  limitations-surface: "#f2f5f8"
typography:
  display:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "clamp(1.9rem, 3vw, 2.7rem)"
    fontWeight: 600
    lineHeight: 1.17
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Source Sans 3 Variable, system-ui, sans-serif"
    fontSize: "1.22rem"
    fontWeight: 700
    lineHeight: 1.3
  title:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "1.5rem"
    fontWeight: 700
    lineHeight: 1.4
  body:
    fontFamily: "Source Sans 3 Variable, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 400
    lineHeight: 1.6
  human-prose:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "1.08rem"
    fontWeight: 400
    lineHeight: 1.75
  label:
    fontFamily: "Source Sans 3 Variable, system-ui, sans-serif"
    fontSize: "0.85rem"
    fontWeight: 600
    lineHeight: 1.6
  status:
    fontFamily: "Source Sans 3 Variable, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 400
    lineHeight: 1.6
rounded:
  status: "4px"
  field: "6px"
  limitations: "8px"
spacing:
  small: "0.5rem"
  standard: "1rem"
  section-inset: "1.5rem"
  section-gap: "2.7rem"
components:
  search-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0.55rem 0.65rem"
    width: "100%"
  filter-select:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0.55rem 0.65rem"
    width: "100%"
  source-row:
    textColor: "{colors.ink}"
    padding: "1.5rem 0"
  note-navigation:
    textColor: "{colors.blue}"
    padding: "0.5rem 0"
  status-default:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.status-ink}"
    typography: "{typography.status}"
    rounded: "{rounded.status}"
    padding: "0.2rem 0.5rem"
  status-attention:
    backgroundColor: "{colors.attention-wash}"
    textColor: "{colors.attention}"
    typography: "{typography.status}"
    rounded: "{rounded.status}"
    padding: "0.2rem 0.5rem"
  limitations-section:
    backgroundColor: "{colors.limitations-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.limitations}"
    padding: "1.2rem 1.4rem"
---

# Design System: Research library

## Overview

**Creative North Star: "The research notebook"**

A cool gray library margin sits beside a white reading page. Source Sans 3 carries controls, source facts, and machine interpretation. Source Serif 4 gives saved titles and personal commentary a different reading rhythm.

The notebook separates evidence origins through headings, rules, and status text. It keeps the source citation and review state close to the title. The recorded system covers the shipped library and research note routes in `apps/reader`.

**Key Characteristics:**

- A library margin beside a white reading page.
- Full-width source rows with serif titles and short sans serif summaries.
- Separate sections for source facts, machine interpretation, limitations, and human notes.
- Text labels beside color-coded review states.

## Colors

The palette pairs cool paper and blue interaction states with a warm warning treatment for limited evidence.

### Primary

- Blue identifies links, topic text, caret color, and keyboard focus.
- Blue wash and status ink identify the default unreviewed machine interpretation state.

### Secondary

- Attention and attention wash identify limited evidence and extraction notices.

### Neutral

- Ink carries titles and body text. Muted carries citations, metadata, helper text, and summaries.
- Paper fills the masthead and reading page. Ground fills the library margin and the outer page.
- Line separates source rows and evidence sections. Field line defines native input and select boundaries.
- Limitations surface groups open questions within the reading page.

**The Review Text Rule.** Every review state includes a text label. Color supplements the label.

## Typography

Source Serif 4 is the display and source-title face, with Georgia as its fallback. Source Sans 3 is the body and control face, with system-ui and sans-serif fallbacks. Both variable fonts are imported by the shared layout.

### Hierarchy

- Display is the research note title. Mobile sets it to 2rem. Titles use balanced wrapping and can break long unspaced source text.
- Headline is the note section heading. The collection heading uses a larger 1.8rem size; the library margin heading uses 1.6rem.
- Title is the source-row heading. Mobile reduces it to 1.35rem.
- Body is the default reading text. The root size makes all rem measurements relative to 17px.
- Human prose is the serif commentary role. Its wider line spacing distinguishes personal writing from machine interpretation.
- Label is the visible filter label. Mobile reduces filter labels to 0.75rem and select text to 0.8rem.
- Status is the compact review badge role. Citations, source metadata, and helper text use smaller sans serif sizes within the same family.

**The Two Reading Voices Rule.** Use Source Sans 3 for facts, machine interpretation, and controls. Use Source Serif 4 for source titles and human commentary.

## Layout

The desktop shell is a two-column grid capped at 1300px. Its margin column spans 250px to 290px; the remaining width holds the white page. The research article is centered within that page and capped at 72ch. Source summaries are capped at 70ch and clamped to three lines in the collection.

The masthead has a 64px minimum height. Desktop margins use 2.5rem vertical and 1.5rem horizontal padding. The reading page uses 3rem top padding, responsive horizontal padding, and 4rem bottom padding. Sections follow the recorded section gap; machine interpretation and human notes add an inset above their dividing line.

At 720px and below, the shell becomes one column. Library search spans the full row, with the three filters arranged underneath in equal columns. The note margin shows a text link back to saved sources. Its section navigation and privacy helper are hidden. Source facts become one column, and reading pages use 1.2rem horizontal padding.

**The Reading Width Rule.** Keep research articles within the 72ch reading column, including long titles, citations, and source URLs.

## Elevation & Depth

The reader has no shadows. White paper, cool gray margins, pale status backgrounds, and thin dividing lines establish grouping. Limitation sections have a pale inset background; source rows remain part of the continuous page.

## Shapes

Native fields have modest rounded corners. Review labels are slightly squarer, and the limitations block uses the largest recorded corner radius. Source rows and the reading page have square outer edges. Divider lines are one pixel wide.

## Components

### Inputs / Fields

Search and filters use native controls with a white fill, field-line border, and field radius. They fill their available column and have a 44px minimum height. Search has a visible label above its placeholder; every select has its own visible label.

Keyboard focus uses a 3px blue outline with a 4px offset. The placeholder uses a muted slate color. Search announces its result count, pending state, or load failure through a polite status region. When no source matches, the reading page gives a text prompt to change the search or clear a filter.

### Chips

Review badges are informational labels. Default machine status uses blue wash with status ink; limited evidence uses attention wash with attention text. Topics appear as slash-separated text, with a native disclosure for the complete list when more than three topics exist.

### Cards / Containers

Source rows have a bottom divider and a full-row link. Each row contains source type and year, a serif title, a short summary, and a review badge. Hover changes the title to blue and underlines it. Long unspaced titles wrap within the row.

The limitations section uses its own pale fill and rounded boundary. Extraction notices use the warm attention fill with a 1rem inset. Machine interpretation and human notes begin after a dividing line.

### Navigation

The masthead names the library, shows the collection's access state, and offers sign-out in private mode. The desktop note margin links to source facts, machine interpretation, limitations, and human notes. Each section link has a 44px minimum target height and underlines on hover.

The return link says "Back to saved sources" on desktop and mobile. A skip link becomes visible on focus. Links and native disclosures retain their text and browser semantics.

### Evidence and commentary

Source facts use a two-column definition list on desktop. Claim evidence has a thin left border and muted text inside a native disclosure. Human commentary uses the serif prose role; an empty commentary region shows a sans serif empty-state message.

The reader limits color transitions to 0.15s ease-out when reduced motion is not requested. No animated layout or entrance effects are present.

## Do's and Don'ts

### Do:

- Do pair the cool library margin with a white reading page.
- Do keep source facts, machine interpretation, limitations, and human notes in separate labeled sections.
- Do retain a visible label for search and every filter.
- Do keep source titles and personal commentary in the serif reading voice.
- Do give keyboard focus the recorded blue outline and preserve 44px control and navigation targets.
- Do keep long source titles and URLs within the reading column.

### Don't:

- Don't communicate review state through color alone.
- Don't use the limited-evidence warning treatment for the default machine interpretation state.
- Don't apply shadows to the reader's flat rows and reading page.

Not canonized: the standalone sign-in page uses system-ui for its display heading and body instead of the shared reader type system. This existing drift remains outside the recorded typography rules; this documentation pass does not repair it.
