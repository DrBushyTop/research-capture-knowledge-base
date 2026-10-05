# Throwaway reader prototype

Question: how should a private personal reader distinguish source facts, machine analysis, limitations, human notes, and review states while supporting search and topic/type/year filters?

Run from this worktree:

```sh
npm ci
npm run prototype:reader
```

Open http://127.0.0.1:4328/prototype/reader/?variant=A. Use `variant=B` for the evidence desk or `variant=C` for the accession ledger. The floating bottom bar and keyboard arrows switch variants. The bar is hidden by production builds.

All examples are synthetic. The prototype has no authentication, persistence, actual full-text search index, source fetches, or editing. Search and filters work in memory over three complete examples; a production static index replaces that mechanism.

The parent implementation agent inspected variant A's mobile structure and accepted the notebook recommendation. Variant A gives sustained reading the most room, while section headings make provenance visible. Variant B is useful for deliberate source comparison. Variant C is more suitable for an operational review screen than the everyday reader.

Lift the notebook's cool white reading surface, restrained blue selection, 72ch measure, independent provenance sections, labeled review state, and distinct human commentary. Rewrite the production components against the validated corpus. On mobile, use a library route and a separate note route with a return link as the collection grows.

Verification: Astro static build passed; native T3 preview inspected all three variants at 1280px and 390px without document overflow; search, missing-text selection, variant switching, and empty results were exercised. The Impeccable mechanical detector reported no findings. This is a prototype review, not an authentication or clinical-content validation.

Local artifact paths:

- `src/components/VariantA.astro` — recommended composition.
- `src/components/NoteBody.astro` — section ordering and origin labels.
- `src/styles/reader.css` — shared tokens and the variant A rules.
- `.impeccable/review/desktop-a.png` and `mobile-a.png` — initial inspection captures.

Keep the branch outside master. Do not merge its fixture route.
