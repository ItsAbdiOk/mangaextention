# Manga Chapter Counter

A Chrome extension that shows real-time chapter counts and scanlation group links on AniList manga pages.

AniList doesn't show chapter counts for ongoing series. This extension pulls data from official sources and scanlation trackers to show you exactly how many chapters are out and where to read them.

## Features

- **Chapter counts from official sources** — Scrapes Webtoon, Naver Series, Tapas, and other platforms linked on AniList
- **Raw chapter count via MangaUpdates** — Shows the latest raw chapter number even when official sources are JS-rendered
- **Scanlation chapter count** — Shows the latest scanlation chapter alongside raw and official counts
- **Scanlation group links** — Shows which groups are translating with favicons and links to their sites, placed near AniList's "External & Streaming links"
- **Release schedule** — Shows "Weekly · Next ~Apr 10" calculated from release dates of official sources
- **RAW / EN / SCAN rows** — Three concise rows in the sidebar: original language, English, and latest scanlation chapter
- **Dark mode support** — Uses AniList's CSS variables for seamless theme integration
- **SPA-aware** — Works with AniList's client-side navigation

## How It Works

1. When you visit an AniList manga page, the extension:
   - Queries AniList's GraphQL API for external links and metadata
   - Fetches official source pages (Webtoon, Naver, Tapas) and parses chapter counts from HTML
   - Queries MangaUpdates API for the latest raw chapter count, scanlation groups, and per-group chapters (via RSS)
2. Chapter counts are injected into the sidebar next to Status
3. Scanlation groups are shown at the bottom near External & Streaming links

## Supported Sources

| Source | Languages | Method |
|--------|-----------|--------|
| Webtoon | EN, KR, TH, FR, etc. | `episode_no` from HTML |
| Naver Series | KR | Episode count patterns |
| Naver Webtoon | KR | Episode count patterns |
| Tapas | EN | `episode-cnt` element |
| Kadocomi / Comic Walker | JP | Chapter patterns |
| KakaoPage | KR | `__NEXT_DATA__` patterns |
| MangaUpdates | All | REST API (chapters, groups, RSS) |

## Installation

1. Clone or download this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right)
4. Click **Load unpacked** and select the folder
5. Visit any AniList manga page

## Architecture

```
manifest.json   — Manifest V3 config
background.js   — Cross-origin fetches with URL allowlist, API calls, cache with eviction
content.js      — AniList DOM injection, SPA navigation handling
parsers.js      — Source-specific HTML parsers
styles.css      — AniList-native styling with dark mode support via CSS variables
```

## Security

- **URL allowlist** — The background fetch proxy only accepts requests for known source domains
- **URL validation** — All external URLs are validated before use as `href` attributes
- **No eval/innerHTML** — All DOM manipulation uses safe `createElement`/`textContent`
- **Cache eviction** — Memory-bounded cache prevents unbounded growth
- **No spoofed headers** — Uses the browser's real User-Agent

## Adding New Sources

Add a parser function to `parsers.js` and register it in `SITE_PARSER_MAP`:

```js
parseMySource(html) {
  const match = html.match(/Total (\d+) chapters/);
  return match ? parseInt(match[1], 10) : null;
}
```

Then add the domain to `ALLOWED_FETCH_DOMAINS` in `background.js` and `host_permissions` in `manifest.json`.

## Permissions

- `declarativeNetRequest` — Strip extension origin headers from MangaUpdates API requests
- `host_permissions` — Fetch from AniList API, MangaUpdates API, and official manga platforms
