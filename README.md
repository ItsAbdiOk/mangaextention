# Manga Chapter Counter

A Chrome extension that shows real-time chapter counts and scanlation group links on AniList manga pages.

AniList doesn't show chapter counts for ongoing series. This extension pulls data from official sources and scanlation trackers to show you exactly how many chapters are out and where to read them.

## Features

- **Chapter counts from official sources** — Scrapes Webtoon, Naver Series, Tapas, and other platforms linked on AniList
- **Raw chapter count via MangaUpdates** — Shows the latest raw chapter number even when official sources are JS-rendered
- **Scanlation group links** — Shows which groups are translating, their latest chapter, and links directly to the series page
- **Deep linking** — For supported sites (Asura, etc.), links go directly to the manga's page, not just the homepage
- **Multi-language support** — Shows chapter counts per language (KR, EN, FR, TH, etc.)
- **SPA-aware** — Works with AniList's client-side navigation, updates when you browse between manga

## How It Works

1. When you visit an AniList manga page, the extension:
   - Queries AniList's GraphQL API for external links and metadata
   - Fetches official source pages (Webtoon, Naver, Tapas) and parses chapter counts from their HTML
   - Queries MangaUpdates for the latest raw chapter count, scanlation groups, and alternative titles
   - Resolves deep links to scanlation sites using their search APIs
2. Results are injected into the sidebar next to the Status field

## Supported Sources

### Official Platforms (direct HTML scraping)
| Source | Languages | Method |
|--------|-----------|--------|
| Webtoon | EN, KR, TH, FR, etc. | `episode_no` from HTML |
| Naver Series | KR | Episode count patterns |
| Naver Webtoon | KR | Episode count patterns |
| Tapas | EN | `episode-cnt` element |
| Kadocomi / Comic Walker | JP | Chapter patterns |

### Fallback
| Source | Data |
|--------|------|
| MangaUpdates API | Latest raw chapter, scanlation groups, per-group chapter counts (via RSS) |

### Scanlation Deep Links
| Site | Method |
|------|--------|
| Asura Scans | Search API with alt titles from MangaUpdates |
| Other sites | Fallback search URL (`?s=title`) |

## Installation

1. Clone or download this repo
2. Open `chrome://extensions` in Chrome
3. Enable **Developer mode** (top right toggle)
4. Click **Load unpacked** and select the `mangaextention` folder
5. Visit any AniList manga page (e.g., [anilist.co/manga/163824](https://anilist.co/manga/163824/Revenge-of-the-Baskerville-Bloodhound/))

## Architecture

```
manifest.json     — Manifest V3, content script + background service worker
background.js     — Cross-origin fetches, AniList/MangaUpdates API calls, deep link resolution
content.js        — AniList page detection, DOM injection, SPA navigation handling
parsers.js        — Source-specific HTML parsers (Webtoon, Naver, Tapas, etc.)
styles.css        — Matches AniList's sidebar styling
```

### Data Flow
```
AniList page → Extract manga ID
                ↓
         AniList GraphQL API → external links + titles
                ↓                        ↓
    Scrape official sources     MangaUpdates API
    (Webtoon, Naver, Tapas)     (chapters, groups, RSS, alt titles)
                ↓                        ↓
         Parse chapter counts    Resolve scanlation deep links
                ↓                        ↓
              Inject into AniList sidebar
```

## Adding New Sources

### Official source parser
Add a parser function to `parsers.js` and register it in `SITE_PARSER_MAP`:

```js
parseMySource(html) {
  const match = html.match(/Total (\d+) chapters/);
  return match ? parseInt(match[1], 10) : null;
}
```

### Scanlation site deep link
Add a search config to `SITE_SEARCH_CONFIGS` in `background.js`:

```js
"mysite.com": {
  type: "json_api",
  searchUrl: (base, query) => `${base}/api/search?q=${encodeURIComponent(query)}`,
  headers: { Referer: "https://mysite.com/" },
  parseResult: (json, base) => {
    if (json.results?.length > 0) return `${base}/manga/${json.results[0].slug}`;
    return null;
  },
}
```

## Permissions

- `declarativeNetRequest` — Strip extension origin headers from API requests
- `host_permissions` — Fetch from AniList API, MangaUpdates API, official manga platforms, and scanlation site APIs
