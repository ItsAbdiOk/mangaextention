const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes
const CACHE_MAX_ENTRIES = 50;

// Allowed domains for the FETCH_URL proxy — only these can be fetched
const ALLOWED_FETCH_DOMAINS = [
  "series.naver.com",
  "comic.naver.com",
  "www.webtoons.com",
  "webtoons.com",
  "page.kakao.com",
  "webtoon.kakao.com",
  "tapas.io",
  "kadocomi.jp",
  "mangaplus.shueisha.co.jp",
  "pocket.shonenmagazine.com",
  "comic-walker.com",
];

// Strip chrome-extension:// Origin from MangaUpdates API requests
// Strip chrome-extension:// Origin from MangaUpdates API requests.
// Must cover both the actual request and the CORS preflight (OPTIONS).
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1, 2],
  addRules: [
    {
      id: 1,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Origin", operation: "remove" }],
      },
      condition: {
        urlFilter: "api.mangaupdates.com",
        resourceTypes: ["xmlhttprequest"],
      },
    },
    {
      id: 2,
      action: {
        type: "modifyHeaders",
        requestHeaders: [{ header: "Origin", operation: "remove" }],
      },
      condition: {
        urlFilter: "api.mangaupdates.com",
        resourceTypes: ["other"],
      },
    },
  ],
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_URL") {
    // Validate URL against allowlist to prevent open proxy abuse
    if (!isAllowedUrl(message.url)) {
      sendResponse({ ok: false, error: "URL not in allowlist" });
      return true;
    }
    fetchWithCache(message.url)
      .then((html) => sendResponse({ ok: true, html }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "FETCH_ANILIST") {
    if (typeof message.id !== "number") {
      sendResponse({ ok: false, error: "Invalid manga ID" });
      return true;
    }
    fetchAniList(message.id)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "FETCH_MANGAUPDATES") {
    fetchMangaUpdates(message.title)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }
});

/**
 * Check if a URL is in the allowed fetch domains.
 */
function isAllowedUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return ALLOWED_FETCH_DOMAINS.some(
      (domain) => hostname === domain || hostname.endsWith("." + domain)
    );
  } catch {
    return false;
  }
}

/**
 * Evict oldest cache entries when the cache exceeds the max size.
 */
function evictCache() {
  if (cache.size <= CACHE_MAX_ENTRIES) return;
  const entries = [...cache.entries()].sort((a, b) => a[1].time - b[1].time);
  const toRemove = entries.slice(0, cache.size - CACHE_MAX_ENTRIES);
  for (const [key] of toRemove) cache.delete(key);
}

/**
 * Build headers for source page fetches.
 * Naver sites need a Referer from their own domain.
 */
function getHeadersForUrl(url) {
  const base = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  };

  if (url.includes("series.naver.com")) {
    base["Referer"] = "https://series.naver.com/";
    base["Accept-Language"] = "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7";
  } else if (url.includes("comic.naver.com")) {
    base["Referer"] = "https://comic.naver.com/";
    base["Accept-Language"] = "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7";
  } else {
    base["Accept-Language"] = "en-US,en;q=0.9,ko;q=0.8,ja;q=0.7";
  }

  return base;
}

async function fetchWithCache(url) {
  const cached = cache.get(url);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.html;
  }

  const headers = getHeadersForUrl(url);
  const res = await fetch(url, { headers, redirect: "follow" });

  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).hostname}`);
  const html = await res.text();
  cache.set(url, { html, time: Date.now() });
  evictCache();
  return html;
}

async function fetchAniList(mediaId) {
  const cacheKey = `anilist:${mediaId}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  const query = `
    query ($id: Int) {
      Media(id: $id, type: MANGA) {
        chapters
        volumes
        status
        title { english romaji native }
        externalLinks {
          url
          site
          language
          type
        }
      }
    }
  `;

  const res = await fetch("https://graphql.anilist.co", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id: mediaId } }),
  });

  if (!res.ok) throw new Error(`AniList API HTTP ${res.status}`);
  const json = await res.json();
  const data = json.data.Media;
  cache.set(cacheKey, { data, time: Date.now() });
  evictCache();
  return data;
}

/**
 * Search MangaUpdates by title. Returns chapter info, scanlation groups, and
 * per-group latest chapters parsed from the RSS feed.
 */
async function fetchMangaUpdates(title) {
  const cacheKey = `mu:${title}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  const muHeaders = {
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  const searchRes = await fetch("https://api.mangaupdates.com/v1/series/search", {
    method: "POST",
    headers: muHeaders,
    body: JSON.stringify({ search: title }),
  });

  if (!searchRes.ok) throw new Error(`MangaUpdates search HTTP ${searchRes.status}`);
  const searchJson = await searchRes.json();
  const results = searchJson.results || [];

  if (results.length === 0) {
    const data = { found: false };
    cache.set(cacheKey, { data, time: Date.now() });
    return data;
  }

  const seriesId = results[0].record.series_id;

  const [detailRes, groupsRes, rssRes] = await Promise.all([
    fetch(`https://api.mangaupdates.com/v1/series/${seriesId}`, { headers: muHeaders }),
    fetch(`https://api.mangaupdates.com/v1/series/${seriesId}/groups`, { headers: muHeaders }),
    fetch(`https://api.mangaupdates.com/v1/series/${seriesId}/rss`, { headers: muHeaders }),
  ]);

  if (!detailRes.ok) throw new Error(`MangaUpdates detail HTTP ${detailRes.status}`);
  const detail = await detailRes.json();

  // Parse RSS for per-group latest chapter using DOMParser
  const groupChapters = {};
  if (rssRes.ok) {
    const rssText = await rssRes.text();
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(rssText, "text/xml");
      const items = doc.querySelectorAll("item");
      for (const item of items) {
        const title = item.querySelector("title")?.textContent || "";
        const group = item.querySelector("description")?.textContent?.trim();
        const chMatch = title.match(/c\.(\d+)/);
        if (chMatch && group) {
          const ch = parseInt(chMatch[1], 10);
          if (!groupChapters[group] || ch > groupChapters[group]) {
            groupChapters[group] = ch;
          }
        }
      }
    } catch {
      // RSS parse failed — skip group chapters
    }
  }

  let groups = [];
  if (groupsRes.ok) {
    const groupsJson = await groupsRes.json();
    groups = (groupsJson.group_list || []).map((g) => ({
      name: g.name,
      active: g.active,
      site: g.social?.site || null,
      latestChapter: groupChapters[g.name] || null,
    }));
  }

  const data = {
    found: true,
    title: detail.title,
    latestChapter: detail.latest_chapter,
    status: detail.status,
    type: detail.type,
    url: detail.url,
    groups,
  };

  cache.set(cacheKey, { data, time: Date.now() });
  evictCache();
  return data;
}
