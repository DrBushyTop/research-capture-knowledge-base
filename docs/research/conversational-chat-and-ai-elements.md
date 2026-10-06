# Conversational chat and AI Elements

Researched: 2026-10-06. Scope: an ongoing private conversation, model-directed access to the saved corpus, inline citations, returned images and files, and phone use in the existing Astro static reader. Sources are first-party documentation and component source. Recommendations below are project decisions, not vendor guarantees.

## Adoption direction

Use selected Vercel AI Elements components inside one React island on `/chat/`. Keep the static Astro build and the queued Azure backend. Manage messages and polling with React state. The selected components import AI SDK types but do not require `useChat` or a streaming route at runtime. This is the smallest adoption that gives the app the requested message layout, Markdown, composer, and scrolling. [Conversation source](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/conversation.tsx), [message source](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/message.tsx), [composer source](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx).

AI Elements' setup guide lists React 19, Tailwind CSS 4, initialized shadcn/ui, AI SDK, Node 18+, and Next.js 14+. The selected component files contain no Next.js imports. Their use in Astro is therefore a conclusion from the source, not an explicit AI Elements support promise. Astro's official React integration provides rendering and hydration, and shadcn documents an Astro installation. [AI Elements setup](https://elements.ai-sdk.dev/docs/setup), [Astro React integration](https://docs.astro.build/en/guides/integrations-guide/react/), [shadcn Astro installation](https://ui.shadcn.com/docs/installation/astro).

Add `@astrojs/react`, React 19 and React DOM, React type definitions, and `react()` to the existing integrations. Mount a directly imported `<Chat client:load />`. This hydrates immediately and preserves static output. Read browser storage in an effect, not during build rendering. `client:only="react"` is an alternative when build rendering cannot work. [React setup](https://docs.astro.build/en/guides/integrations-guide/react/), [Astro client directives](https://docs.astro.build/en/reference/directives-reference/#clientload).

## Components and installation

AI Elements adds editable source files to the project. Install individual components rather than the entire registry. The official JSON endpoints below include `files[].content`, target paths, npm dependencies, and shadcn registry dependencies. Retrieved registry imports use `@/registry/default/ui/*` and `@/lib/utils`; a manual source copy must rewrite them to the reader's paths. [Installation and ownership](https://elements.ai-sdk.dev/docs/usage), [registry installation](https://github.com/vercel/ai-elements/blob/main/README.md).

- [Conversation registry](https://elements.ai-sdk.dev/api/registry/conversation.json) declares `ai`, `lucide-react`, `use-stick-to-bottom`, and shadcn `button`.
- [Message registry](https://elements.ai-sdk.dev/api/registry/message.json) declares `ai`, `lucide-react`, `streamdown`, `@streamdown/cjk`, `@streamdown/code`, `@streamdown/math`, `@streamdown/mermaid`, and shadcn `button`, `button-group`, `tooltip`.
- [Prompt input registry](https://elements.ai-sdk.dev/api/registry/prompt-input.json) declares `ai`, `lucide-react`, `nanoid`, and shadcn `command`, `dropdown-menu`, `hover-card`, `input-group`, `select`, `spinner`, `tooltip`.
- [Inline citation registry](https://elements.ai-sdk.dev/api/registry/inline-citation.json) declares `lucide-react` and shadcn `badge`, `carousel`, `hover-card`.
- [Sources registry](https://elements.ai-sdk.dev/api/registry/sources.json) declares `lucide-react` and shadcn `collapsible`.
- [Attachments registry](https://elements.ai-sdk.dev/api/registry/attachments.json) declares `ai`, `lucide-react`, and shadcn `button`, `hover-card`.

The full composer source includes menus, selects, uploads, and screenshots. These exports are optional UI. A deliberately trimmed source copy can omit unused exports and imports. Merely leaving them out of JSX does not remove their install-time dependencies. All `ai` imports in these six component files are `import type`; keep the package for those type definitions if copying the sources intact.

Use these exports:

- `Conversation`, `ConversationContent`, `ConversationScrollButton`. The wrapper provides a `role="log"` and follows new content through `use-stick-to-bottom`. Avoid its default empty-state prose, or supply functional content. [Conversation API](https://elements.ai-sdk.dev/components/conversation).
- `Message from={role}`, `MessageContent`, `MessageResponse`, and optional `MessageActions` and `MessageAction`. `MessageResponse` wraps Streamdown and accepts its Markdown and custom-component props. Pass completed content with animation disabled. Message actions accept accessible labels. [Message API](https://elements.ai-sdk.dev/components/message).
- `PromptInput`, `PromptInputTextarea`, `PromptInputFooter`, `PromptInputSubmit`. `onSubmit` receives `{ text, files }` and the form event and can return a promise. The textarea handles Enter, Shift+Enter, and composition input. The submit button accepts `status` and `onStop`. [Composer source](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/prompt-input.tsx).
- `InlineCitation`, `InlineCitationCard`, `InlineCitationCardTrigger`, `InlineCitationCardBody`, `InlineCitationSource`, `InlineCitationQuote`. The source also exports a citation carousel. Its trigger reads a hostname with `new URL(sources[0])`, so relative source URLs need conversion or a custom trigger. [Citation source](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/inline-citation.tsx).

## CSS and phones

Use Tailwind 4 through `@tailwindcss/vite` in Astro's Vite configuration. Import its theme and utilities separately and omit Preflight. This avoids resetting headings, lists, controls, and images across the existing reader. Import the chat stylesheet only on the chat page. Map shadcn color variables to the reader's existing colors and scope local adjustments to the chat component. Do not copy shadcn's global body and universal-selector defaults into the reader stylesheet. [Vite installation](https://tailwindcss.com/docs/installation/using-vite), [disabling Preflight](https://tailwindcss.com/docs/preflight#disabling-preflight).

The basic imports are:

```css
@layer theme, base, components, utilities;
@import "tailwindcss/theme.css" layer(theme);
@import "tailwindcss/utilities.css" layer(utilities);
```

MessageResponse also needs Tailwind to scan Streamdown's distributed JS using an `@source` path relative to the stylesheet. The docs' example is `@source "../node_modules/streamdown/dist/*.js"`; adjust that path for this monorepo. [Message styling requirement](https://elements.ai-sdk.dev/components/message).

Phone behavior still needs app work. Keep the composer visible with the keyboard open, preserve the draft during a request, allow multiline input, and avoid taking focus when the answer arrives. Use `dvh` and safe-area padding, readable file names, horizontal scrolling inside wide tables, and explicit tap controls for source details. Test a narrow viewport and the on-screen keyboard. These are recommended acceptance checks, not behavior guaranteed by installing the components.

## Citations and returned content

AI Elements explicitly says Streamdown and AI SDK do not automatically support inline citations. Keep server-validated evidence IDs and convert citation markers into React citation controls in the Markdown renderer. Allow uncited conversational replies when the model makes no corpus claim. Validate references against sources actually returned by tools, with page or section locators. [Inline citation integration limits](https://elements.ai-sdk.dev/components/inline-citation).

The stock citation uses HoverCard. Add click and keyboard access through a controlled card or a popover/dialog; use a phone sheet when source content is long. Show title, page or section, excerpt, and an open-source action. Hover alone cannot satisfy the phone requirement. [Citation implementation](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/inline-citation.tsx).

`Sources` is a collapsible list and supports custom data. `SourcesTrigger` accepts `count` and children, so use a plain label such as `Sources`. `Source` accepts normal anchor props. The AI SDK example uses `source-url` message parts, but our validated citation records can populate it directly. [Sources API](https://elements.ai-sdk.dev/components/sources).

`Attachments variant="grid" | "inline" | "list"` renders `Attachment`, `AttachmentPreview`, and `AttachmentInfo`. Each attachment takes a file or source-document UI part with an ID. Image files get thumbnails; generic files get icons and metadata. This is not a PDF viewer. Add explicit open/download actions and a separate source preview when needed. Prefer full-width uncropped figures for charts. [Attachments API](https://elements.ai-sdk.dev/components/attachments), [preview implementation](https://github.com/vercel/ai-elements/blob/main/packages/elements/src/attachments.tsx).

Return source IDs, artifact IDs, media types, and locators from the backend. Resolve them to authenticated app URLs. The model can select saved sites and files through tool results; returning a website link does not require live browsing. Keep arbitrary model-generated embed URLs out of the artifact renderer. This is the proposed app contract.

## Polling and model tools

`useChat`'s default transport sends HTTP and reads UI message streams. The existing job JSON API is not compatible with that transport by changing the URL alone. A custom `ChatTransport` can submit the job, poll, and emit a local `ReadableStream<UIMessageChunk>`. Its interface requires `sendMessages` and `reconnectToStream`. This is feasible but adds an adapter the initial React-state implementation does not need. Do not fake token streaming of an already completed answer. [Transport guide](https://ai-sdk.dev/docs/ai-sdk-ui/transport), [transport interface](https://github.com/vercel/ai/blob/main/packages/ai/src/ui/chat-transport.ts).

SWA `/api` requests have a 45-second maximum and support HTTP, not WebSockets. Managed APIs are available on Free; linking an existing backend requires Standard. The queued submit/status arrangement keeps each request short while model and sandbox work runs elsewhere. This supports keeping the current hosting plan; it does not prove that SWA forbids every form of HTTP streaming. [SWA API constraints](https://learn.microsoft.com/en-us/azure/static-web-apps/apis-overview).

The existing Azure chat-completions endpoint can run a native function-call loop. Send tool definitions with `tool_choice="auto"`, execute returned `tool_calls`, append the assistant tool-call message and corresponding `role="tool"` results, then call the model again. This lets the model choose when to search, read, or inspect. Keep general discussion as ordinary assistant output. Bound tool rounds and artifact sizes in server code. [Microsoft function-calling example](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/function-calling?view=foundry-classic).

AI SDK Core is optional for this loop. `generateText` and `streamText` support tools with `inputSchema`, `execute`, and `stopWhen`. The Azure provider accepts a complete Foundry `/openai/v1` base URL and an Entra token provider. Use `azure.chat(deploymentName)` to retain chat completions, because `azure(deploymentName)` defaults to Responses. Neither path requires Vercel hosting or AI Gateway. [AI SDK tools](https://ai-sdk.dev/docs/ai-sdk-core/tools-and-tool-calling), [Azure provider configuration](https://ai-sdk.dev/providers/ai-sdk-providers/azure).

Verify native tool calling and vision against the existing deployment before relying on model-specific behavior. The researched documentation establishes the protocols, not this app's deployment configuration. A rendered PDF page or saved image must reach the model as image input; merely returning its filename or a link does not supply its pixels.

## Live API correction, 2026-10-06

The deployed Sol model rejects function tools with medium reasoning on `/openai/v1/chat/completions`. Its error explicitly requires Responses or reasoning `none`. The implementation therefore uses `/openai/v1/responses`, keeps medium reasoning, and replays returned reasoning and function-call items between tool rounds with `store:false`. A live three-turn check passed general discussion, original PDF search and a follow-up returning the cited page image and PDF. This supersedes the Chat Completions loop proposal above. [Responses migration](https://developers.openai.com/api/docs/guides/migrate-to-responses), [stateless reasoning](https://developers.openai.com/api/docs/guides/reasoning#preserve-reasoning-without-stored-responses).
