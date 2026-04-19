# Changelog

## 2.2.0

- **Release schedule in sidebar.** Shows "Weekly · Next ~Apr 10" calculated from Webtoon/Tapas release dates. Falls back to "Updated X days ago" from MangaUpdates when dates aren't available.
- Only displayed for ongoing series (hidden for completed/hiatus).
- `parsers.js`: added `parseDatesFromSource()` and `parseDatesWebtoon()`.
- `background.js`: added `lastUpdated` and `completed` to MangaUpdates response.

## 2.1.0

### Security
- Added URL allowlist to the `FETCH_URL` message handler to prevent the background worker being used as an open proxy.
- Validate scanlation group site URLs before using as `href` (only `https?://` allowed).
- Sanitize favicon domain with `encodeURIComponent`.
- Removed spoofed User-Agent headers (violates Chrome Web Store policy).
- Groups with no site URL now render as `<div>` instead of dead `<a href="#">`.

### Performance
- LRU cache eviction at 50 entries.
- Removed 6 unused host_permissions (JS-rendered sites that never parsed successfully).

### Code quality
- Replaced fragile regex RSS parsing with DOMParser (later reverted — see 2.1.1).
- Removed dead `parseMangaPlus` and `parseGeneric` functions.
- Removed all `console.log` / `console.error` from production paths.

### Polish
- Dark mode support: all hardcoded colors replaced with AniList CSS variables.
- Added 16px icon.
- Added `homepage_url` to manifest.
- Rewrote README to match current codebase.

### 2.1.1 (hotfix, rolled into 2.1.0 commit log)
- Reverted DOMParser to regex — `DOMParser` is unavailable in MV3 service workers.
- Added second `declarativeNetRequest` rule for CORS preflight (OPTIONS) requests to MangaUpdates.

## 2.0.0

- **Redesigned UI.** Sidebar shows only chapter counts (RAW / EN / SCAN) next to Status. Scanlation groups moved from sidebar to a dedicated section near AniList's External & Streaming links.
- Styled to blend with AniList's native UI using CSS variables.
- Removed all deep-linking code (Asura / Flame / Omega / Lua site-specific API integrations) — the effort-to-value ratio wasn't worth the maintenance burden.
- Simplified from 577 lines to 194 lines across 4 files.

## 1.0.0

Initial release.
- AniList GraphQL API integration for external links and titles.
- HTML scraping for Webtoon, Naver Series, Naver Webtoon, Tapas, Kadocomi.
- MangaUpdates integration for RAW chapter count, scanlation groups, and per-group chapter counts via RSS.
- Scanlation deep links (Asura Scans, Flame Comics, Omega Scans, Lua Scans) — removed in 2.0.
- Favicons on scanlation group links via Google favicon service.
- SPA navigation handling for AniList client-side routing.
