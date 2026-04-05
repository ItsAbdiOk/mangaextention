/**
 * Source-specific parsers. Each takes raw HTML and returns a chapter/episode
 * count (number) or null if it can't be determined.
 */

const Parsers = {
  /**
   * Naver Series (series.naver.com)
   * The page shows "총 N화" (Total N episodes) or "Total N episodes"
   * Also has episode list URLs with episode numbers.
   */
  parseNaverSeries(html) {
    // Korean: "총 137화" or "총137회" (with 총 = total prefix)
    let match = html.match(/총\s*(\d+)\s*(?:화|편|회)/);
    if (match) return parseInt(match[1], 10);

    // English: "Total 137 episodes"
    match = html.match(/Total\s+(\d+)\s+episodes?/i);
    if (match) return parseInt(match[1], 10);

    // Korean without 총 prefix: find all "N회" / "N화" / "N편" and take the max
    const episodes = [];
    const korPattern = /(\d+)\s*(?:회|화|편)/g;
    let m;
    while ((m = korPattern.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 10000) episodes.push(n);
    }
    if (episodes.length > 0) return Math.max(...episodes);

    // Fallback: episode numbers from URLs
    const urlPattern = /episode(?:No|_no)[=\/](\d+)/gi;
    while ((m = urlPattern.exec(html)) !== null) {
      episodes.push(parseInt(m[1], 10));
    }
    if (episodes.length > 0) return Math.max(...episodes);

    // "Episode N" or "제N화" patterns
    const epPattern = /(?:Episode|제)\s*(\d+)/gi;
    while ((m = epPattern.exec(html)) !== null) {
      episodes.push(parseInt(m[1], 10));
    }
    if (episodes.length > 0) return Math.max(...episodes);

    return null;
  },

  /**
   * Naver Webtoon (comic.naver.com)
   * Similar to Naver Series but different URL structure.
   */
  parseNaverWebtoon(html) {
    // "총 N화" or "총 N회"
    let match = html.match(/총\s*(\d+)\s*(?:화|편|회)/);
    if (match) return parseInt(match[1], 10);

    // Episode numbers from URLs: /detail?titleId=...&no=N
    const episodes = [];
    const urlPattern = /[?&]no=(\d+)/g;
    let m;
    while ((m = urlPattern.exec(html)) !== null) {
      episodes.push(parseInt(m[1], 10));
    }
    if (episodes.length > 0) return Math.max(...episodes);

    // "N회" / "N화" / "N편" without prefix — take the max
    const korPattern = /(\d+)\s*(?:회|화|편)/g;
    while ((m = korPattern.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 10000) episodes.push(n);
    }
    if (episodes.length > 0) return Math.max(...episodes);

    return null;
  },

  /**
   * Webtoon (webtoons.com) — EN, KR, TH, FR, etc.
   * Episode list shows "#N" numbers and URLs contain episode_no=N.
   * Episodes listed newest-first, so the highest number is near the top.
   */
  parseWebtoon(html) {
    const episodes = [];

    // Primary: episode_no=N in URLs (most reliable)
    const urlPattern = /episode_no=(\d+)/g;
    let m;
    while ((m = urlPattern.exec(html)) !== null) {
      episodes.push(parseInt(m[1], 10));
    }
    if (episodes.length > 0) return Math.max(...episodes);

    // Secondary: #N patterns (shown next to each episode)
    const hashPattern = /#(\d+)/g;
    while ((m = hashPattern.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 10000) episodes.push(n);
    }
    if (episodes.length > 0) return Math.max(...episodes);

    // Tertiary: "Ep. N" or "Episode N"
    const epPattern = /Ep(?:isode)?\.?\s*(\d+)/gi;
    while ((m = epPattern.exec(html)) !== null) {
      episodes.push(parseInt(m[1], 10));
    }
    if (episodes.length > 0) return Math.max(...episodes);

    return null;
  },

  /**
   * Kakao Page (page.kakao.com)
   * Korean webtoon/novel platform.
   */
  parseKakaoPage(html) {
    // KakaoPage is JS-rendered — if the page is small, it's just a shell
    // and any numbers found would be misleading (e.g., only first 2 episodes)
    if (html.length < 10000) return null;

    // "총 N화"
    let match = html.match(/총\s*(\d+)\s*(?:화|편|회)/);
    if (match) return parseInt(match[1], 10);

    // "N화" in episode list — only trust if we find many episodes
    const episodes = [];
    const epPattern = /(\d+)화/g;
    let m;
    while ((m = epPattern.exec(html)) !== null) {
      episodes.push(parseInt(m[1], 10));
    }
    // Only return if we found a reasonable number of episode entries
    if (episodes.length >= 5) return Math.max(...episodes);

    return null;
  },

  /**
   * Kadocomi / Comic Walker (kadocomi.jp, comic-walker.com)
   * Japanese manga platform.
   */
  parseKadocomi(html) {
    // "全N話" (total N chapters) or "第N話"
    let match = html.match(/全\s*(\d+)\s*話/);
    if (match) return parseInt(match[1], 10);

    const episodes = [];
    const epPattern = /第\s*(\d+)\s*話/g;
    let m;
    while ((m = epPattern.exec(html)) !== null) {
      episodes.push(parseInt(m[1], 10));
    }
    if (episodes.length > 0) return Math.max(...episodes);

    // "Chapter N" or "#N"
    const chPattern = /(?:Chapter|#)\s*(\d+)/gi;
    while ((m = chPattern.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 10000) episodes.push(n);
    }
    if (episodes.length > 0) return Math.max(...episodes);

    return null;
  },

  /**
   * Tapas (tapas.io)
   * Has <p class="episode-cnt">146 episodes</p> in server-rendered HTML.
   */
  parseTapas(html) {
    // Primary: episode-cnt element
    let match = html.match(/episode-cnt[^>]*>\s*(\d+)\s*episodes?/i);
    if (match) return parseInt(match[1], 10);

    // Secondary: "N episodes" anywhere
    match = html.match(/(\d+)\s+episodes?/i);
    if (match) return parseInt(match[1], 10);

    // Tertiary: "Episode N" or "Ep. N" — take the max
    const episodes = [];
    const epPattern = /Ep(?:isode)?\.?\s*(\d+)/gi;
    let m;
    while ((m = epPattern.exec(html)) !== null) {
      episodes.push(parseInt(m[1], 10));
    }
    if (episodes.length > 0) return Math.max(...episodes);

    return null;
  },

  /**
   * Pocket Shonen Magazine (pocket.shonenmagazine.com)
   */
  parsePocketMagazine(html) {
    const episodes = [];
    // "第N話" pattern
    const epPattern = /第\s*(\d+)\s*話/g;
    let m;
    while ((m = epPattern.exec(html)) !== null) {
      episodes.push(parseInt(m[1], 10));
    }
    if (episodes.length > 0) return Math.max(...episodes);

    const chPattern = /(?:Chapter|#)\s*(\d+)/gi;
    while ((m = chPattern.exec(html)) !== null) {
      const n = parseInt(m[1], 10);
      if (n > 0 && n < 10000) episodes.push(n);
    }
    if (episodes.length > 0) return Math.max(...episodes);

    return null;
  },

};

/**
 * Map site names (from AniList externalLinks) to parser functions.
 * Site names come from AniList's `externalLinks.site` field.
 */
const SITE_PARSER_MAP = {
  // Korean
  "Naver Series": Parsers.parseNaverSeries,
  "Naver Webtoon": Parsers.parseNaverWebtoon,
  "Kakao Page": Parsers.parseKakaoPage,
  KakaoPage: Parsers.parseKakaoPage,         // AniList uses no space
  "Kakao Webtoon": Parsers.parseKakaoPage,   // Same Korean patterns

  // English
  WEBTOON: Parsers.parseWebtoon,
  Webtoon: Parsers.parseWebtoon,
  Tapas: Parsers.parseTapas,

  // Japanese (server-rendered)
  Kadocomi: Parsers.parseKadocomi,
  "Comic Walker": Parsers.parseKadocomi,
  "Pocket Magazine": Parsers.parsePocketMagazine,
};

/**
 * Get the parser function for a given site name.
 * Returns null if no parser is available.
 */
function getParserForSite(siteName) {
  return SITE_PARSER_MAP[siteName] || null;
}
