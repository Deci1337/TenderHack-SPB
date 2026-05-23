import * as defaultBrowser from './stealth-browser.js';

const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

function setParam(url, name, value) {
  if (!value) return url;
  const u = new URL(url);
  u.searchParams.set(name, String(value));
  return u.toString();
}

export function withWildberriesRegion(url, geo) {
  return setParam(url, 'dest', geo?.wbDest);
}

export function withYandexMarketRegion(url, geo) {
  let out = setParam(url, 'lr', geo?.ymLr);
  out = setParam(out, 'rgn', geo?.ymLr);
  return out;
}

export function buildMarketplaceRegionScript(source, geo) {
  if (!geo) return null;

  if (source === 'yandex_market' && geo.ymLr) {
    const lr = JSON.stringify(String(geo.ymLr));
    const maxAge = JSON.stringify(`max-age=${ONE_YEAR_SECONDS}`);
    return `(() => {
      const lr = ${lr};
      const maxAge = ${maxAge};
      const cookies = [
        ['yandex_gid', lr],
        ['ym_region', lr]
      ];
      for (const [name, value] of cookies) {
        document.cookie = name + '=' + encodeURIComponent(value) + '; path=/; ' + maxAge + '; SameSite=Lax';
        document.cookie = name + '=' + encodeURIComponent(value) + '; domain=.yandex.ru; path=/; ' + maxAge + '; SameSite=Lax';
      }
      return { source: 'yandex_market', ymLr: lr };
    })()`;
  }

  if (source === 'ozon' && geo.ozonCity) {
    const city = JSON.stringify(String(geo.ozonCity));
    return `(() => {
      const city = ${city};
      localStorage.setItem('ozonRegionName', city);
      localStorage.setItem('tenderhackRegionCity', city);
      return { source: 'ozon', city };
    })()`;
  }

  if (source === 'wildberries' && geo.wbDest) {
    const dest = JSON.stringify(String(geo.wbDest));
    const maxAge = JSON.stringify(`max-age=${ONE_YEAR_SECONDS}`);
    return `(() => {
      const dest = ${dest};
      const maxAge = ${maxAge};
      document.cookie = 'dest=' + encodeURIComponent(dest) + '; path=/; ' + maxAge + '; SameSite=Lax';
      document.cookie = 'dest=' + encodeURIComponent(dest) + '; domain=.wildberries.ru; path=/; ' + maxAge + '; SameSite=Lax';
      return { source: 'wildberries', dest };
    })()`;
  }

  return null;
}

export async function applyMarketplaceRegion(tabId, source, geo, {
  browser = defaultBrowser,
  searchUrl,
  timeoutMs = 60000,
} = {}) {
  const script = buildMarketplaceRegionScript(source, geo);
  if (!script) return { applied: false };

  const result = await browser.evaluate(tabId, script, { timeoutMs }).catch((err) => ({
    error: err.message,
  }));

  if (searchUrl && (source === 'ozon' || source === 'yandex_market')) {
    await browser.navigate(tabId, searchUrl, { timeoutMs }).catch(() => {});
  }

  return { applied: !result?.error, result };
}
