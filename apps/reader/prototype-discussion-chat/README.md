# Discussion chat prototype

Throwaway design evidence for the private `/chat/` route. No model calls, credentials, real documents, writes, or persistence. The conversations, PDF and chart use synthetic study data.

Run from the repository root:

```sh
python3 -m http.server 8767 --directory apps/reader/prototype-discussion-chat --bind 127.0.0.1
```

Open `http://127.0.0.1:8767/?variant=A`. The bottom prototype control and left/right keys switch variants. `?production=1` hides the prototype control and removes its reserved space.

## Question

How should an unrestricted discussion with a corpus-searching agent fit the existing reader, especially on a phone?

## Variants

- A keeps the cool library margin for chat history and gives the conversation a continuous white page.
- B gives the entire page to the conversation. Chat history opens in a drawer on both desktop and phone.
- C retains history and adds a desktop source rail. On narrower screens history moves into a drawer, and sources open separately.

All variants share inline citation buttons, tap evidence sheets on phones, hover evidence popovers on desktop, PDF and saved-source links, returned charts, collapsed search activity, and a bottom composer. New chat opens an empty conversation with only the composer. Enter sends on desktop; Shift+Enter inserts a newline. Phone Enter inserts a newline, and the visible send button submits.

## Recommendation

Use A on desktop and the common phone layout. Keep only Chat, history, source access and New chat in the chat header. A drawer preserves conversation width on phones. A stable bottom composer with 44px send and stop targets and safe-area padding keeps typing and sending within thumb reach. Visual viewport height updates keep the composer above a phone keyboard. The production version must reserve no space for the prototype control.

Render answers as normal Markdown, with no container around each assistant response. Keep user messages short and visually distinct. Use the existing serif for submitted user text and source names, and sans serif for assistant answers and controls.

Place compact citation pills beside the supported passage. Hover previews on desktop; tap opens the same evidence in a bottom sheet on phones. Evidence contains the source name, origin, page or passage, supplied excerpt, and Open source or Open PDF actions. Dismiss on Escape, outside click or the explicit close action, without changing the scroll position. Opening a full PDF uses a separate tab. Do not embed a full PDF reader in the chat column.

Search and document choices belong to the agent. Tool activity starts at Searching and collapses to a short result disclosure. Do not ask the reader to choose a source, PDF or page before sending.

Returned images belong within the answer. Tap an image to open a full-screen phone viewer with the initial image spanning the phone width. Pinch or double-tap to zoom, then drag to pan. Visible zoom in, zoom out and Reset controls have 44px targets. The viewer retains its source and download actions. Desktop users can also zoom with the wheel or plus and minus keys, pan with arrow keys, and reset with zero. The chart's axes and legend paths explicitly use no fill so open stroke paths cannot form black triangles.

Avoid an always-visible source rail on phones. C is useful as an optional desktop review mode, but it takes away reading width and should not be the default.

## Validation scope

This branch captures layout and interaction decisions. It is a static runnable prototype, not shipping application code or an AI integration. Native browser popovers and dialogs keep overlays outside scrolling containers. The shipping implementation should use the app's actual conversation and source schemas.

JavaScript syntax, local source and asset paths, served-resource status and whitespace were checked. The mechanical detector ran once. It reported design-token advisories, including font-family names that were corrected to match DESIGN.md. No live desktop, phone or keyboard browser verification was performed by this background task because the main task was using the shared preview.

The prototype preserves DESIGN.md's paper, cool margin, blue controls, thin rules, Source Sans 3 and Source Serif 4. The obsolete selector instructions in the current chat surface brief are superseded by the user's freeform discussion brief. DESIGN.md and its pre-existing stale sidecar are untouched.
