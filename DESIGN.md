---
name: Research library
description: A private research notebook with a library margin and readable evidence sections.
colors:
  ink: "#202d3d"
  navy: "#14213a"
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
  masthead-link: "#c9d5e6"
  masthead-focus: "#9fc1ff"
  human-wash: "#fbf6ea"
  human-ink: "#7a4d0b"
  source-wash: "#eef6f3"
  source-ink: "#1d6152"
typography:
  display:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "clamp(1.75rem, 2.6vw, 2.4rem)"
    fontWeight: 700
    lineHeight: 1.17
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Source Sans 3 Variable, system-ui, sans-serif"
    fontSize: "1.15rem"
    fontWeight: 800
    lineHeight: 1.3
  title:
    fontFamily: "Source Serif 4 Variable, Georgia, serif"
    fontSize: "1.02rem"
    fontWeight: 650
    lineHeight: 1.3
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
    fontSize: "0.74rem"
    fontWeight: 700
    lineHeight: 1.6
  status:
    fontFamily: "Source Sans 3 Variable, system-ui, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 600
    lineHeight: 1.6
  discussion:
    fontFamily: "Source Sans 3 Variable, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.62
rounded:
  status: "999px"
  field: "10px"
  filter: "8px"
  notes-field: "6px"
  limitations: "12px"
  reading-block: "14px"
  discussion: "12px"
  composer: "22px"
  composer-phone: "20px"
  circular: "50%"
spacing:
  small: "0.5rem"
  standard: "1rem"
  section-inset: "1.1rem 1.25rem"
  section-gap: "2rem"
  chat-pane-inset: "clamp(1rem, 3vw, 2rem)"
components:
  search-field:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    padding: "0.45rem 0.7rem"
    height: "42px"
    width: "100%"
  filter-select:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.filter}"
    padding: "0.25rem 0.4rem"
    height: "36px"
    width: "100%"
  filter-select-phone:
    rounded: "{rounded.field}"
    padding: "0 0.7rem"
    height: "48px"
  source-row:
    textColor: "{colors.ink}"
    rounded: "{rounded.field}"
    typography: "{typography.title}"
    padding: "0.6rem 0.65rem"
  note-navigation:
    textColor: "{colors.muted}"
    padding: "0 0.6rem"
    height: "44px"
  status-default:
    backgroundColor: "{colors.blue-wash}"
    textColor: "{colors.status-ink}"
    typography: "{typography.status}"
    rounded: "{rounded.status}"
    padding: "0.15rem 0.6rem"
  status-attention:
    backgroundColor: "{colors.attention-wash}"
    textColor: "{colors.attention}"
    typography: "{typography.status}"
    rounded: "{rounded.status}"
    padding: "0.15rem 0.6rem"
  limitations-section:
    backgroundColor: "{colors.limitations-surface}"
    textColor: "{colors.ink}"
    rounded: "{rounded.limitations}"
    padding: "1.1rem 1.3rem"
  chat-send:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.paper}"
    rounded: "{rounded.circular}"
    width: "40px"
    height: "40px"
  chat-send-phone:
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
    padding: "0.35rem"
    width: "100%"
  chat-composer-phone:
    rounded: "{rounded.composer-phone}"
  chat-citation:
    backgroundColor: "{colors.ground}"
    textColor: "{colors.ink}"
    rounded: "{rounded.status}"
    padding: "0 0.5rem"
    height: "22px"
  chat-citation-open:
    backgroundColor: "{colors.blue}"
    textColor: "{colors.paper}"
  masthead:
    backgroundColor: "{colors.navy}"
    textColor: "{colors.paper}"
    height: "56px"
    padding: "0.3rem clamp(1rem, 3vw, 2rem)"
  masthead-phone:
    height: "52px"
    padding: "0.2rem 0.35rem"
  masthead-route:
    textColor: "{colors.masthead-link}"
    rounded: "{rounded.status}"
    padding: "0 0.9rem"
    height: "40px"
  masthead-route-current:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.navy}"
  masthead-tool:
    textColor: "{colors.masthead-link}"
    rounded: "{rounded.field}"
    width: "44px"
    height: "44px"
  masthead-menu:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.discussion}"
    padding: "0.3rem"
  summary-section:
    textColor: "{colors.ink}"
    width: "100%"
  human-section:
    backgroundColor: "{colors.human-wash}"
    rounded: "{rounded.reading-block}"
    padding: "{spacing.section-inset}"
---

# Design System: Research library

## Overview

