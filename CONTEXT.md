# Research capture and knowledge base

A personal collection of saved sources and the source notes derived from them.

## Language

**Capture**:
The user's act of saving a source. Capture succeeds independently of later extraction or analysis.

**Research inbox**:
The collection of saved items awaiting inclusion in the knowledge base.
_Avoid_: Knowledge base, corpus

**Source**:
The original paper, article, recipe, social post, guide, or other material a user saved.
_Avoid_: Summary, source note

**Source artifact**:
A retained copy of source material, such as a PDF or webpage snapshot. Possession of an artifact does not establish permission to redistribute it.

**Source note**:
A readable record about a saved source, with source facts, generated analysis suited to its category, and human commentary. These remain distinguishable from each other.
_Avoid_: Source, original article

**Category**:
The kind of content a source contains, such as research, news, or a recipe. One assigned category selects the analysis template for that source.
_Avoid_: Topic, file format, Zotero item type

**Template**:
The named sections and extraction instructions used to analyse sources in a category. A template revision records the particular definition used for an analysis.
_Avoid_: Category, source note

**Analysis input**
The source text and retained image bytes prepared for one source generation. Processing and template preview use the same pinned evidence. Saved captions remain separate from image bytes.

**Topic**:
A subject associated with a source, such as astronomy, cooking, or architecture. A source can have several topics independently of its category.
_Avoid_: Category

**Corpus**:
The collection of source notes and their associated structured information.
_Avoid_: Research inbox, raw archive

**Provenance**:
The record of where a fact or interpretation came from and how it entered a source note.

**Human note**:
Commentary written or edited by a person. Reprocessing must preserve it.

**Reprocessing**:
Producing a new analysis of a previously captured source without requiring the user to capture it again.

**Reclassification**:
Assigning a category again using the available category definitions. An explicit human category choice takes precedence over automatic assignment.

**Reader**:
The interface used to find and read source notes.

**Admin**:
The person who configures categories and templates, corrects category assignments, and requests reprocessing.

**Publication status**:
An explicit decision about a source's eligibility for public presentation or redistribution. Eligibility to publish a summary and eligibility to distribute a source artifact are separate decisions.

## Persistence

Azure SQL Database is authoritative for source notes, category revisions and assignments, human notes, processing state and conversations. Blob Storage holds source artifacts and temporary binary files. Git is not a runtime database. A completed processing job updates the live reader without publishing another static build.
