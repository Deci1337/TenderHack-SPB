import test from 'node:test'
import assert from 'node:assert/strict'
import { scrapeWildberriesApi } from '../src/lib/playwright-scraper.js'
import { normalizeQuery } from '../src/lib/query.js'

// WB API всегда отдаёт цену в копейках. Проверяем, что normalizePrice делит на 100
// для всех диапазонов цен (включая дешёвые товары < 100₽).

test('WB-парсер делит цены на 100 для дешёвых товаров (<100₽)', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify({
      data: {
        products: [
          // 50₽ → 5000 копеек. Старая логика (>1000) показала бы 5000₽.
          { id: 1, name: 'Дешёвый товар', sizes: [{ price: { product: 5000 } }] },
          // 500₽ → 50000 копеек
          { id: 2, name: 'Средний товар', sizes: [{ price: { product: 50000 } }] },
          // 25000₽ → 2500000 копеек
          { id: 3, name: 'Дорогой товар', sizes: [{ price: { product: 2500000 } }] },
        ],
      },
    }),
  })

  try {
    const result = await scrapeWildberriesApi({
      normalizedQuery: normalizeQuery('товар'),
      limit: 10,
    })

    assert.ok(result.offers.length >= 3, 'все 3 товара должны распарситься')
    const prices = result.offers.map(o => o.price).sort((a, b) => a - b)
    assert.equal(prices[0], 50, 'дешёвый товар = 50₽ (5000 копеек / 100)')
    assert.equal(prices[1], 500)
    assert.equal(prices[2], 25000)
  } finally {
    global.fetch = originalFetch
  }
})

test('WB-парсер использует salePriceU как fallback (тоже копейки)', async () => {
  const originalFetch = global.fetch
  global.fetch = async () => ({
    ok: true,
    status: 200,
    headers: new Headers(),
    text: async () => JSON.stringify({
      data: {
        products: [
          { id: 1, name: 'Legacy схема', salePriceU: 150000 },  // 1500₽
        ],
      },
    }),
  })

  try {
    const result = await scrapeWildberriesApi({
      normalizedQuery: normalizeQuery('товар'),
      limit: 10,
    })
    assert.equal(result.offers[0].price, 1500)
  } finally {
    global.fetch = originalFetch
  }
})