**Creative North Star: "The research notebook"**

A cool gray library margin sits beside a white reading page. Source Sans 3 carries controls, source facts, and machine interpretation. Source Serif 4 gives saved titles and personal commentary a different reading rhythm.

The notebook separates evidence origins through headings, rules, and status text. It keeps source metadata and capture state near the reading content. The recorded system covers Sources, private chat, and Categories in the React reader at `apps/reader`. Chat carries the same colors and controls into a continuous sans serif discussion.

**Key Characteristics:**

- A library margin beside a white reading page.
- Compact source rows with serif titles and sans serif summaries, beside serif reading titles.
- Separate sections for source facts, machine interpretation, limitations, and human notes.
- Text labels beside color-coded review states.
- A continuous chat page with inline evidence and a bottom composer.

## Colors

The palette pairs cool paper and blue interaction states with a warm warning treatment for limited evidence.

### Primary

- Blue identifies links, topic text, caret color, and keyboard focus.
- Blue wash and status ink identify the default unreviewed machine interpretation state.
- Chat uses blue for Send and darker blue for its hover state. Open and hovered citations use white text on blue. The navy masthead uses pale links and a white pill for the current route.

### Secondary

- Attention and attention wash identify limited evidence and extraction notices.
- Chat error text uses a darker warm ink beside the composer.
- Human notes use human wash and human ink. Original-source labels and file controls use source wash and source ink. Category labels and analysis markers use six local category inks in `sources.css`. Matching washes remain defined there but current category labels have no fill.

### Neutral

- Ink carries titles and body text. Muted carries citations, metadata, helper text, and summaries.
- Paper fills the reading page and More menu. Ground fills the source list and outer page. Navy fills the masthead and selected Categories controls.
- Line separates source rows and evidence sections. Field line defines native input and select boundaries.
- Limitations surface groups open questions within the reading page.
- History hover and selection use a darker cool margin fill. A translucent overlay separates open chat dialogs from the discussion.

**The Review Text Rule.** Every review state includes a text label. Color supplements the label.

## Typography

Source Serif 4 is the source-title and human-commentary face, with Georgia as its fallback. Source Sans 3 is the body and control face, with system-ui and sans-serif fallbacks. `apps/reader/src/main.tsx` imports both variable fonts.

### Hierarchy

- Display is the Sources reading title. Mobile sets it to 1.75rem. Titles use balanced wrapping and can break long unspaced source text. Retained legacy note CSS uses a larger clamp and a 2rem phone title; no current route renders that separate layout.
- Headline is the reading section heading. The source-list heading uses 1.25rem and weight 800. Categories has its own sans serif page title and serif category-name input.
- Title is the compact serif source-row title, clamped to two lines. Categories document titles and Sources reading titles also use serif.
- Body is the default reading text. The root size makes all rem measurements relative to 17px.
- Human prose is the serif commentary role. Its wider line spacing distinguishes personal writing from machine interpretation.
- Label is the visible desktop Sources filter label. Phone filter-sheet labels use 0.85rem. Select text is 0.84rem on desktop and 16px on phones.
- Status is the compact review badge role. Citations, source metadata, and helper text use smaller sans serif sizes within the same family.
- Discussion uses the body family for both participants, with a 1.62 line height for answer prose. Chat Markdown headings use 1.08rem, weight 750, and the same sans serif family.

**The Two Reading Voices Rule.** Use Source Sans 3 for facts, machine interpretation, controls, and chat messages. Use Source Serif 4 for source-list and reading titles, original text, human commentary, and Categories document titles and category-name inputs. Categories preview paragraphs also use serif in the current code.

## Layout

Sources uses a full-width two-column desktop grid. Its source list spans 280px to 330px; the remaining width holds the white reading pane. Both panes scroll independently within a shell sized to `100dvh - 56px`, with a 420px minimum height. Source titles and summaries are clamped to two lines. Reading articles have no line-length cap. Retained legacy CSS defines a separate 1300px shell with a 250px to 290px margin and a 72ch article; the current router does not render it.

The masthead has a 56px minimum height on desktop and 52px on phones. The source-list header uses a 1rem inset. The reading pane uses 1.6rem top padding, responsive horizontal padding, and 4rem bottom padding. Reading sections use the recorded section gap. Summary reads directly on the white page; human notes use a filled, rounded block. Details begins after a dividing line.

