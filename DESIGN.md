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
  blue-hover: "#194584"
  history-hover: "#dfe7f0"
  chat-error: "#8b3010"
  overlay: "rgb(20 30 45 / .38)"
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
  discussion:
    fontFamily: "Source Sans 3 Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
rounded:
  status: "4px"
  field: "6px"
  limitations: "8px"
  discussion: "12px"
  composer: "16px"
  composer-phone: "14px"
  circular: "50%"
spacing:
  small: "0.5rem"
  standard: "1rem"
  section-inset: "1.5rem"
  section-gap: "2.7rem"
  chat-pane-inset: "clamp(1rem, 3vw, 2.2rem)"
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
  chat-send:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.circular}"
    width: "44px"
    height: "44px"
  chat-send-hover:
    backgroundColor: "{colors.blue-hover}"
  chat-send-disabled:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.muted}"
  chat-composer:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.composer}"
    padding: "0.45rem"
    width: "100%"
  chat-composer-phone:
    rounded: "{rounded.composer-phone}"
  chat-citation:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.muted}"
    rounded: "{rounded.discussion}"
  chat-citation-open:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.blue}"
---

# Design System: Research library

## Overview

**Creative North Star: "The research notebook"**

A cool gray library margin sits beside a white reading page. Source Sans 3 carries controls, source facts, and machine interpretation. Source Serif 4 gives saved titles and personal commentary a different reading rhythm.

The notebook separates evidence origins through headings, rules, and status text. It keeps the source citation and review state close to the title. The recorded system covers the library, research note, and private chat routes in `apps/reader`. Chat carries the same colors and controls into a continuous sans serif discussion.

**Key Characteristics:**

- A library margin beside a white reading page.
- Full-width source rows with serif titles and short sans serif summaries.
- Separate sections for source facts, machine interpretation, limitations, and human notes.
- Text labels beside color-coded review states.
- A continuous chat page with inline evidence and a bottom composer.

## Colors

The palette pairs cool paper and blue interaction states with a warm warning treatment for limited evidence.

### Primary

- Blue identifies links, topic text, caret color, and keyboard focus.
- Blue wash and status ink identify the default unreviewed machine interpretation state.
- Chat uses blue for Send and darker blue for its hover state. An open citation uses blue text on blue wash.

### Secondary

- Attention and attention wash identify limited evidence and extraction notices.
- Chat error text uses a darker warm ink beside the composer.

### Neutral

- Ink carries titles and body text. Muted carries citations, metadata, helper text, and summaries.
- Paper fills the masthead and reading page. Ground fills the library margin and the outer page.
- Line separates source rows and evidence sections. Field line defines native input and select boundaries.
- Limitations surface groups open questions within the reading page.
- History hover and selection use a darker cool margin fill. A translucent overlay separates open chat dialogs from the discussion.

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
- Discussion uses the body family for both participants, with a 1.7 line height for answer prose. Chat Markdown headings keep the same sans serif family.

**The Two Reading Voices Rule.** Use Source Sans 3 for facts, machine interpretation, controls, and chat messages. Use Source Serif 4 for saved source titles and human commentary in research notes.

## Layout

The desktop shell is a two-column grid capped at 1300px. Its margin column spans 250px to 290px; the remaining width holds the white page. The research article is centered within that page and capped at 72ch. Source summaries are capped at 70ch and clamped to three lines in the collection.

The masthead has a 64px minimum height. Desktop margins use 2.5rem vertical and 1.5rem horizontal padding. The reading page uses 3rem top padding, responsive horizontal padding, and 4rem bottom padding. Sections follow the recorded section gap; machine interpretation and human notes add an inset above their dividing line.

At 720px and below, the shell becomes one column. Library search spans the full row, with the three filters arranged underneath in equal columns. The note margin shows a text link back to saved sources. Its section navigation and privacy helper are hidden. Source facts become one column, and reading pages use 1.2rem horizontal padding.

Chat uses the full viewport width below the masthead. A 240px history margin sits beside the remaining discussion pane on desktop. The message area and composer fill that pane, with responsive side padding. Answer paragraphs and lists stay within 100ch; charts and tables can use the full available width. The conversation scrolls independently above the bottom composer. Its height responds to the visual viewport and masthead size.

At the same mobile breakpoint, chat history moves into a drawer. Messages keep 1rem side padding and the composer keeps 0.75rem side padding. Evidence opens in a bottom sheet; image viewing fills the phone width. The composer and dialogs include safe-area padding. The phone masthead hides access-state text and keeps Sources, Chat, and sign-out available.

