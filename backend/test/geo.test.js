import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveGeo } from '../src/lib/geo.js';
import { buildAdapters } from '../src/catalog.js';
import { normalizeQuery } from '../src/lib/query.js';
import {
  buildMarketplaceRegionScript,
  withWildberriesRegion,
  withYandexMarketRegion,
} from '../src/lib/marketplace-region.js';

test('resolveGeo maps city names to marketplace region codes', () => {
  const geo = resolveGeo({ city: 'СПб' });

  assert.deepEqual(geo, {
    city: 'СПб',
    wbDest: '-1123300',
    ymLr: '2',
    ozonCity: 'Санкт-Петербург',
    deliveryLocation: {
      type: 'city_center',
      city: 'Санкт-Петербург',
      address: 'Невский проспект, 1',
    },
  });
});

test('buildAdapters uses city geo codes in WB and Yandex search URLs', async () => {
  const requests = [];
  const prevUsePlaywright = process.env.USE_PLAYWRIGHT;
  process.env.USE_PLAYWRIGHT = '0';
  const fetchImpl = async (input) => {
    const url = String(input);
    requests.push(url);

    if (url.includes('/webapi/search/data')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => JSON.stringify({ data: { products: [] } }),
      };
    }

    if (url.includes('market.yandex.ru/search')) {
      return {
        ok: true,
        status: 200,
        url,
        headers: new Headers(),
        text: async () => '<html></html>',
      };
    }

    throw new Error(`Unexpected URL: ${url}`);
  };

  try {
    const [wildberries, , yandexMarket] = buildAdapters({
      fetchImpl,
      city: 'Москва',
      wbApiToken: 'test-token',
    });

    await wildberries.search(normalizeQuery('кофемашина'));
    await yandexMarket.search(normalizeQuery('кофемашина'));

    assert.ok(requests.some((url) => url.includes('dest=-1257786')));
    assert.ok(requests.some((url) => url.includes('lr=213')));
    assert.ok(requests.some((url) => url.includes('rgn=213')));
  } finally {
    process.env.USE_PLAYWRIGHT = prevUsePlaywright;
  }
});

test('marketplace region helpers build source-specific search state', () => {
  const geo = resolveGeo({ city: 'Москва' });

  assert.equal(
    withWildberriesRegion('https://www.wildberries.ru/catalog/0/search.aspx?search=test', geo),
    'https://www.wildberries.ru/catalog/0/search.aspx?search=test&dest=-1257786',
  );
  assert.equal(
    withYandexMarketRegion('https://market.yandex.ru/search?text=test', geo),
    'https://market.yandex.ru/search?text=test&lr=213&rgn=213',
  );

  assert.match(buildMarketplaceRegionScript('yandex_market', geo), /yandex_gid/);
  assert.match(buildMarketplaceRegionScript('yandex_market', geo), /213/);
  assert.match(buildMarketplaceRegionScript('ozon', geo), /ozonRegionName/);
  assert.match(buildMarketplaceRegionScript('wildberries', geo), /dest/);
});

test('resolveGeo supports arbitrary settlement names without hardcoding', () => {
  const geo = resolveGeo({ city: 'Магадан' });

  assert.equal(geo.city, 'Магадан');
  assert.equal(geo.wbDest, null);
  assert.equal(geo.ymLr, null);
  assert.equal(geo.ozonCity, 'Магадан');
  assert.deepEqual(geo.deliveryLocation, {
    type: 'city_center',
    city: 'Магадан',
    address: 'Магадан, центр',
  });
});