At 720px and below, Sources shows either the source list or the selected reading pane. Search and a Filters button share a row; the repeated Sources heading is visually hidden. Category, topic, type, and year filters open in a single-column bottom sheet with Clear all and Show source-count actions. Desktop filters expand in two columns behind the same Filters button. The reading pane shows a Sources return link and a sticky Jump to section select. Source facts become one column, and reading pages use 1.1rem horizontal padding.

Chat uses the full viewport width below the masthead. A 260px history margin sits beside the remaining discussion pane on desktop. The message area and composer are capped at 1180px, with responsive side padding. Desktop answer paragraphs, lists, headings, and blockquotes stay within 90ch; charts and tables can use the full available width. The conversation scrolls independently above the bottom composer. Its height responds to the visual viewport and masthead size. Desktop retains a 48px toolbar in the discussion pane.

At the same mobile breakpoint, chat history moves into a drawer. Messages use 0.9rem side padding and the composer uses 0.6rem. Evidence opens in a bottom sheet; image viewing fills the phone width. The composer and dialogs include safe-area padding. On phones, standalone Chat has no separate toolbar row. It portals History and New chat into the masthead slots defined in `apps/reader/src/app/masthead.ts`.

Source-specific chat adds a third desktop column, 360px to 430px wide. Between 721px and 1199px it becomes a fixed right panel. On phones it fills the viewport and retains its own toolbar, including Close. It starts with source context but can search the whole corpus. Categories is capped at 1240px, with a 230px template rail that becomes a native category picker at 860px and below.

**The reading width rule.** On source detail pages, the article fills the space beside the source list with responsive side padding. Titles, section navigation, summaries, original text, and details share that width. The retained legacy note CSS has a 72ch cap but no current route. Long titles and source URLs wrap within their pane.

PDF extractions with page markers render Markdown in the original-text section. Visible page labels separate pages. Headings use the existing reading typeface and a 1.5rem, 1.25rem and 1.1rem scale. Tables and code scroll within the reading pane. Legacy plain text remains literal.

Source pages offer Add notes and Edit notes inline, with a labeled textarea, explicit Save and Cancel, retained local drafts, and conflict recovery that keeps the draft beside the latest saved text. Both readers share the saved notes. Internal links use TanStack Router without animated page transitions. Search reads the shared live Query cache and rebuilds its index when corpus data changes.

## Elevation & Depth

The reading page stays flat. White paper, cool gray margins, pale status backgrounds, and thin dividing lines establish grouping. Selected source rows add a small shadow and an inset blue border. Ask controls, the source-chat panel, Categories panels and sticky bars, the chat composer, scroll-to-latest control, desktop evidence popover, and More menu have local shadows. Phone dialogs use a translucent overlay. These exceptions do not make every source row or reading section a raised card.

## Shapes

Source search and source rows use the field radius; compact desktop selects use the filter radius. Reader-note fields and removable filter chips use the smaller notes-field radius. Shared review badges are pills; source-row review text and category labels have no fill. Origin tags have a small outlined boundary. Human-note blocks use the reading-block radius; summaries have no boundary or fill. The reading pane has square outer edges. Divider lines are one pixel wide; Categories header rules are two pixels.

Chat introduces rounded message, evidence, and file boundaries. The composer has a larger radius, reduced on phones; Send is circular. A phone evidence sheet rounds only its upper corners. The phone image viewer has square edges and fills the viewport.

## Components

### Inputs / Fields

Sources search and filters use native controls with a white fill and field-line border. Search has a 42px minimum height and a visually hidden label. Its placeholder includes the total source count when available. Filter selects have visible labels and a 36px desktop minimum height. Phone search is 44px high; filter-sheet selects and actions have a 48px minimum height. Categories fields use the field radius and a 46px minimum height.

Default keyboard focus uses a 3px blue outline with a 4px offset. Sources search replaces that outline with a blue border and blue-wash ring. Categories fields use a 1px outline offset; masthead controls use a pale focus outline. Placeholders use muted slate. Sources announces its loading state or result count through a status region and load errors through an alert. Its reading pane prompts selection when no source is selected.

### Chips

Review badges are informational labels. The shared default status uses blue wash with status ink; limited evidence uses attention wash with attention text. Current source rows instead show plain attention-colored Needs review text when extraction is not text. Category labels include a dot and category-specific ink without a fill. Active filters are removable outlined chips with expanded hit areas. Summary topics are slash-separated text, limited to three until the reader activates the more control. Outlined origin tags label Generated, Human, and Source beside section headings.

### Cards / Containers

