const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes

// Strip the chrome-extension:// Origin header from MangaUpdates API requests
// so they aren't rejected with 403
// Strip the chrome-extension:// Origin header from API requests
// so they aren't rejected with 403
chrome.declarativeNetRequest.updateDynamicRules({
  removeRuleIds: [1, 2, 3, 4, 5],
  addRules: [
    "api.mangaupdates.com",
    "api.asurascans.com",
    "api.omegascans.org",
    "api.luacomic.org",
    "api.hivetoons.org",
  ].map((domain, i) => ({
    id: i + 1,
    action: {
      type: "modifyHeaders",
      requestHeaders: [{ header: "Origin", operation: "remove" }],
    },
    condition: {
      urlFilter: domain,
      resourceTypes: ["xmlhttprequest"],
    },
  })),
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "FETCH_URL") {
    fetchWithCache(message.url)
      .then((html) => sendResponse({ ok: true, html }))
      .catch((err) => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  if (message.type === "FETCH_ANILIST") {
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
 * Build headers tailored to the target domain.
 * Naver sites require a Referer from their own domain.
 */
function getHeadersForUrl(url) {
  const base = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
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
  return data;
}

/**
 * Search MangaUpdates for a title and return latest chapter + status info.
 * Two-step: search by title, then fetch full series details.
 */
async function fetchMangaUpdates(title) {
  const cacheKey = `mu:${title}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.time < CACHE_TTL) {
    return cached.data;
  }

  const muHeaders = {
    "Content-Type": "application/json",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    Accept: "application/json",
  };

  // Step 1: Search for the series
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

  // Take the first result
  const seriesId = results[0].record.series_id;

  // Step 2: Get details, groups, and RSS releases in parallel
  const [detailRes, groupsRes, rssRes] = await Promise.all([
    fetch(`https://api.mangaupdates.com/v1/series/${seriesId}`, { headers: muHeaders }),
    fetch(`https://api.mangaupdates.com/v1/series/${seriesId}/groups`, { headers: muHeaders }),
    fetch(`https://api.mangaupdates.com/v1/series/${seriesId}/rss`, { headers: muHeaders }),
  ]);

  if (!detailRes.ok) throw new Error(`MangaUpdates detail HTTP ${detailRes.status}`);
  const detail = await detailRes.json();

  // Parse RSS for per-group latest chapter
  const groupChapters = {};
  if (rssRes.ok) {
    const rssText = await rssRes.text();
    const chapterRegex = /<item>\s*<title>[^<]*c\.(\d+)[^<]*<\/title>\s*<description>([^<]+)<\/description>/g;
    let match;
    while ((match = chapterRegex.exec(rssText)) !== null) {
      const ch = parseInt(match[1], 10);
      const groupName = match[2].trim();
      if (!groupChapters[groupName] || ch > groupChapters[groupName]) {
        groupChapters[groupName] = ch;
      }
    }
  }

  let groups = [];
  if (groupsRes.ok) {
    const groupsJson = await groupsRes.json();
    groups = (groupsJson.group_list || []).map((g) => ({
      name: g.name,
      active: g.active,
      site: g.social?.site || null,
      discord: g.social?.discord || null,
      mangadex: g.social?.forum || null,
      latestChapter: groupChapters[g.name] || null,
    }));
  }

  // Collect alternative titles for searching scanlation sites
  const altTitles = (detail.associated || []).map((a) => a.title).filter(Boolean);
  altTitles.unshift(detail.title); // main title first

  // Resolve deep links for each active group with a website
  await resolveGroupDeepLinks(groups, altTitles);

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
  return data;
}

/**
 * Site-specific search configurations.
 * Each entry defines how to search a scanlation site for a manga.
 */
/**
 * Asura-style API parser — works for asurascans.com, asuracomic.net, comicasura.net
 */
function asuraParser(apiBase, canonicalBase) {
  return {
    type: "json_api",
    searchUrl: (base, query) =>
      `${apiBase}/api/series?search=${encodeURIComponent(query)}&limit=5`,
    headers: { Referer: canonicalBase + "/" },
    parseResult: (json, base) => {
      const list = Array.isArray(json) ? json : json.data || json.results || [];
      if (list.length > 0) {
        const item = list[0];
        // Use public_url with canonical domain (MU domain may be outdated)
        if (item.public_url) return `${canonicalBase}${item.public_url}`;
        return `${canonicalBase}/series/${item.slug}`;
      }
      return null;
    },
  };
}

/**
 * Flame Comics parser — fetches full series list and filters client-side.
 * Their API returns all series at once (no server-side search).
 */
let flameSeriesCache = null;
let flameCacheTime = 0;

function flameParser(canonicalBase) {
  return {
    type: "custom",
    search: async (base, altTitles) => {
      // Cache the full series list for 30 min
      if (!flameSeriesCache || Date.now() - flameCacheTime > 30 * 60 * 1000) {
        const res = await fetch(`${canonicalBase}/api/series`, {
          headers: { "User-Agent": "Mozilla/5.0", Accept: "application/json" },
        });
        if (!res.ok) return null;
        flameSeriesCache = await res.json();
        flameCacheTime = Date.now();
      }

      // Try each alt title — fuzzy match against label
      for (const title of altTitles) {
        const lower = title.toLowerCase();
        const match = flameSeriesCache.find(
          (s) => s.label && s.label.toLowerCase() === lower
        );
        if (match) return `${canonicalBase}/series/${match.id}`;
      }

      // Partial match — check if any alt title is contained in a series label
      for (const title of altTitles) {
        const words = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        if (words.length < 2) continue;
        const match = flameSeriesCache.find((s) => {
          const label = (s.label || "").toLowerCase();
          return words.every((w) => label.includes(w));
        });
        if (match) return `${canonicalBase}/series/${match.id}`;
      }

      return null;
    },
  };
}

/**
 * Query-style API parser — for sites using api.{domain}/query endpoint.
 * Works like Flame (client-side filtering) but uses series_slug for URLs.
 * Used by: Omega Scans, Lua Scans
 */
const queryApiCaches = {};

function queryApiParser(apiBase, canonicalBase, seriesType) {
  return {
    type: "custom",
    search: async (base, altTitles) => {
      const cacheKey = apiBase;
      if (
        !queryApiCaches[cacheKey] ||
        Date.now() - queryApiCaches[cacheKey].time > 30 * 60 * 1000
      ) {
        // Fetch all series (paginated if needed)
        const allSeries = [];
        let page = 1;
        const perPage = 200;
        while (true) {
          const url = `${apiBase}/query?perPage=${perPage}&page=${page}` +
            (seriesType ? `&series_type=${seriesType}` : "");
          const res = await fetch(url, {
            headers: {
              "User-Agent": "Mozilla/5.0",
              Accept: "application/json",
              Referer: canonicalBase + "/",
            },
          });
          if (!res.ok) break;
          const json = await res.json();
          const data = json.data || [];
          allSeries.push(...data);
          if (data.length < perPage || allSeries.length >= (json.meta?.total || 0)) break;
          page++;
          if (page > 10) break; // safety limit
        }
        queryApiCaches[cacheKey] = { data: allSeries, time: Date.now() };
      }

      const seriesList = queryApiCaches[cacheKey].data;

      // Exact title match
      for (const title of altTitles) {
        const lower = title.toLowerCase();
        const match = seriesList.find(
          (s) => (s.title || "").toLowerCase() === lower
        );
        if (match) return `${canonicalBase}/series/${match.series_slug}`;
      }

      // Also check alternative_names field
      for (const title of altTitles) {
        const lower = title.toLowerCase();
        const match = seriesList.find((s) => {
          const alts = s.alternative_names;
          if (typeof alts === "string") return alts.toLowerCase().includes(lower);
          if (Array.isArray(alts)) return alts.some((a) => a.toLowerCase() === lower);
          return false;
        });
        if (match) return `${canonicalBase}/series/${match.series_slug}`;
      }

      // Fuzzy: multi-word match
      for (const title of altTitles) {
        const words = title.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
        if (words.length < 2) continue;
        const match = seriesList.find((s) => {
          const t = (s.title || "").toLowerCase();
          return words.every((w) => t.includes(w));
        });
        if (match) return `${canonicalBase}/series/${match.series_slug}`;
      }

      return null;
    },
  };
}

const SITE_SEARCH_CONFIGS = {
  // Asura — multiple domains, canonical is asurascans.com
  "asurascans.com": asuraParser("https://api.asurascans.com", "https://asurascans.com"),
  "asuracomic.net": asuraParser("https://api.asurascans.com", "https://asurascans.com"),
  "comicasura.net": asuraParser("https://api.comicasura.net", "https://comicasura.net"),

  // Flame Comics — /api/series returns full list, client-side filter
  "flamecomics.xyz": flameParser("https://flamecomics.xyz"),
  "flamescans.lol": flameParser("https://flamescans.lol"),

  // Omega Scans — api.*/query endpoint, client-side filter
  "omegascans.org": queryApiParser("https://api.omegascans.org", "https://omegascans.org", "Comic"),

  // Lua Scans — api.*/query endpoint, client-side filter
  "luacomic.org": queryApiParser("https://api.luacomic.org", "https://luacomic.org", null),
};

/**
 * Generic search: construct a search URL on the scanlation site.
 * Most WordPress-based manga sites support ?s= search.
 * Returns a search URL (not the exact page, but close).
 */
function buildSearchUrl(siteUrl, query) {
  try {
    const url = new URL(siteUrl);
    const base = url.origin;
    return `${base}/?s=${encodeURIComponent(query)}`;
  } catch {
    return siteUrl;
  }
}

/**
 * Try to find the exact series URL on a scanlation site.
 * Tries site-specific API first, then falls back to a search URL.
 */
async function findSeriesUrl(siteUrl, altTitles) {
  if (!siteUrl) return null;

  let domain;
  try {
    domain = new URL(siteUrl).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }

  const base = new URL(siteUrl).origin;
  const config = SITE_SEARCH_CONFIGS[domain];

  if (config) {
    try {
      if (config.type === "json_api") {
        // Try each alt title until we find a match
        for (const title of altTitles.slice(0, 5)) {
          try {
            const searchUrl = config.searchUrl(base, title);
            const res = await fetch(searchUrl, {
              headers: {
                "User-Agent": "Mozilla/5.0",
                Accept: "application/json",
                ...(config.headers || {}),
              },
            });
            if (!res.ok) continue;
            const json = await res.json();
            const result = config.parseResult(json, base);
            if (result) return result;
          } catch {
            continue;
          }
        }
      } else if (config.type === "custom" && config.search) {
        const result = await config.search(base, altTitles);
        if (result) return result;
      }
    } catch {
      // Fall through to generic search
    }
  }

  // Fallback: return a pre-filled search URL on the site
  // Use the shortest English-looking alt title for the best search
  const searchTitle =
    altTitles.find((t) => /^[a-zA-Z]/.test(t) && t.length < 60) ||
    altTitles[0];
  return buildSearchUrl(siteUrl, searchTitle);
}

/**
 * Resolve deep links for all active groups in parallel.
 */
async function resolveGroupDeepLinks(groups, altTitles) {
  const promises = groups.map(async (group) => {
    if (!group.active || !group.site) return;
    try {
      const deepLink = await findSeriesUrl(group.site, altTitles);
      if (deepLink) group.seriesUrl = deepLink;
    } catch {
      // Keep the homepage link as fallback
    }
  });

  await Promise.all(promises);
}
