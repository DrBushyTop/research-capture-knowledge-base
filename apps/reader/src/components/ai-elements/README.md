# AI Elements components

Adapted from Vercel's MIT-licensed [AI Elements](https://github.com/vercel/ai-elements). Registry source URLs:

- [Conversation](https://elements.ai-sdk.dev/api/registry/conversation.json)
- [Message](https://elements.ai-sdk.dev/api/registry/message.json)
- [Inline citation](https://elements.ai-sdk.dev/api/registry/inline-citation.json)

Only the conversation, Markdown message and citation text primitives used by this reader remain. Unused download, branching, menu and carousel exports were removed. MessageResponse uses core Streamdown without the optional math, Mermaid and code plugins. Imports target local UI helpers. Citation interaction uses a controlled Radix Popover for desktop hover and click, and a Radix Dialog for phone evidence sheets. Theme utilities omit Tailwind Preflight to preserve the Astro reader.