Source rows are rounded full-row links without bottom dividers. Each row contains category when available, source type and known publication year, a saved date, a serif title, an available short summary, and conditional review text. Browsing sorts newest saves first, with Last 7 days and month groups; search keeps relevance order without date groups. Hover fills the row with history hover. Selection adds white paper, a blue title, an inset blue border, and a small shadow. Long unspaced titles wrap within the row.

Summary has no fill or inset; human notes use human wash, a rounded boundary, and the section inset. Current analysis sections follow the category template's paragraph, bullet, or numbered-step format. The retained legacy limitations class uses a pale fill and rounded boundary; current Sources renders limitations as an analysis section when present.

### Navigation

The masthead names the library and links to Chat and Sources. Categories and Sign out are in the More menu. Desktop Sources uses sticky horizontal links to Summary, available analysis sections, Notes, Original text, and Details. Links have a 44px minimum height and mark the current section with a blue underline. Scrolling updates the current section and keeps its link visible. Phones replace those links with a 48px native Jump to section select. A Next source link at the end follows the current list or search order. Category changes live in Details, not the reading header.

The phone return link says "Sources". Desktop keeps the source list beside the reading pane. A skip link becomes visible on focus. Links and native disclosures retain their text and browser semantics.

### Evidence and commentary

Source facts use a two-column definition list on desktop. Current claim evidence appears within the generated analysis sections; the left-bordered disclosure belongs to retained legacy CSS. Human commentary uses the serif prose role; an empty reader-note region says "No reader notes yet." Original text also uses serif, with a clipped preview and an expansion control when needed.

Source rows and section links use 0.12s ease-out background, color, and shadow transitions when reduced motion is not requested. Opening source chat uses a 0.22s entrance; the filter sheet enters over 0.2s. The phone Ask button contracts to its icon while scrolling down and expands when scrolling up, by animating a 0.24s clip-path to its 52px icon circle. Its layout size does not change, and a drop shadow on its wrapper follows the clipped shape. These effects respect reduced motion. Legacy rows and margin links retain 0.15s color transitions.

### Private chat

Chat uses a continuous sans serif discussion and a bottom composer. User messages align right on blue wash; answers read directly on the white page. AI Elements conversation and Markdown components run within the React app. The model decides when to search, read, or inspect the saved corpus. History and New chat are the navigation controls.

The composer placeholder is "Ask your library", or "Ask about this source" in source chat. It grows with the draft up to 180px. Its border turns blue on focus; the textarea suppresses the separate outline. Send is a 40px circular blue button on desktop and 44px on phones, becoming Stop while an answer runs. Attach images supports selection, paste, and drag and drop, with upload and failure states beside image drafts. Desktop Enter sends, Shift+Enter adds a newline, and IME composition does not submit. Phone Enter adds a newline. Answer completion announces its state without moving focus to an answer heading.

Waiting, failure, cancellation, and session expiry use text states. Errors appear above the composer, with sign-in when authentication has expired. A failed or stopped turn exposes Retry, which resends that message while preserving an independent draft. A failed initial submission keeps the draft. Activity is available in a disclosure, and the conversation includes a scroll-to-latest control.

Inline citation pills show the first source label and a count for adjacent additional citations. They expose the evidence title, origin, locator, excerpt or exact quote, and available note, PDF, site, or image links. A cited image shows its actual thumbnail. Desktop mouse hover opens the evidence popover; click and keyboard activation also work. Touch activates the button without using hover. At the phone breakpoint, citations open an evidence sheet. Inline citation pills are 22px high on desktop and 26px on phones, with an expanded phone hit area of 44px. Pills in the expanded source list are 32px high on phones.

Returned images use the discussion width, with a 560px height cap, and open an image dialog with zoom, pan, reset, and an original-image link. Images fit within the viewer before zooming; the phone viewer fills the viewport. Pinch, double tap or double click, drag, plus and minus buttons, and keyboard controls share the same bounded 100% to 600% zoom state. PDF and site attachments use bordered file links. Images come from returned private-corpus assets; Markdown image URLs do not create additional images.

The phone evidence sheet enters over 0.18s only when reduced motion is not requested. History and image dialogs have no entrance animation. The surface brief records route behavior and review evidence.

### Masthead

The navy bar appears on every app route. It shows the Shelf mark from `/icons/shelf.svg`, a white wordmark and pale masthead links, with the current route as a white pill. Chat and Sources are the only visible routes. The More button uses an ellipsis icon and a Radix popover with Categories and, below a rule, Sign out. When Categories is the current route, More has the white current-route fill.

