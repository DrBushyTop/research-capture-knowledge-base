# Reader startup performance

Measured on October 7, 2026. The repeated sign-in screen came from a serial request chain. Every hosted page load waited for `POST /api/session` before mounting the selected page and requesting its data. The browser already retained the 30-day HttpOnly cookie.

## Changes

The reader now starts private data requests without waiting for background renewal. Each request still validates the cookie on the server. Session rejection clears private queries. Network errors and temporary renewal failures do not revoke access.

Versioned public assets now allow browser caching. HTML, APIs, authentication responses and the service worker remain uncached. Chat and Categories load on demand. Hover or focus on their links can preload their code.

Session requests within ten minutes of a successful renewal skip the SQL lease and write. Validation still checks expiry and the current account allowlist.

Source-text and original-file reads fetch the current active source directly from SQL. They no longer build or load the entire chat retrieval snapshot. Source-generation and artifact checks remain in place.

The worker imports extraction, browser capture and PDF parsing only when processing a capture. Reader HTTP startup no longer imports those dependencies.

## Measurements

These are individual local measurements, not production latency guarantees.

| Measurement | Before | After |
| --- | --- | --- |
| Sources request start with a three-second session response | 3,059 ms | 80 ms on first load, 20 ms on refresh |
| Versioned code, CSS and font transfer on refresh | Browser downloads files again | 0 bytes in the browser test |
| Initial JavaScript, gzip build size | 175.61 KB | 156.72 KB |
| Initial CSS, gzip build size | 18.53 KB | 7.42 KB |
| SQL session renewal | 321 ms with lease and write | 46 to 54 ms for recent-session validation |
| Source-text read with an established SQL connection | 154 to 157 ms | 95 to 103 ms |
| Worker entrypoint import in a fresh Node process | 822 ms | 448 ms |

The browser comparison used the deployed old reader bundle and the fixed production build against the same synthetic API. The API delayed session renewal by three seconds and returned two synthetic sources. The fixed reader loaded sources before renewal completed. Desktop and phone checks passed. Refresh reused the public asset cache.

SQL timings used the development database with 24 sources. The library returned about 250 KB of JSON, including about 131 KB of searchable source text. Warm library reads took 77 to 85 ms. The production database was empty when inspected, so it was not a useful library benchmark.

An unauthenticated production session request took 6.84 seconds once and 0.52 seconds on a repeat. The worker has no always-ready instances. Those observations are consistent with cold-start overhead but do not isolate the proxy, worker host and database contributions. The browser used for verification had no production sign-in, so authenticated production load time remains unmeasured.

## Remaining work

Keeping an HTTP instance warm could reduce the first private API delay after inactivity, but it adds an ongoing Azure charge. This change does not enable it.

If the collection grows, measure library payload size and browser search-index construction before separating list metadata from note and search content. Do not persist private corpus responses in browser storage merely to disguise network latency.