**The Reading Width Rule.** Keep research articles within the 72ch reading column, including long titles, citations, and source URLs.

## Elevation & Depth

The library and research notes have no shadows. White paper, cool gray margins, pale status backgrounds, and thin dividing lines establish grouping. Limitation sections have a pale inset background; source rows remain part of the continuous page. Chat keeps that flat page treatment. Its desktop evidence popover adds a shadow to separate supporting material from the message below. Phone dialogs use the translucent overlay instead.

## Shapes

Native fields have modest rounded corners. Review labels are slightly squarer, and the limitations block uses the largest radius in the research note route. Source rows and the reading page have square outer edges. Divider lines are one pixel wide.

Chat introduces rounded message, evidence, and file boundaries. The composer has a larger radius, reduced on phones; Send is circular. A phone evidence sheet rounds only its upper corners. The phone image viewer has square edges and fills the viewport.

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

The masthead names the library, links to Sources and Chat, shows the collection's access state on desktop, and offers sign-out in private mode. The active route uses bold text and an underline. The desktop note margin links to source facts, machine interpretation, limitations, and human notes. Each section link has a 44px minimum target height and underlines on hover.

The return link says "Back to saved sources" on desktop and mobile. A skip link becomes visible on focus. Links and native disclosures retain their text and browser semantics.

### Evidence and commentary

Source facts use a two-column definition list on desktop. Claim evidence has a thin left border and muted text inside a native disclosure. Human commentary uses the serif prose role; an empty commentary region shows a sans serif empty-state message.

Library rows and note links limit color transitions to 0.15s ease-out when reduced motion is not requested. Those routes have no animated layout or entrance effects.

### Private chat

Chat uses a continuous sans serif discussion and a bottom composer. User messages align right on a cool fill; answers read directly on the white page. AI Elements conversation and Markdown components run in one React island. The model decides when to search, read, or inspect the saved corpus. History and New chat are the navigation controls.

The composer grows with the draft up to 180px. Its border turns blue on focus; the textarea suppresses the separate outline. Send is a 44px circular blue button, becoming Stop while an answer runs. Desktop Enter sends, Shift+Enter adds a newline, and IME composition does not submit. Phone Enter adds a newline. Answer completion announces its state without moving focus to an answer heading.

Waiting, failure, cancellation, and session expiry use text states. Errors appear above the composer, with sign-in when authentication has expired. A failed or stopped turn exposes Retry, which resends that message while preserving an independent draft. A failed initial submission keeps the draft. Activity is available in a disclosure, and the conversation includes a scroll-to-latest control.

Numbered inline citation buttons expose the evidence title, origin, locator, excerpt or exact quote, and available note, PDF, site, or image links. A cited image shows its actual thumbnail. Desktop mouse hover opens the evidence popover; click and keyboard activation also work. Touch activates the button without using hover. At the phone breakpoint, citations open an evidence sheet. Inline citation buttons are 25px on desktop and 32px on phones, with an expanded phone hit area of 44px. The source-list disclosure provides 44px citation buttons.

Returned images use the discussion width, with a 560px height cap, and open an image dialog with zoom, pan, reset, and an original-image link. Desktop images fit their viewer; phone images fill its width before zooming. Pinch, double tap or double click, drag, plus and minus buttons, and keyboard controls share the same bounded 100% to 600% zoom state. PDF and site attachments use bordered file links. Images come from returned private-corpus assets; Markdown image URLs do not create additional images.

The phone evidence sheet enters over 0.18s only when reduced motion is not requested. History and image dialogs have no entrance animation. The surface brief records route behavior and review evidence.

## Do's and Don'ts

### Do:

- Do pair the cool library margin with a white reading page.
- Do keep source facts, machine interpretation, limitations, and human notes in separate labeled sections.
- Do retain a visible label for search and every filter.
- Do keep saved source titles and research-note commentary in the serif reading voice; use sans serif for chat messages.
- Do retain the blue keyboard focus outline on reader links and buttons, and the blue composer border in chat.
- Do preserve 44px navigation and composer controls, including expanded phone citation hit areas.
- Do keep long source titles and URLs within the reading column.
- Do let chat charts and tables use the discussion pane while keeping answer prose within its reading measure.

### Don't:

- Don't communicate review state through color alone.
- Don't use the limited-evidence warning treatment for the default machine interpretation state.
- Don't apply shadows to the reader's flat rows and reading page.

Not canonized: the standalone sign-in page uses system-ui for its display heading and body instead of the shared reader type system. This existing drift remains outside the recorded typography rules; this documentation pass does not repair it.