At 720px and below, phones use one grid row with a 52px minimum height. A left slot, a centered Chat / Sources segmented switch, then the right slot and More share that row. Standalone Chat fills the left slot with History and the right slot with New chat, hiding the brand mark. Other pages show the Shelf mark on the left. Masthead icon buttons are 44px. Phone route links are 38px high with expanded hit areas. No public or publication controls appear.

### Categories admin

Operate surface at `/categories/`. Three tabs (Templates, Documents, Updates; arrow keys move between them) under a page title with a 2px ink rule. Badges show documents on an older template and running updates.

- Templates: category rail on desktop (current item filled navy), native select plus New on narrow screens. The editor is one white panel: serif name field, "When to use this category", numbered section blocks (heading, "Show as" pill radios Paragraph / Bullets / Numbered steps, "What to include", move up/down/remove icons), dashed Add section, "Try this template" preview (marked "Preview only · not saved"), Archive/Restore, then a save bar that turns sticky only while there are unsaved changes. Conflicts (409) keep the draft and offer "Reload latest categories". Switching category with unsaved changes asks inline.
- Documents: title search, Show filter with counts, checkbox rows with category tag, "Chosen by admin", "Older template" and status. Selecting opens a sticky navy action bar: Update analysis (keep category or Move to) or Check categories. The confirmation names the count and model-call cost before Start update. `/categories/?source=<id>` opens here with that document selected and Move to preset.
- Updates: one card per batch with progress bar (blue done, rust failed), failures sorted first with Retry, "Stop N queued".

Copy states the action and its effect. No slogans.

### Live source data

Sources loads current notes from the private library endpoint through TanStack Query. Source selection updates the reading pane and URL without a page reload. Search indexes metadata, generated analysis, human notes supplied in the search text, and available source text in the browser. Sources links use `/sources/?source=<id>`.

Vite serves a client-rendered React app. `main.tsx` mounts it with `createRoot`; TanStack Router handles app navigation without animated page transitions. The shared Query cache treats library responses as fresh for 30 seconds and keeps inactive queries for five minutes. Revisits can show cached data while stale queries refetch. Rejected sessions and sign-out clear the private Query cache; note saves and category writes invalidate the library query. Corpus responses and saved conversation bodies are not persisted to browser storage. Reader-note drafts and recent conversation IDs use localStorage; active-chat resume records, including the submitted question and image metadata, use sessionStorage. Original text is fetched on demand. Chat and Categories are imported by the router, not separate hydrated islands.

### Chat progress

During a reply, the collapsed activity summary names the latest actual tool action or answer writing. Expanding it shows tool queries, source titles and available outcomes. Short model-authored commentary remains separate from tool steps and never displays hidden reasoning. Completed turns retain their action history and elapsed time.

Activity uses tightened vertical margins of -0.45rem above and -0.2rem below. Its summary has a -0.4rem left margin to align text with the answer. Answer actions use -0.25rem top and -0.55rem left margins to bring Copy and Sources closer to the answer.

Answers display complete Markdown blocks as the worker produces them. Tables and code fences remain buffered until complete; validated final answers replace provisional text and add citations. Stopped or failed drafts are labelled unverified and are not saved as completed conversation turns. Live indicators respect reduced motion, and progress does not force readers away from their current scroll position.

Capture diagnostics live in a collapsed disclosure under source Details, after the reading content. A concise capture-status link beside the summary states partial or unavailable evidence without placing operational instructions above the content.

## Do's and Don'ts

### Do:

- Do pair the cool library margin with a white reading page.
- Do keep source facts, machine interpretation, limitations, and human notes in separate labeled sections.
- Do retain an accessible search label and visible labels for every filter.
- Do keep source titles and research-note commentary in the serif reading voice; use sans serif for controls and chat messages.
- Do retain visible keyboard focus on reader links and buttons, using blue by default and pale blue on the masthead. Keep the blue composer border in chat.
- Do preserve 44px phone masthead and composer controls, including expanded phone citation hit areas.
- Do keep long source titles and URLs within the reading column.
- Do let chat charts and tables use the discussion pane while keeping answer prose within its reading measure.

### Don't:

- Don't communicate review state through color alone.
- Don't use the limited-evidence warning treatment for the default machine interpretation state.
- Don't apply shadows to every source row or the flat reading page. Keep shadows limited to the documented selection, control, panel, and popover states.

Not canonized: the standalone sign-in page uses system-ui for its display heading and body instead of the shared reader type system. This existing drift remains outside the recorded typography rules; this documentation pass does not repair it.
