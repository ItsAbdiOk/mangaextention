# CLAUDE.md

Guidance for Claude Code (claude.ai/code) when working in this repository.

## Project Overview

Chrome extension (Manifest V3) that augments AniList manga pages with:
1. **Chapter counts** (RAW / EN / SCAN) in the sidebar, scraped from official sources + MangaUpdates
2. **Release schedule** ("Weekly · Next ~Apr 10") calculated from source release dates
3. **Scanlation groups** with favicons and per-group latest chapters, placed near AniList's External & Streaming links

No build step. No dependencies. Loaded as an unpacked extension.

## Architecture

```
manifest.json   — MV3 config; declares content script on anilist.co/manga/*
                  and host_permissions for each source domain
background.js   — Service worker: cross-origin fetches, API calls,
                  in-memory LRU cache (50 entries, 30min TTL),
                  Origin-stripping rule for MangaUpdates API
content.js      — Content script: runs on AniList manga pages.
                  Fetches data via background worker messages,
                  injects DOM elements into sidebar and near external links,
                  handles SPA navigation (pushState/replaceState overrides)
parsers.js      — Site-specific HTML parsers (chapter counts + release dates).
                  Declares globals consumed by content.js:
                  Parsers, SITE_PARSER_MAP, getParserForSite, parseDatesFromSource
styles.css      — Uses AniList CSS variables (--color-foreground,
                  --color-text, --color-text-lighter) for dark mode compat
```

### Data flow

```
AniList /manga/{id} page
    ↓
content.js extracts ID → asks background.js for data
    ↓
background.js in parallel:
  1. AniList GraphQL → title, externalLinks, chapters, volumes
  2. MangaUpdates REST API:
       POST /v1/series/search → series_id
       GET /v1/series/{id}    → latest_chapter, last_updated, completed
       GET /v1/series/{id}/groups → scanlation groups
       GET /v1/series/{id}/rss    → per-group latest chapter (regex parsed)
  3. Source pages (Webtoon, Naver, Tapas, Kadocomi) → HTML
       ↓ parsers.js extracts chapter count + release dates
    ↓
content.js:
  - Injects "Chapters" data-set (RAW / EN / SCAN rows) after Status
  - Injects "Schedule" data-set (Weekly · Next ~Apr 10 or Updated X days ago)
  - Injects "Scanlation Groups" section after .external-links
    (or appended to .sidebar when external links don't exist)
```

## Key conventions

**Site name matching.** `parsers.js` maps AniList's `externalLinks.site` strings to parser functions. AniList uses inconsistent casing (`WEBTOON` vs `Webtoon`, `KakaoPage` vs `Kakao Page`). The map has entries for each variant.

**Language resolution.** `resolveLangCode(link)` in `content.js`:
1. Use `LANG_LABELS[link.language]` if AniList provides a language
2. For WEBTOON, parse the URL path segment (`/en/`, `/fr/`, `/th/`) as the locale
3. Fall back to `SITE_LANG_FALLBACK[link.site]` (e.g., `Naver Series → KR`)
4. Give up and return `"?"`

**Sidebar filtering.** Only RAW / EN / SCAN are shown. Other languages (TH, FR, CN) are collected but not displayed, per user preference.

**SCAN row** is the maximum `latestChapter` across all active MangaUpdates scanlation groups (computed in `content.js` during `injectChapterCounts`).

**RAW row** prefers official source counts (KR/JP/CN) over MangaUpdates's `latest_chapter` when available.

**Schedule calculation** (`calculateSchedule()` in content.js):
1. If ≥ 3 release dates from sources (Webtoon, Tapas): compute average interval over last 8 → format as `Weekly / Every ~N days / Biweekly / Monthly / Every ~N days`
2. Project next release from `lastDate + avgInterval`; if in the past, roll forward
3. Fallback: `Updated X days ago` from MangaUpdates `last_updated`
4. Only shown for ongoing series (`status === "RELEASING"` and not MU-`completed`)

## Security

- **URL allowlist** in `background.js` (`ALLOWED_FETCH_DOMAINS`) — the `FETCH_URL` message handler validates URLs before fetching to prevent the background worker being used as an open proxy.
- **URL validation** on scanlation group sites — only `https?://` schemes are used as href attributes.
- **`encodeURIComponent`** on favicon domain before interpolating into Google's favicon URL.
- **No innerHTML / eval / inline scripts.** All DOM built via `createElement` + `textContent`.

## Known constraints

**`DOMParser` is unavailable in MV3 service workers.** `background.js` uses regex to parse MangaUpdates RSS. Don't revert to DOMParser — it will silently fail and break scanlation group chapter counts.

**CORS preflight for MangaUpdates.** MangaUpdates API rejects requests with `Origin: chrome-extension://...`. Handled by two declarativeNetRequest rules (ids 1 and 2) stripping the Origin header for both `xmlhttprequest` and `other` (preflight) resource types.

**Spoofed User-Agent is forbidden.** Previously used a Chrome UA string. Removed per Chrome Web Store policy.

**JS-rendered sites** (Bilibili, Piccoma, Lezhin, Manta, Tappytoon, MangaPlus, KakaoPage episode lists) cannot be parsed server-side. Not in `SITE_PARSER_MAP`; their AniList links simply aren't scraped.

## SPA navigation

AniList is a Vue SPA. `content.js` monkey-patches `history.pushState` and `history.replaceState` and listens for `popstate`. A `MutationObserver` on `document.body` is a last-resort fallback. When the URL changes, the script re-runs `run()` which tears down and re-injects everything.

## Testing checklist

Load unpacked at `chrome://extensions`, then verify:

1. **`anilist.co/manga/170724/`** (Returned by the King — ongoing, weekly)
   - Sidebar: RAW / EN / SCAN rows
   - Schedule: "Weekly · Next ~<date>"
   - Scanlation Groups section at bottom with favicons
2. **`anilist.co/manga/163824/`** (Revenge of the Baskerville Bloodhound)
   - Same as above, SCAN should be ~157 (Asura)
3. **`anilist.co/manga/182852/`** (Chinese manhua without English license)
   - Sidebar: just RAW / SCAN (no EN)
   - Scanlation Groups appended to end of `.sidebar` since no `.external-links`
4. **A completed manga** (any with `status: FINISHED`)
   - Schedule row should NOT appear

## What NOT to do

- Don't add a build system (Webpack / Vite / esbuild). MV3 content scripts run as-is.
- Don't add frameworks (React / Vue). All DOM is vanilla.
- Don't hardcode colors that won't work in AniList dark mode — use CSS variables.
- Don't use `DOMParser` in `background.js` — it's not available in MV3 service workers.
- Don't remove `declarativeNetRequest` rule id 2 (preflight) — MangaUpdates breaks without it.
- Don't re-add `User-Agent` header spoofing — it violates Chrome Web Store policy.
- Don't show TH/FR/CN rows in the sidebar — user wants only RAW / EN / SCAN.

## Version bumps

Update `manifest.json` "version" whenever shipping a user-visible change. Use semver loosely: major for breaking UI redesigns, minor for new sections/features, patch for bugfixes.
