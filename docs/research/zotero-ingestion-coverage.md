# Zotero ingestion coverage and attachment cleanup

Researched on 2026-10-07 and verified overnight on 2026-10-08 in Helsinki. This note combines current Zotero documentation and public API templates with ingestion code inspection. The first matrix records the baseline before this task. The results section records the changes and live validation separately.

The existing [capture and sync research](zotero-capture-and-sync.md) and [image and social capture research](zotero-images-and-social-capture.md) explain capture and file-sync boundaries. This note adds notes, annotations, linked attachments, unsupported formats, and deletion behavior.

## Facts from Zotero

Zotero permits child notes and standalone notes. Note text syncs with metadata and does not use attachment storage. Embedded images in notes sync separately and do count against storage. [Notes](https://www.zotero.org/support/notes)

Files can be standalone attachments or children of a bibliographic item. Stored files can sync through Zotero Storage. Linked files refer to local paths and their bytes do not sync. A linked URI can refer to an HTTP webpage or another program. Snapshots preserve HTML page content. [Adding files](https://www.zotero.org/support/attaching_files)

The file API documents `imported_file`, `imported_url`, `linked_file`, and `linked_url` attachment templates. Stored downloads use the attachment key at `/items/<key>/file`. Compare its ETag with the attachment's `md5`. The newest file may exist only in WebDAV if those hashes disagree. [File API](https://www.zotero.org/support/dev/web_api/v3/file_upload)

The current public templates also expose `embedded_image`. Its template includes `parentItem`, `contentType`, `filename`, `md5`, and `mtime`. A standalone note template has `itemType: note` and a `note` field, rather than `title` or `abstractNote`. A highlight annotation template contains `annotationText`, `annotationComment`, `annotationPageLabel`, `annotationSortIndex`, and its attachment's `parentItem`. These are observed public API responses, not dev-library samples. [Note template](https://api.zotero.org/items/new?itemType=note), [Highlight template](https://api.zotero.org/items/new?itemType=annotation&annotationType=highlight), [Embedded-image template](https://api.zotero.org/items/new?itemType=attachment&linkMode=embedded_image)

Zotero stores its own annotations in its database, outside the PDF bytes, and exposes them through the Web API. Reading the PDF alone cannot recover every highlight or comment. [Annotation storage](https://www.zotero.org/support/kb/annotations_in_database) The public server returns annotation children under document attachments and embedded-image attachments under notes. This is source-code evidence at a fixed revision, rather than a deployment guarantee. [Items controller at revision 3b85c35d](https://github.com/zotero/dataserver/blob/3b85c35d3a7b81fc2c6a04a7dd898a0b3e5e6151/controllers/ItemsController.php#L491)

Different bibliographic types do not necessarily require different extraction paths. The API provides the item-type catalog and valid templates. A book, journal article, report, or webpage can still share the same attachment or URL extraction path. The last sentence is an implementation inference from the API's object model. [Types and templates](https://www.zotero.org/support/dev/web_api/v3/types_and_fields)

## Capture matrix

The expected result column is the proposed acceptance behavior for this task. It is a recommendation, not a promise from Zotero. Existing handling and gaps come from [normalization](../../shared/corpus.ts), [artifact selection](../../apps/worker/src/source-artifacts.ts), [extraction](../../apps/worker/src/extraction.ts), and [image validation](../../apps/worker/src/image-input.ts).

| Capture case | Proposed expected result | Existing handling and gap before this task |
| --- | --- | --- |
| Journal article, preprint, book, report, thesis, or other metadata item with a readable PDF | Preserve metadata and privately retained PDF evidence. Analyze extracted text. | Root normalization is generic across item types. A stored PDF is the preferred attachment. |
| Standalone PDF | Create a source under the attachment's own key. Analyze its text. | Normalization includes attachment roots. Artifact selection includes the root file. |
| Scanned PDF without a text layer | Report unavailable text or use an explicitly supported image path. | Extraction reports review when fewer than 80 characters remain. A child screenshot can rescue a bibliographic parent. A standalone scanned PDF has no automatic OCR path. |
| Webpage with an uploaded single-file HTML snapshot | Analyze saved HTML and retain those bytes. | Stored HTML is selected after PDF. Readability extracts the main page text. |
| Older compressed snapshot | Unpack a bounded archive before HTML extraction, or report a specific unsupported archive result. | Downloader does not inspect compression headers or unpack ZIP files. Declared HTML can be passed to the HTML parser while bytes are compressed. |
| Public webpage with a URL and no snapshot | Retrieve bounded public content. Label any browser recovery as a later live capture. | Root HTTP URLs use the bounded downloader. HTML can use configured browser recovery. |
| Blocked, private, or removed webpage with an abstract or caption | Use saved metadata and explain that page content was unavailable. | `savedMetadata` uses root `abstractNote`, although the extraction failure state can replace a more specific failure reason. |
| Metadata item without a URL, file, abstract, or note | Retain its bibliographic metadata. Report metadata-only without invented content. | Existing path does this. No analysis evidence is available. |
| Standalone PNG, JPEG, or WebP | Retain the image and send one checked image to vision analysis. | Supported within 5 MB, 8192 pixels per side, and 40 million pixels. The output labels generated visual interpretation. |
| Image attached to a parent, optionally with a caption | Analyze the checked image and saved caption. Preserve the parent URL and metadata. | A stored image is selected when PDF and text attachments are absent. Root `abstractNote` provides caption text. |
| PDF or HTML plus a child screenshot | Prefer readable text. Use the screenshot when text extraction is unusable. | This fallback exists after extraction returns a result. A download exception happens before the fallback and bypasses it. |
| Several PDFs, several screenshots, or a screenshot carousel | State which artifact was analyzed and whether other files were omitted. | Selection analyzes one preferred artifact, ordered by item key within format priority. No merging of PDFs or carousel images exists. |
| Standalone note | Create a source, derive a readable title, and preserve note text as human evidence. | `normalize` excludes standalone notes entirely. |
| Bibliographic item with a child note | Preserve the note text, even without a readable file or URL. Distinguish human commentary from source document text. | Child notes affect fingerprints and are retained in snapshots. Extraction never reads their `note` fields. |
| Attachment with a saved `note` field | Preserve that human text and its attachment identity. | Snapshot retains it. Extraction ignores attachment `note`. |
| PDF, EPUB, or snapshot with highlights and comments | Preserve annotation text, comments, page labels, and attachment identity. Annotation edits must produce a new generation. | Descendant annotations affect the fingerprint. Extraction ignores annotation text and comments. |
| Standalone note or child note with embedded images | Preserve note text. Handle embedded images separately, with a visible coverage limit. | Standalone notes are excluded. `embedded_image` attachments are excluded from artifact selection. |
| Standalone HTTP linked attachment | Fetch the public URL when supported, rather than requesting synced file bytes. | A root attachment's HTTP URL can use the ordinary URL path. |
| Child `linked_url` with a parent lacking its own URL | Fetch a bounded public HTTP link or report why it cannot be fetched. | Child linked URLs are not candidates, so the source can become metadata-only. |
| `linked_file` or attachment using another program's URI | Explain that the cloud worker cannot read local files or application links. Preserve saved notes. | Imported modes alone are selected. Root normalization rejects non-HTTP URLs. The current reason does not identify a linked-file limitation. |
| Stored TXT, Markdown, CSV, or JSON | Retain bounded bytes and analyze readable text. | `text/*` and `application/json` are selected and decoded as UTF-8. Charset-specific decoding is absent. |
| Stored EPUB, DOCX, XLSX, audio, or other unsupported binary | Retain or explicitly reject the file. Show a format-specific review state, without treating unread bytes as text. | Most unsupported-only files are never selected. They can produce generic metadata-only instead of the unsupported-format branch. No native parser exists for these formats. |
| Stored video | Preserve metadata and state that video analysis is unsupported. | Video is selected and retained, then reports review with guidance to save a still image. |
| GIF, SVG, TIFF, or malformed image | Report a supported-format or validation error. Preserve notes or caption when possible. | Image selection reaches validation, which accepts only PNG, JPEG, and WebP with matching headers. |
| Attachment metadata arrives before bytes, or Zotero Storage lacks the file | Keep durable retry state and eventually show a repairable review result. | `MissingArtifact` schedules five-minute retries. After the bounded budget, the snapshot remains but extraction falls back to review or saved metadata. |
| File, note, annotation, or parent relationship changes | Reprocess the affected root once. Retain older input snapshots. | Normalization fingerprints root metadata plus all descendants. Full snapshots include child-only changes. |

The highest-value baseline gaps were standalone notes, child notes, annotation text, and child HTTP links. This task fixes those paths. Unsupported binaries now reach retention and report their format limit. Supporting every possible binary format would require separate parsers and is outside this change.

The baseline lacked a comparison with Zotero's saved `md5`. Downloads now compute the MD5 of the returned bytes and compare it with the attachment metadata before retaining them. A mismatch enters the missing-file retry path. Our separate SHA-256 records still validate retained originals.

## Deletion and free storage

Zotero currently gives individual accounts 300 MB of free file storage. Images, PDFs, snapshots, and other files use that storage. Group files count against the group owner's account. [Storage plans](https://www.zotero.org/storage)

Moving an item to Trash does not reclaim attachment quota. Zotero says files count until permanently removed from Trash. A local library can contain more files than its online quota, and queued local uploads can refill space after deletion. [Quota and local storage](https://www.zotero.org/support/kb/storage_quota_and_local_storage)

Write access to the target library permits API deletion. The documented single-item operation is `DELETE <libraryPrefix>/items/<itemKey>` with `If-Unmodified-Since-Version` set to the item version. Bulk deletion accepts up to 50 keys with the library version. Concurrent edits cause `412`; omitting the required precondition causes `428`. The documentation describes write access, without a separate delete-only permission. [Write requests](https://www.zotero.org/support/dev/web_api/v3/write_requests#deleting_an_item)

Keys can separately grant library, notes, and write access. Verify effective access using `/keys/current` rather than inferring permission from a secret name. [OAuth permissions](https://www.zotero.org/support/dev/web_api/v3/oauth), [Key verification](https://www.zotero.org/support/dev/web_api/v3/syncing#1_verify_key_access)

The documented item deletion operation removes the attachment item. I found no documented per-file `DELETE` that preserves the same attachment item. At revision `3b85c35d`, the server's file endpoint excludes `DELETE` from its allowed methods. The ordinary item endpoint accepts it. This is source-code evidence. [Items controller method checks](https://github.com/zotero/dataserver/blob/3b85c35d3a7b81fc2c6a04a7dd898a0b3e5e6151/controllers/ItemsController.php#L129)

## Deletion handling in this code

These observations include code inspection and the dev keys' `/keys/current` responses.

- [Zotero.request](../../apps/worker/src/zotero.ts) uses `fetch` without a method or body option. All integration requests are reads. There is no outbound Zotero deletion or storage cleanup operation.
- The client takes a full paginated snapshot with `includeTrashed=0`. Before this task, [discovery](../../apps/worker/src/pipeline.ts) marked missing roots inactive. The user clarified that Zotero transports captures while the app keeps them. Discovery now preserves app sources when Zotero roots disappear or leave the configured collection. [The removal test](../../tests/ingestion.test.ts) verifies that no replacement generation or inactive record is created.
- The client does not read `/deleted` or trashed metadata. It therefore cannot explain which of those causes removed the root. Zotero provides deleted keys through `/deleted?since=<version>` for clients that need that distinction. [Deletion feed](https://www.zotero.org/support/dev/web_api/v3/syncing#ii_get_deleted_data)
- Deleting a child note or attachment changes its parent's fingerprint because the descendant list changes. The root stays active if its metadata item remains in the collection.
- [SourceArtifacts](../../apps/worker/src/source-artifacts.ts) stores artifact receipts and selections under the source fingerprint. Intentional removal of a child attachment produces a different fingerprint. A new generation does not automatically reuse the old retained artifact, even if Blob Storage still has its bytes. If no URL, abstract, or other usable input remains, cleanup could replace a useful generated note with metadata-only output.
- This pipeline preserves old snapshots and artifacts; it does not reclaim Zotero quota merely by copying a file into Azure.

## Deletion design issue

[Design app deletion and Zotero attachment cleanup without losing imported sources](https://github.com/DrBushyTop/research-capture-knowledge-base/issues/41) tracks the remaining design. The app needs its own delete and restore behavior, plus a rule that prevents polling from recreating a source the user deleted in the app. Zotero removal leaves sources readable. The issue also covers child removals, later Zotero edits, retained evidence across cleanup, credential scope, and quota reclamation.

Cleanup needs a separate write credential, an explicit retention policy, and a preview listing attachment keys, byte sizes, and retained evidence before deletion.

Cleanup must verify that every selected attachment's original bytes exist in private storage and match their retained hash. It must preserve parent metadata, human notes, annotation provenance, and the readable generated result. Preserve evidence across the new fingerprint caused by cleanup so the next poll does not replace analyzed content with an empty generation.

Use current object versions for each deletion, handle `412` by rereading and reevaluating, and keep a durable record of completed actions. Record the expected loss of Zotero file access on synced devices. Test interruption recovery and confirm quota behavior against sacrificial dev attachments. Trashing alone does not satisfy quota reclamation.

Do not promise selective cloud-byte removal while leaving the same stored attachment on every Zotero device. That operation was not established by the documented file API. The issue should resolve whether attachment-item deletion is acceptable before implementing cleanup.

## Initial dev verification, processing version 3

The initial dev library contained 29 items at library version 37, representing 24 root sources, four PDF attachments and one PNG attachment. It had no notes, annotations, standalone files, saved HTML snapshots or child HTTP links. The cloud dev database, `research`, and local dev database, `research_dev`, both contained 24 source notes. Their historical extraction results differed.

The ordinary key's `/keys/current` response grants user-library, file and note reads without user-library write access. The separate `zotero-api-key-write` grants user-library write access. Both were read from the dev vault without logging their values. The worker still uses only the ordinary key.

The operator created 16 new root cases and their children in `Ingestion matrix - dev`, collection `ARLBMXDL`. The final library has 57 items and 40 roots. Existing captures were reused as the PDF, chart, webpage and saved-caption representatives. Repeating the fixture seed creates no new items and performs no file overwrites.

At 2026-10-07T23:37:11.392Z, library version 83, all 20 cases below passed the real extraction and processing flow using dev Zotero reads, local Azurite, Azure SQL `research_dev`, and the dev `research-sol` model. Nineteen sources published, sixteen generated analysis, and one unsynced attachment remained pending with a five-minute retry. The three sources without readable evidence published explicit limitations without generated analysis. This validates the code in this checkout, rather than claiming a deployed worker version.

Three historical local sources initially lacked their original bytes in Azurite. The validator copied only their known, hash-verified originals from the dev storage account. No missing or changed original was replaced with an unrelated file. All captures with retained artifacts passed replay with Zotero unavailable.

A second processing run passed the same 20 cases, reused every completed job ID, and made zero model calls.

| Capture checked | Root key | Evidence result | Processing result |
| --- | --- | --- | --- |
| unsupported-audio | `3QWEXKND` | needs-review, none | Published without invented analysis |
| json-data | `FSH6NQ34` | text, text | Published with analysis |
| plain-text | `DCWM6IEK` | text, text | Published with analysis |
| standalone-image | `9Y2972JQ` | image, image-vision | Published with analysis |
| standalone-pdf | `3V3YD9QV` | text, pdf-text | Published with analysis |
| metadata-only | `BK5JASIB` | metadata-only, none | Published without invented analysis |
| blank-pdf-with-image | `FKPRFS6V` | image, image-vision | Published with analysis |
| pending-file | `3PC6FVSI` | Pending with a sync retry | No inference before file sync |
| note-with-embedded-image | `A73DX3GN` | image, image-vision | Published with analysis |
| compressed-html | `XIDTWD3M` | needs-review, none | Published without invented analysis |
| child-linked-url | `CIUBGMAR` | text, html | Published with analysis |
| saved-html | `BFRN84P5` | text, html | Published with analysis |
| image-with-note | `DK7V2QVC` | image, image-vision | Published with analysis |
| pdf-with-note-and-annotation | `4KUMSYAA` | text, pdf-text | Published with analysis |
| parent-with-note | `D6BIHBJY` | metadata-only, zotero-metadata | Published with analysis |
| standalone-note | `FRXWTVK8` | text, text | Published with analysis |
| NASA (@nasa) • Instagram photo | `BG5478UN` | metadata-only, zotero-metadata | Published with analysis |
| Annual CO₂ emissions | `JRIPDW25` | image, image-vision | Published with analysis |
| Using the Fetch API | `FB75CUEK` | text, html | Published with analysis |
| Management of Fibromyalgia Syndrome | `PBA4T3PN` | text, pdf-text | Published with analysis |

Saved notes, attachment notes, highlight text, comments and page labels now reach retained analysis input with human commentary labels. Standalone notes become sources. Embedded note images use the checked image path. Child HTTP links use the public downloader. Unsupported stored binaries are retained and report their format limit. A missing preferred file can fall back to another synced attachment. Downloads reject bytes that disagree with Zotero's recorded MD5.

The pipeline tries at most eight stored attachments in PDF, text, image and other-format order. It selects one successful artifact per source and records the omitted-attachment limitation when several are present. Multi-image analysis, merged PDFs, automatic scanned-PDF OCR, compressed-snapshot unpacking, native Office/EPUB parsing and audio/video transcription remain outside this change. Local linked files cannot be retrieved through the cloud API and now receive a specific review reason.

Processing version is now `3` in the shared default and infrastructure default so a deployment can rerun older captures with the new extraction rules. Existing cloud app settings can override that default.

Reproduce with `npx tsx scripts/seed-zotero-dev.ts --apply`, then `npx tsx scripts/validate-zotero-dev.ts --process --restore-dev-artifacts`. The seed uses only the dev write secret. Processing refuses a non-dev SQL database. Results and verbose logs stay in ignored `.local/` files.

## Multiple attachments, DOCX and full-document access

Processing version `4` adds deterministic ingestion of up to eight stored attachments totaling 80 MiB, with a 40 MiB per-file limit. Readable PDFs, DOCX and supported text files share the analysis preview. Up to four checked images reach vision analysis in attachment order. Missing, unsupported, oversized or unreadable siblings receive explicit limitations. A valid sibling can still publish useful evidence. Each retained attachment keeps its key, hash, MIME, retrieval time and extraction result. Replay uses the same generation's attachment set rather than changing its evidence when another file later syncs.

LiteParse supports DOCX by converting it with LibreOffice. We do not provision LibreOffice in the worker, so this change uses Mammoth for native DOCX structure after bounded ZIP validation. Headings, paragraphs, lists, tables, footnotes, readable headers and footers, and Word comments reach extracted text. Embedded images, charts and objects stay in the retained original and receive an omission reason. Old Word formats remain unsupported. [LiteParse Node documentation](https://github.com/run-llama/liteparse/blob/ab8879623ee45a0b7a775d12b42a9a7ae9dab16b/packages/node/README.md), [DOCX extractor](../../apps/worker/src/docx-text.ts).

The goal is to extract and retain the full readable text for ordinary files. The initial model analysis has a separate 180,000-character preview, triple the original limit, and takes at most the first 400 PDF pages. That preview does not cap reader access, search or chat. The original file remains private and retained. Full text belongs to the exact generation and file hash, with chunk hashes and page or document locators. The reader loads successive windows. Chat can find text anywhere in the retained files, choose an attachment, read ordered PDF page ranges and continue with a returned offset.

PDF full extraction attempts 2000 pages and 40 MiB of text, with OCR disabled and a hard 120-second process deadline. These are extraction safeguards, separate from the analysis preview. Any reached guard, missing text layer or partial parse remains visible through full-text completeness and its reason. DOCX ZIP validation allows 80 MiB total expanded content, 16 MiB per XML file and 2000 entries. Downloads have a 60-second deadline, inference requests have a six-minute deadline, and Functions has a 20-minute timeout. Image limits remain 5 MiB, 8192 pixels per side and 40 million pixels.

The dev library now contains 77 items and 48 roots at library version 115. Eight new matrix roots add the cases below. The seed's repeat preview reports zero new items and never overwrites existing file bytes.

| New case | Root key | Expected coverage |
| --- | --- | --- |
| Standalone DOCX | `HBREQGAC` | Heading, paragraphs and table text, retained DOCX |
| DOCX with saved note | `PACKR38W` | Document text plus separately labeled human commentary |
| Multiple documents | `K22QBI7U` | Both PDFs in analysis and independently readable full text |
| Image carousel | `SNRRHHX3` | Both checked images in vision input |
| Mixed attachments | `N74R2JFP` | PDF, DOCX and image evidence with file-specific links |
| Partially synced attachments | `WX839Q4I` | Readable PDF with explicit unavailable-image limitation |
| Long DOCX | `STFXS37B` | Final evidence retained beyond the 180,000-character preview |
| Long PDF | `NB9Q7PSK` | Page 451 retained and readable beyond the 400-page preview |

At 2026-10-08T05:16:36.373Z, all 28 cases passed extraction and real processing using dev Zotero, local Azurite, Azure SQL `research_dev` and the `research-sol` model. Twenty-seven sources published, twenty-four generated analysis, and the unsynced-only capture remained pending with a retry. Retained-file replay passed with Zotero unavailable. The published long DOCX and page 451 of the long PDF passed reader access, full-text indexing and chat retrieval checks. A repeat run reused all completed generation IDs and made zero model calls. The first indexing check exposed a SQL collation mismatch; the corrected join also passed a dedicated test against the actual dev SQL database.

Remaining extraction work includes scanned-PDF and image OCR, compressed HTML snapshots, EPUB, spreadsheets, presentations, audio/video transcription, additional image formats and charset-aware text decoding. DOCX embedded visual content is not interpreted. Local linked files still require a synced copy because the cloud API cannot retrieve a desktop path. Old Word formats are deliberately excluded from the current work.
