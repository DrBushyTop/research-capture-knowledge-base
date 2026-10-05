# Zotero capture and incremental synchronization

Researched on 2026-10-05 for [Verify Zotero capture and incremental synchronization](https://github.com/DrBushyTop/research-capture-knowledge-base/issues/2). This report supports all four MVP phases and the private, signed-in reader. It resolves technical research, while leaving capture setup, retention, and content policy to the map's human decision tickets.

The repository has no initial commit. `git rev-parse --verify HEAD` fails, so a throwaway research branch cannot be based on existing history. This report was written in the working tree. No private library, account, credential, or capture sample was accessed.

## What capture can provide

| Capture path | Supported behavior and prerequisites | Consequence for the MVP |
| --- | --- | --- |
| Desktop browser | Install the desktop app and Zotero Connector. The Connector recognizes bibliographic metadata; many article pages also yield an accessible PDF. Generic pages produce a Web Page item. A direct PDF save can remain a standalone attachment when metadata recognition fails. [Adding items](https://www.zotero.org/support/adding_items_to_zotero) | Accept papers, webpages, and standalone PDFs. Bibliographic completeness and an attached PDF cannot be assumed. |
| Desktop app closed | An authorized Connector can save directly to zotero.org. Connector settings control automatic PDF and snapshot saving for this path. [Connector preferences](https://www.zotero.org/support/connector_preferences#general) | Test both desktop-open and desktop-closed saving. Record which path the user expects to use. |
| iPhone or iPad | The official app syncs personal and group libraries and saves web items and PDFs through Share in Safari and other apps. [Zotero for iOS](https://www.zotero.org/support/ios) | Verify the Share target, selected library, and collection on the actual phone. |
| Android | The official app saves shared URLs and recognizes directly saved PDFs. Automatic article-PDF downloads currently require a PDF accessible without login. The page describes EPUB and snapshot support as forthcoming. [Zotero for Android](https://www.zotero.org/support/android) | A publisher article may arrive with metadata but no PDF. Do not promise identical capture or snapshot behavior across phones. |
| Files and snapshots | Stored files can sync; linked files are local paths and do not sync. Browser snapshots and PDFs are child items. Snapshots are enabled by default but can be disabled. [Adding files](https://www.zotero.org/support/attaching_files) | Check actual file settings. Treat linked files as unavailable to the cloud worker until a separate import path is chosen. |

Saving on a device and availability through the cloud API are separate events. Data sync uploads metadata; file sync uploads attachments separately. Automatic desktop data sync is the default. Zotero Storage supports online attachment access; WebDAV applies to personal libraries and cannot serve group file sync. [Data and file syncing](https://www.zotero.org/support/sync)

Storage quota exhaustion can prevent file upload while the original device still opens the file. [Files not syncing](https://www.zotero.org/support/kb/files_not_syncing) Device sync errors also need checking, including the chosen libraries and account. [Changes not syncing](https://www.zotero.org/support/kb/changes_not_syncing)

No reviewed source provides a maximum delay between successful device capture and Web API availability. The proposed 5 to 15 minute timer is an ingestion interval after cloud availability, not a capture-to-reader guarantee. Missing metadata and missing bytes need distinct states.

## Identity, collection membership, and related items

User libraries use `/users/<numericUserID>`; group libraries use `/groups/<numericGroupID>`. Names are display values. [Library URLs](https://www.zotero.org/support/dev/web_api/v3/basics#user_and_group_library_urls) Group libraries are separate from My Library. [Zotero groups](https://www.zotero.org/support/groups)

Recommend this identity tuple for every observed object:

```text
provider = zotero
libraryType = user | group
libraryId = numeric ID
itemKey = Zotero object key

sourceId = zotero:<libraryType>:<libraryId>:<rootItemKey>
attachmentId = zotero:<libraryType>:<libraryId>:<attachmentItemKey>
```

The brief's `zotero-ABC123` example lacks library identity. Titles, URLs, DOIs, collection names, and topic folders should not determine identity. Keep those as metadata and deduplication hints. A copy to another library is a separate identity unless a later reconciliation policy explicitly joins it.

An item can belong to several collections without duplication. Removing it from a collection does not delete the library item. [Collections and tags](https://www.zotero.org/support/collections_and_tags) API membership lives in item `data.collections`; notes and attachments use `parentItem` to identify their parent. [Write API object model](https://www.zotero.org/support/dev/web_api/v3/write_requests#collection-item_membership)

Configure the Research Inbox by collection key. The plan must choose exact-collection or descendant membership. Do not infer that choice from a collection's name or the desktop view.

Maintain a parent map, including the previous parent before a change. Resolve an attachment or annotation through its parents to its root. On a move, mark both old and new roots for reconciliation. On deletion, the saved map is the only way to identify the affected root once the child metadata disappears.

There is no documented promise in the reviewed API pages that every child change increases the bibliographic parent's version. Treat child updates as independent signals. Reconcile the root when a relevant attachment changes even if its parent version is unchanged. A processing fingerprint should include the root metadata, selected attachment keys, versions and hashes, and the processing version. Using only the parent version would leave this gap.

Zotero stores its own PDF annotations in the database rather than the PDF bytes. [Annotation storage](https://www.zotero.org/support/kb/annotations_in_database) The server's child endpoint returns annotations under document attachments. [Items controller](https://github.com/zotero/dataserver/blob/6e091852b8a3e369056f390ba69e5de90cda1134/controllers/ItemsController.php#L498) Therefore an unchanged PDF hash does not prove unchanged research notes. Detect those changes; the content decision ticket must choose whether to import annotation text or just preserve its provenance.

## Verified API rules

Library and object versions increase monotonically but may skip numbers. Multi-object `Last-Modified-Version` describes the library; a single-object response describes that object. `since` uses the last completed library version, initially `0`. `If-Modified-Since-Version` supports a no-change `304`. [Sync versioning](https://www.zotero.org/support/dev/web_api/v3/syncing#version_numbers)

JSON lists default to 25 results and permit at most 100 per page. Follow `Link` with `rel="next"`; `itemKey` batches accept at most 50 keys. `format=versions` returns a complete key-to-version map without a default or maximum limit. [Pagination and formats](https://www.zotero.org/support/dev/web_api/v3/basics#sorting_and_pagination)

Include trashed items in the changed-item request. Permanent deletions come from `/deleted?since=...` and contain keys, not item content. Zotero recommends restarting reads when the library version changes during a sync. A failed object must either block checkpoint advancement or remain on a persistent explicit retry list. [Sync download and recovery](https://www.zotero.org/support/dev/web_api/v3/syncing#sync_library_data)

The public server code emits `data.deleted = 1` for trashed items. [Item serialization](https://github.com/zotero/dataserver/blob/6e091852b8a3e369056f390ba69e5de90cda1134/model/Item.inc.php#L4894) Also check root state before accepting child content. Trash, permanent deletion, and collection removal are different observations. Record their cause and let the retention policy determine the resulting content action.

## Attachment retrieval

Retrieve bytes using the attachment's key at `<libraryPrefix>/items/<attachmentKey>/file`, rather than the bibliographic item's key. Check the returned file against the attachment's `md5`; the documentation warns that mismatched current bytes may exist only in WebDAV. Registered file uploads change the attachment's `filename`, `mtime`, and `md5` and its version. [File API](https://www.zotero.org/support/dev/web_api/v3/file_upload#ii_download_the_existing_file)

The public server implementation checks file permission, returns `404` when no stored file exists, redirects to a temporary download URL, and reports whether the stored object is compressed. Its ZIP handling distinguishes archive and main-file hashes. This is source-code evidence, not a guarantee that the deployment matches that revision. [File request implementation](https://github.com/zotero/dataserver/blob/6e091852b8a3e369056f390ba69e5de90cda1134/controllers/ItemsController.php#L756)

Recommend a server-side downloader that captures redirect headers, follows the fresh URL promptly, and never forwards the Zotero key to a different host. Test PDF and snapshot downloads separately. Preserve the observed attachment key, version, MIME type, filename, Zotero hash, and a locally calculated SHA-256 beside any retained artifact. A compressed snapshot needs inspection of the archive and main document before extraction; an object-store ETag alone is insufficient.

A missing file needs durable retry state even after the metadata cursor advances. Record `awaiting-file`, retry count, next attempt, and last error. Recheck metadata and file availability independently of `since`. Stop repeated retries into a visible action-required state when the approved retry budget expires; keep a repair action. Whether to fall back to fetching the original URL belongs to the extraction policy ticket.

## Proposed polling and queue contract

This is a recommended implementation contract based on the rules above. It is stronger than assuming that one successful API request or queue send completes ingestion.

Keep one committed cursor per configured library. Use a library-wide metadata catalog to evaluate changes, but schedule content extraction only for eligible sources or previously tracked sources needing reconciliation. At minimum, the catalog needs key, version, type, parent, collection membership, trash state, and attachment hash. Collection-only polling can miss an item that leaves the Inbox, and top-level-only polling can miss changed children.

Suggested read sequence:

```text
C = committed library cursor
prefix = /users/<id> or /groups/<id>

GET prefix/items?format=versions&since=C&includeTrashed=1
    If-Modified-Since-Version: C
GET prefix/collections?format=versions&since=C
GET prefix/items?itemKey=<up to 50 keys>&limit=100&includeTrashed=1
    Repeat for the changed keys and required missing dependencies
GET prefix/deleted?since=C
```

1. Acquire the library poll lease. Load `C`, the catalog, pending file retries, and unfinished handoffs.
2. Request the changed versions. A `304` ends discovery only; pending handoffs and retries still run. On `200`, save the library version as candidate `V`.
3. Read changed metadata and collection information. Follow every JSON page and account for every requested key. Compare each multi-object response's library version with `V`. Never compare a single-object version header with `V`.
4. Read deletion keys at the same candidate version. If a response has a different library version, or a requested key is unexplained, abandon the candidate and retry from `C` with backoff. Bound the work per invocation; leave `C` unchanged when the budget expires.
5. Build the candidate catalog and impacted roots from both old and new relationships. Apply the approved membership rule. Mark collection removal, trash, and permanent deletion as reconciliation events. A deleted Inbox collection is a configuration error, not a request to find another collection with the same name.
6. Persist an immutable poll manifest containing the observed changes, candidate catalog reference, impacted roots, and recoverable processing intents. Then atomically commit a pointer containing `V` and that manifest reference using an ETag or an equivalent transactional mechanism. A checkpoint without recoverable intents is invalid. Choose the concrete Azure storage implementation in the ingestion protocol ticket.
7. Dispatch committed intents to Storage Queue. Sending and marking delivery are separate operations, so a crash can repeat a send. Reconcile unfinished intents on later runs. The dispatcher must resume committed manifests when discovery returns `304`.
8. The worker reads durable intent state and the current approved source inputs. Reject superseded generations before publishing output. Duplicate messages may repeat work, but must not duplicate content or overwrite a newer result. Record completed processing separately from the discovery cursor.

Use a small queue message with `sourceId`, `libraryType`, `libraryId`, `rootItemKey`, `intentId`, and `generation`. Store metadata snapshots and artifact references privately. Derive `generation` from the selected input fingerprint and processing version, so an attachment-only change can create a new generation.

The contract covers observed cloud changes. It cannot recover file bytes for an item permanently deleted before observation. Current-state polling also cannot reconstruct a brief Inbox membership that begins and ends between polls. Offline captures are outside its visibility until sync. The ingestion decision ticket must define how long captured items remain available and what acknowledgement means.

## Authentication and throttling

Use HTTPS, pin `Zotero-API-Version: 3`, and send the key in an HTTP header. Honor `Backoff` even on successful responses. For `429`, wait at least `Retry-After`, or use exponential backoff when absent. `503` may also specify `Retry-After`. Zotero recommends at most four concurrent requests. [API request rules](https://www.zotero.org/support/dev/web_api/v3/basics#rate_limiting)

A dedicated read-only key is appropriate for this personal integration. Zotero supports manual keys or OAuth 1.0a key exchange, with distinct library, note, write, and group permissions. Keys remain valid until revoked. [OAuth and permissions](https://www.zotero.org/support/dev/web_api/v3/oauth) Verify effective library and file access using `/keys/current`. [Key verification](https://www.zotero.org/support/dev/web_api/v3/syncing#verify_key_access)

Start with serial requests. Persist the next permitted request time rather than consuming a Function invocation on a long wait. Retry network errors and transient server failures with jitter. Treat revoked or insufficient access as an action-required state. Log identity, cursor, response status, retry deadline, and counts without key values or temporary download URLs. The reader's sign-in mechanism is a separate authorization system; a Zotero API key should stay in the ingestion service.

## Required capture experiments and acceptance checks

The immediate human task is three real captures using the actual phone and browser workflow. This research did not perform them. Record library and collection keys, root and attachment keys, metadata availability, file availability, capture time, and cloud observation time for each sample.

| Essential sample | What to verify |
| --- | --- |
| A research article landing page, preferably with an accessible PDF | The save reaches the intended Inbox, carries useful bibliographic metadata, and exposes whether PDF capture succeeded. |
| An ordinary webpage | The save reaches the same Inbox and exposes whether a snapshot or only a URL is available. |
| A directly saved PDF | The worker can recognize both a bibliographic parent and a standalone attachment if metadata retrieval fails. |

These samples establish the capture-to-cloud boundary and supported source shapes. The checks below are later implementation acceptance work or targeted follow-up experiments when the three samples expose a gap. They are not prerequisites for the user to answer the initial capture ticket.

| Check | Evidence to record | What it resolves |
| --- | --- | --- |
| Actual iOS or Android phone, including an article requiring publisher login | Share target setup; destination persistence across saves; saved metadata versus attached files; client versions | Supported phone workflow and login-related file gaps |
| Desktop open, desktop closed, and offline then online | Capture time, cloud metadata time, file availability time, errors and repair steps | The observation boundary and realistic ingestion latency |
| PDF or snapshot added later, replaced, moved between parents, or deleted | Changed child versions and hashes; parent versions; previous and new relationships | Root reconciliation for attachment-only changes |
| Annotation added or edited while the PDF bytes stay unchanged | Annotation item keys and versions; parent chain; unchanged file hash | Whether annotation changes are detected and what the later content policy may import |
| Inbox removal, trash, restore, permanent deletion, and Inbox collection rename or deletion | Membership arrays, trash marker, deletion keys, retained local relationship map | Correct observation causes without assuming the retention action |
| Snapshot file download | Redirect and compression headers; actual artifact format; archive and main-document hashes | Downloader compatibility and extraction input |
| Delayed file upload or safely simulated unavailable bytes | Durable retry record and eventual recovery after metadata checkpoint advancement | Files cannot be forgotten just because discovery completed |
| Inject crashes after manifest persistence, cursor commit, queue send, and worker completion | Replay outcome, unfinished intent recovery, content generation | Every committed eligible intent reaches completion or a visible action-required state |
| More than one API page or one 50-key batch, plus a concurrent change | Key accounting, candidate-version restart, unchanged old cursor on failure | Pagination and checkpoint correctness |

Do not stress Zotero to induce throttling. Test `Backoff`, `429`, `503`, revoked-key responses, and queue failures with recorded response fixtures.

Remaining unknowns are the user's library type and collection key, actual phone/browser workflow, current file-sync settings, corpus size, observed capture latency, snapshot packaging, and parent-version behavior for representative changes. These do not prevent choosing stable identity or safe checkpoint rules. They do prevent claiming that every device save already yields cloud-readable full text, and they leave retention, annotation import, and extraction fallback for the corresponding human decisions.
