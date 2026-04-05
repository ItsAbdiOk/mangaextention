/**
 * Manga Chapter Counter — AniList content script
 * Detects manga pages, fetches chapter counts from official sources,
 * and injects the data into the sidebar.
 */

(function () {
  "use strict";

  const CONTAINER_ID = "manga-chapter-counter";
  let currentMangaId = null;
  let processing = false;

  // Language display names
  const LANG_LABELS = {
    Japanese: "JP",
    Korean: "KR",
    English: "EN",
    French: "FR",
    Thai: "TH",
    Chinese: "CN",
    "Chinese (Simplified)": "CN",
    Spanish: "ES",
    Portuguese: "PT",
    German: "DE",
    Italian: "IT",
    Indonesian: "ID",
  };

  // Infer language from site name when AniList doesn't provide it
  const SITE_LANG_FALLBACK = {
    "Naver Series": "KR",
    "Naver Webtoon": "KR",
    "Kakao Page": "KR",
    KakaoPage: "KR",
    "Kakao Webtoon": "KR",
    Tapas: "EN",
    Kadocomi: "JP",
    "Comic Walker": "JP",
    MangaPlus: "EN",
    "MANGA Plus": "EN",
    Piccoma: "JP",
    "Pocket Magazine": "JP",
    Bilibili: "CN",
    Lezhin: "KR",
    Tappytoon: "EN",
    "Manta Comics": "EN",
  };

  /**
   * Extract manga ID from the current URL.
   * AniList URLs: /manga/{id}/... or /manga/{id}
   */
  function getMangaIdFromUrl() {
    const match = window.location.pathname.match(/\/manga\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  /**
   * Wait for the sidebar data section to appear in the DOM.
   * AniList is a Vue SPA — the sidebar loads asynchronously.
   */
  function waitForSidebar() {
    return new Promise((resolve) => {
      const existing = document.querySelector(".sidebar .data .data-set");
      if (existing) {
        resolve(existing.closest(".data"));
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(".sidebar .data .data-set");
        if (el) {
          obs.disconnect();
          resolve(el.closest(".data"));
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      // Timeout after 15 seconds
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, 15000);
    });
  }

  /**
   * Fetch manga data from AniList API via background script.
   */
  async function fetchMangaData(mangaId) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "FETCH_ANILIST", id: mangaId },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response.ok) resolve(response.data);
          else reject(new Error(response.error));
        }
      );
    });
  }

  /**
   * Fetch chapter info from MangaUpdates as a fallback source.
   */
  async function fetchMangaUpdates(title) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "FETCH_MANGAUPDATES", title },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response.ok) resolve(response.data);
          else reject(new Error(response.error));
        }
      );
    });
  }

  /**
   * Fetch an external source page via background script.
   */
  async function fetchSourcePage(url) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(
        { type: "FETCH_URL", url },
        (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
            return;
          }
          if (response.ok) resolve(response.html);
          else reject(new Error(response.error));
        }
      );
    });
  }

  /**
   * Parse chapter count from a source page using the appropriate parser.
   */
  function parseSourceChapters(siteName, html) {
    const parser = getParserForSite(siteName);
    if (!parser) return null;
    try {
      return parser(html);
    } catch (e) {
      console.warn(`[MangaChapterCounter] Parser error for ${siteName}:`, e);
      return null;
    }
  }

  /**
   * Fetch chapter counts from all external sources.
   * Returns array of { site, language, langCode, chapters, url }
   */
  /**
   * Resolve a language code for an external link.
   * AniList sometimes returns null language — infer from site name or URL.
   */
  function resolveLangCode(link) {
    // If AniList provides a language, use it
    if (link.language && LANG_LABELS[link.language]) {
      return LANG_LABELS[link.language];
    }

    // For Webtoon, infer from URL locale: /en/, /fr/, /th/, /ko/, etc.
    if (link.site === "WEBTOON" || link.site === "Webtoon") {
      const localeMatch = link.url.match(
        /webtoons?\.com\/([a-z]{2})\//i
      );
      if (localeMatch) {
        const locale = localeMatch[1].toUpperCase();
        return locale === "EN" ? "EN" : locale;
      }
    }

    // Fallback: infer from site name
    if (SITE_LANG_FALLBACK[link.site]) {
      return SITE_LANG_FALLBACK[link.site];
    }

    return link.language || "?";
  }

  async function fetchAllSourceCounts(externalLinks) {
    const supportedLinks = externalLinks.filter((link) => {
      return getParserForSite(link.site) !== null;
    });

    const fetches = supportedLinks.map(async (link) => {
      try {
        const html = await fetchSourcePage(link.url);
        const chapters = parseSourceChapters(link.site, html);
        if (chapters !== null) {
          return {
            site: link.site,
            language: link.language || "Unknown",
            langCode: resolveLangCode(link),
            chapters,
            url: link.url,
          };
        }
      } catch (e) {
        // Silently skip failed sources
      }
      return null;
    });

    const settled = await Promise.all(fetches);
    return settled.filter((r) => r !== null);
  }

  /**
   * Remove any existing chapter counter elements.
   */
  function removeExisting() {
    const existing = document.getElementById(CONTAINER_ID);
    if (existing) existing.remove();
  }

  /**
   * Create and inject the chapter count display into the sidebar.
   */
  function injectChapterCounts(mediaData, sourceCounts, muData) {
    removeExisting();

    const sidebar = document.querySelector(".sidebar .data");
    if (!sidebar) return;

    // Find the Status data-set to insert after
    const dataSets = sidebar.querySelectorAll(".data-set");
    let statusSet = null;
    for (const ds of dataSets) {
      const typeEl = ds.querySelector(".type");
      if (typeEl && typeEl.textContent.trim() === "Status") {
        statusSet = ds;
        break;
      }
    }

    if (!statusSet) return;

    const container = document.createElement("div");
    container.id = CONTAINER_ID;

    // If AniList itself has chapter/volume data, include it
    const hasAniListChapters =
      mediaData.chapters !== null && mediaData.chapters > 0;
    const hasAniListVolumes =
      mediaData.volumes !== null && mediaData.volumes > 0;

    // Group source counts by language, deduplicating
    const byLanguage = new Map();
    for (const sc of sourceCounts) {
      const key = sc.langCode;
      if (!byLanguage.has(key) || sc.chapters > byLanguage.get(key).chapters) {
        byLanguage.set(key, sc);
      }
    }

    const hasSourceData = byLanguage.size > 0;

    if (!hasAniListChapters && !hasSourceData && !hasAniListVolumes) {
      // Nothing to show
      return;
    }

    // Build the chapters section
    if (hasAniListChapters || hasSourceData) {
      const chapterSet = document.createElement("div");
      chapterSet.className = "data-set mcc-data-set";

      const label = document.createElement("div");
      label.className = "type";
      label.textContent = "Chapters";
      chapterSet.appendChild(label);

      const valueWrap = document.createElement("div");
      valueWrap.className = "value";

      // Source counts (grouped by language)
      if (hasSourceData) {
        const sortedEntries = [...byLanguage.entries()].sort((a, b) => {
          // Sort: raw/source language first, then EN, then others
          const order = { RAW: 0, KR: 0, JP: 0, CN: 0, EN: 1 };
          return (order[a[0]] ?? 2) - (order[b[0]] ?? 2);
        });

        for (const [langCode, sc] of sortedEntries) {
          const row = document.createElement("div");
          row.className = "mcc-source-row";

          const count = document.createElement("span");
          count.className = "mcc-count";
          count.textContent = sc.chapters;

          const badge = document.createElement("span");
          badge.className = "mcc-badge";
          badge.textContent = `${sc.site} ${langCode}`;
          badge.title = `${sc.chapters} chapters on ${sc.site} (${sc.language})`;

          row.appendChild(count);
          row.appendChild(badge);
          valueWrap.appendChild(row);
        }
      }

      // AniList's own chapter count as fallback
      if (hasAniListChapters && !hasSourceData) {
        const row = document.createElement("div");
        row.className = "mcc-source-row";

        const count = document.createElement("span");
        count.className = "mcc-count";
        count.textContent = mediaData.chapters;

        const badge = document.createElement("span");
        badge.className = "mcc-badge";
        badge.textContent = "AniList";

        row.appendChild(count);
        row.appendChild(badge);
        valueWrap.appendChild(row);
      }

      chapterSet.appendChild(valueWrap);
      container.appendChild(chapterSet);
    }

    // Build the volumes section (AniList data only)
    if (hasAniListVolumes) {
      const volumeSet = document.createElement("div");
      volumeSet.className = "data-set mcc-data-set";

      const label = document.createElement("div");
      label.className = "type";
      label.textContent = "Volumes";
      volumeSet.appendChild(label);

      const value = document.createElement("div");
      value.className = "value";
      value.textContent = mediaData.volumes;
      volumeSet.appendChild(value);

      container.appendChild(volumeSet);
    }

    // Build the scanlation groups section
    const groups = muData?.groups || [];
    const activeGroups = groups.filter((g) => g.active && g.site);
    if (activeGroups.length > 0) {
      const groupSet = document.createElement("div");
      groupSet.className = "data-set mcc-data-set";

      const label = document.createElement("div");
      label.className = "type";
      label.textContent = "Read At";
      groupSet.appendChild(label);

      const value = document.createElement("div");
      value.className = "value";

      // Sort: groups with latest chapters first
      activeGroups.sort((a, b) => (b.latestChapter || 0) - (a.latestChapter || 0));

      for (const group of activeGroups) {
        const row = document.createElement("a");
        row.className = "mcc-group-link";
        row.href = group.seriesUrl || group.site;
        row.target = "_blank";
        row.rel = "noopener noreferrer";
        row.title = `Read on ${group.name}`;

        const left = document.createElement("div");
        left.className = "mcc-group-left";

        const name = document.createElement("span");
        name.className = "mcc-group-name";
        name.textContent = group.name;
        left.appendChild(name);

        if (group.latestChapter) {
          const chBadge = document.createElement("span");
          chBadge.className = "mcc-group-ch";
          chBadge.textContent = `Ch. ${group.latestChapter}`;
          left.appendChild(chBadge);
        }

        const arrow = document.createElement("span");
        arrow.className = "mcc-group-arrow";
        arrow.textContent = "\u2192";

        row.appendChild(left);
        row.appendChild(arrow);
        value.appendChild(row);
      }

      groupSet.appendChild(value);
      container.appendChild(groupSet);
    }

    // Insert after the Status data-set
    statusSet.after(container);
  }

  /**
   * Show a loading indicator while fetching data.
   */
  function injectLoading(statusSet) {
    removeExisting();

    const container = document.createElement("div");
    container.id = CONTAINER_ID;

    const loadingSet = document.createElement("div");
    loadingSet.className = "data-set mcc-data-set";

    const label = document.createElement("div");
    label.className = "type";
    label.textContent = "Chapters";

    const value = document.createElement("div");
    value.className = "value mcc-loading";
    value.textContent = "Loading...";

    loadingSet.appendChild(label);
    loadingSet.appendChild(value);
    container.appendChild(loadingSet);

    statusSet.after(container);
  }

  /**
   * Main function — runs when a manga page is detected.
   */
  async function run() {
    const mangaId = getMangaIdFromUrl();
    if (!mangaId || mangaId === currentMangaId || processing) return;

    currentMangaId = mangaId;
    processing = true;

    try {
      const sidebar = await waitForSidebar();
      if (!sidebar) {
        processing = false;
        return;
      }

      // Find status element for loading indicator
      const dataSets = sidebar.querySelectorAll(".data-set");
      let statusSet = null;
      for (const ds of dataSets) {
        const typeEl = ds.querySelector(".type");
        if (typeEl && typeEl.textContent.trim() === "Status") {
          statusSet = ds;
          break;
        }
      }

      if (statusSet) {
        injectLoading(statusSet);
      }

      // Fetch AniList data
      const mediaData = await fetchMangaData(mangaId);

      // Fetch from external sources + MangaUpdates in parallel
      const searchTitle =
        mediaData.title.english ||
        mediaData.title.romaji ||
        mediaData.title.native;

      const [sourceCounts, muData] = await Promise.all([
        fetchAllSourceCounts(mediaData.externalLinks || []),
        fetchMangaUpdates(searchTitle).catch((e) => {
          console.warn("[MangaChapterCounter] MangaUpdates failed:", e.message);
          return { found: false };
        }),
      ]);

      // Add MangaUpdates as a source if it found a match
      if (muData.found && muData.latestChapter) {
        const muChapters = parseInt(muData.latestChapter, 10);
        if (muChapters > 0) {
          // Only add if we don't already have a source with a higher or equal count
          // for the raw/original language
          const hasHigherRaw = sourceCounts.some(
            (sc) =>
              ["KR", "JP", "CN"].includes(sc.langCode) &&
              sc.chapters >= muChapters
          );
          if (!hasHigherRaw) {
            sourceCounts.push({
              site: "MangaUpdates",
              language: "Raw",
              langCode: "RAW",
              chapters: muChapters,
              url: muData.url,
            });
          }
        }
      }

      // Inject results
      injectChapterCounts(mediaData, sourceCounts, muData);
    } catch (e) {
      console.error("[MangaChapterCounter] Error:", e);
      removeExisting();
    } finally {
      processing = false;
    }
  }

  /**
   * SPA navigation detection.
   * AniList uses Vue Router — watch for URL changes.
   */
  function setupNavigationListener() {
    let lastUrl = location.href;

    // Watch for pushState/replaceState
    const originalPushState = history.pushState;
    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      onUrlChange();
    };

    const originalReplaceState = history.replaceState;
    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      onUrlChange();
    };

    window.addEventListener("popstate", onUrlChange);

    // Also use MutationObserver as a fallback for SPA changes
    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        onUrlChange();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function onUrlChange() {
      const newUrl = location.href;
      if (newUrl !== lastUrl) {
        lastUrl = newUrl;
      }
      const newId = getMangaIdFromUrl();
      if (newId && newId !== currentMangaId) {
        currentMangaId = null; // Reset so run() will process
        processing = false;
        run();
      }
    }
  }

  // Initialize
  setupNavigationListener();
  run();
})();
