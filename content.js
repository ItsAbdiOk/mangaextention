/**
 * Manga Chapter Counter — AniList content script
 * Injects chapter counts into the sidebar and scanlation groups near external links.
 */

(function () {
  "use strict";

  const SIDEBAR_ID = "manga-chapter-counter";
  const SCANLATION_ID = "manga-scanlation-groups";
  let currentMangaId = null;
  let processing = false;

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

  function getMangaIdFromUrl() {
    const match = window.location.pathname.match(/\/manga\/(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  function waitForElement(selector, timeout = 15000) {
    return new Promise((resolve) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }
      const observer = new MutationObserver((_, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

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

  function resolveLangCode(link) {
    if (link.language && LANG_LABELS[link.language]) {
      return LANG_LABELS[link.language];
    }
    if (link.site === "WEBTOON" || link.site === "Webtoon") {
      const localeMatch = link.url.match(/webtoons?\.com\/([a-z]{2})\//i);
      if (localeMatch) return localeMatch[1].toUpperCase();
    }
    if (SITE_LANG_FALLBACK[link.site]) return SITE_LANG_FALLBACK[link.site];
    return link.language || "?";
  }

  function parseSourceChapters(siteName, html) {
    const parser = getParserForSite(siteName);
    if (!parser) return null;
    try {
      return parser(html);
    } catch {
      return null;
    }
  }

  async function fetchAllSourceCounts(externalLinks) {
    const supportedLinks = externalLinks.filter(
      (link) => getParserForSite(link.site) !== null
    );
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
      } catch {
        // Skip failed sources
      }
      return null;
    });
    const settled = await Promise.all(fetches);
    return settled.filter((r) => r !== null);
  }

  // ── Sidebar: Chapter counts ──

  function removeExisting() {
    document.getElementById(SIDEBAR_ID)?.remove();
    document.getElementById(SCANLATION_ID)?.remove();
  }

  function injectChapterCounts(mediaData, sourceCounts, muData) {
    const sidebar = document.querySelector(".sidebar .data");
    if (!sidebar) return;

    // Find Status row
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

    // Remove old injection
    document.getElementById(SIDEBAR_ID)?.remove();

    const hasAniListChapters = mediaData.chapters > 0;
    const hasAniListVolumes = mediaData.volumes > 0;

    // Group source counts by language, keep highest per language
    const byLanguage = new Map();
    for (const sc of sourceCounts) {
      const key = sc.langCode;
      if (!byLanguage.has(key) || sc.chapters > byLanguage.get(key).chapters) {
        byLanguage.set(key, sc);
      }
    }

    // Add MangaUpdates RAW count if no raw source found
    if (muData?.found && muData.latestChapter) {
      const muCh = parseInt(muData.latestChapter, 10);
      if (muCh > 0) {
        const hasRaw = [...byLanguage.keys()].some((k) =>
          ["KR", "JP", "CN"].includes(k)
        );
        if (!hasRaw) {
          byLanguage.set("RAW", {
            site: "MangaUpdates",
            langCode: "RAW",
            chapters: muCh,
          });
        }
      }
    }

    const hasSourceData = byLanguage.size > 0;
    if (!hasAniListChapters && !hasSourceData && !hasAniListVolumes) return;

    const container = document.createElement("div");
    container.id = SIDEBAR_ID;

    // Chapters section
    if (hasAniListChapters || hasSourceData) {
      const chapterSet = document.createElement("div");
      chapterSet.className = "data-set mcc-data-set";

      const label = document.createElement("div");
      label.className = "type";
      label.textContent = "Chapters";
      chapterSet.appendChild(label);

      const valueWrap = document.createElement("div");
      valueWrap.className = "value";

      if (hasSourceData) {
        const sorted = [...byLanguage.entries()].sort((a, b) => {
          const order = { RAW: 0, KR: 0, JP: 0, CN: 0, EN: 1 };
          return (order[a[0]] ?? 2) - (order[b[0]] ?? 2);
        });
        for (const [langCode, sc] of sorted) {
          const row = document.createElement("div");
          row.className = "mcc-source-row";

          const count = document.createElement("span");
          count.className = "mcc-count";
          count.textContent = sc.chapters;

          const badge = document.createElement("span");
          badge.className = "mcc-badge";
          badge.textContent = langCode;

          row.appendChild(count);
          row.appendChild(badge);
          valueWrap.appendChild(row);
        }
      } else if (hasAniListChapters) {
        const row = document.createElement("div");
        row.className = "mcc-source-row";
        const count = document.createElement("span");
        count.className = "mcc-count";
        count.textContent = mediaData.chapters;
        row.appendChild(count);
        valueWrap.appendChild(row);
      }

      // Add SCAN row — highest scanlation chapter from MangaUpdates groups
      const activeGroups = (muData?.groups || []).filter(
        (g) => g.active && g.latestChapter
      );
      if (activeGroups.length > 0) {
        const maxScan = Math.max(...activeGroups.map((g) => g.latestChapter));
        if (maxScan > 0) {
          const row = document.createElement("div");
          row.className = "mcc-source-row";
          const count = document.createElement("span");
          count.className = "mcc-count";
          count.textContent = maxScan;
          const badge = document.createElement("span");
          badge.className = "mcc-badge";
          badge.textContent = "SCAN";
          row.appendChild(count);
          row.appendChild(badge);
          valueWrap.appendChild(row);
        }
      }

      chapterSet.appendChild(valueWrap);
      container.appendChild(chapterSet);
    }

    // Volumes section
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

    statusSet.after(container);
  }

  // ── Bottom: Scanlation groups (near External & Streaming links) ──

  function injectScanlationGroups(muData) {
    document.getElementById(SCANLATION_ID)?.remove();

    const groups = (muData?.groups || []).filter(
      (g) => g.active && g.latestChapter
    );
    if (groups.length === 0) return;

    // Sort by latest chapter descending
    groups.sort((a, b) => (b.latestChapter || 0) - (a.latestChapter || 0));

    // Find the "External & Streaming links" section
    const externalSection = document.querySelector(".external-links");
    if (!externalSection) return;

    const section = document.createElement("div");
    section.id = SCANLATION_ID;
    section.className = "mcc-scanlation-section";

    const heading = document.createElement("h2");
    heading.textContent = "Scanlation Groups";
    section.appendChild(heading);

    for (const group of groups) {
      // Validate site URL — only allow https:// links
      const hasValidSite =
        group.site &&
        /^https?:\/\//.test(group.site);

      const el = document.createElement(hasValidSite ? "a" : "div");
      el.className = "mcc-scanlation-link";
      if (hasValidSite) {
        el.href = group.site;
        el.target = "_blank";
        el.rel = "noopener noreferrer";
      }

      // Favicon from Google's service
      if (hasValidSite) {
        try {
          const domain = new URL(group.site).hostname;
          const icon = document.createElement("img");
          icon.className = "mcc-scanlation-icon";
          icon.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=32`;
          icon.alt = "";
          icon.width = 24;
          icon.height = 24;
          el.appendChild(icon);
        } catch {
          // Skip icon if URL is invalid
        }
      }

      const name = document.createElement("span");
      name.className = "mcc-scanlation-name";
      name.textContent = group.name;

      const chBadge = document.createElement("span");
      chBadge.className = "mcc-scanlation-ch";
      chBadge.textContent = `Ch. ${group.latestChapter}`;

      el.appendChild(name);
      el.appendChild(chBadge);
      section.appendChild(el);
    }

    // Insert after the external links section
    externalSection.after(section);
  }

  // ── Loading indicator ──

  function injectLoading(statusSet) {
    document.getElementById(SIDEBAR_ID)?.remove();
    const container = document.createElement("div");
    container.id = SIDEBAR_ID;
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

  // ── Main ──

  async function run() {
    const mangaId = getMangaIdFromUrl();
    if (!mangaId || mangaId === currentMangaId || processing) return;

    currentMangaId = mangaId;
    processing = true;

    try {
      const sidebar = await waitForElement(".sidebar .data .data-set");
      if (!sidebar) {
        processing = false;
        return;
      }

      // Show loading in sidebar
      const dataSets = sidebar
        .closest(".data")
        .querySelectorAll(".data-set");
      let statusSet = null;
      for (const ds of dataSets) {
        const typeEl = ds.querySelector(".type");
        if (typeEl && typeEl.textContent.trim() === "Status") {
          statusSet = ds;
          break;
        }
      }
      if (statusSet) injectLoading(statusSet);

      // Fetch AniList data
      const mediaData = await fetchMangaData(mangaId);
      const searchTitle =
        mediaData.title.english ||
        mediaData.title.romaji ||
        mediaData.title.native;

      // Fetch sources + MangaUpdates in parallel
      const [sourceCounts, muData] = await Promise.all([
        fetchAllSourceCounts(mediaData.externalLinks || []),
        fetchMangaUpdates(searchTitle).catch(() => ({ found: false })),
      ]);

      // Inject sidebar chapter counts
      removeExisting();
      injectChapterCounts(mediaData, sourceCounts, muData);

      // Wait for external links section to appear, then inject scanlation groups
      const extLinks = await waitForElement(".external-links", 10000);
      if (extLinks) {
        injectScanlationGroups(muData);
      }
    } catch (e) {
      // Silently fail — partial data may still have been injected
      removeExisting();
    } finally {
      processing = false;
    }
  }

  // ── SPA navigation ──

  function setupNavigationListener() {
    let lastUrl = location.href;

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

    const observer = new MutationObserver(() => {
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        onUrlChange();
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    function onUrlChange() {
      const newUrl = location.href;
      if (newUrl !== lastUrl) lastUrl = newUrl;
      const newId = getMangaIdFromUrl();
      if (newId && newId !== currentMangaId) {
        currentMangaId = null;
        processing = false;
        run();
      }
    }
  }

  setupNavigationListener();
  run();
})();
