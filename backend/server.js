/**
 * Node.js HTTP-сервер парсеров маркетплейсов.
 * Запускается рядом с Python FastAPI, слушает :8008.
 * Python вызывает GET /search?source=<source>&q=<query>&region=<region>&limit=<n>
 */
import http from 'node:http'
import { normalizeQuery } from './src/lib/query.js'
import {
  scrapeWildberries,
  scrapeOzon,
  scrapeYandexMarket,
} from './src/lib/playwright-scraper.js'
import { selectMedianProducts } from './src/lib/median.js'

const PORT = process.env.PARSER_PORT ?? 8008

function resolveCity(region) {
  const MAP = {
    'Москва': 'Москва', 'москва': 'Москва',
    'Санкт-Петербург': 'Санкт-Петербург', 'питер': 'Санкт-Петербург',
    'Новосибирск': 'Новосибирск',
    'Екатеринбург': 'Екатеринбург',
    'Казань': 'Казань',
    'Нижний Новгород': 'Нижний Новгород',
    'Челябинск': 'Челябинск',
    'Самара': 'Самара',
    'Омск': 'Омск',
    'Ростов-на-Дону': 'Ростов-на-Дону',
  }
  return MAP[region] ?? region ?? 'Москва'
}

function offerToProduct(offer, source, idx) {
  const features = offer.features ?? []
  const chars = {}
  for (const f of features) {
    if (typeof f === 'string') {
      const colonIdx = f.indexOf(':')
      if (colonIdx > 0) chars[f.slice(0, colonIdx).trim()] = f.slice(colonIdx + 1).trim()
      else if (f.trim()) chars[f.trim()] = ''
    }
  }
  return {
    id: `${source}_${idx}`,
    name: (offer.title ?? '').trim(),
    price: offer.price ?? 0,
    image_url: offer.image_url ?? '',
    source_url: offer.product_url ?? '',
    source,
    characteristics: chars,
    delivery_text: offer.delivery_text ?? null,
    delivery_days: offer.delivery_days ?? null,
    availability: offer.availability ?? 'unknown',
  }
}

const SCRAPERS = {
  wildberries: scrapeWildberries,
  ozon: scrapeOzon,
  yandex_market: scrapeYandexMarket,
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`)

  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Access-Control-Allow-Origin', '*')

  if (url.pathname === '/health') {
    res.writeHead(200)
    res.end(JSON.stringify({ ok: true }))
    return
  }

  if (url.pathname !== '/search') {
    res.writeHead(404)
    res.end(JSON.stringify({ error: 'not found' }))
    return
  }

  const source = url.searchParams.get('source') ?? ''
  const q = url.searchParams.get('q') ?? ''
  const region = url.searchParams.get('region') ?? 'Москва'
  const limit = Math.min(Number(url.searchParams.get('limit') ?? '8'), 10)

  if (!SCRAPERS[source]) {
    res.writeHead(400)
    res.end(JSON.stringify({ error: `unknown source: ${source}` }))
    return
  }

  if (!q.trim()) {
    res.writeHead(200)
    res.end(JSON.stringify({ source, products: [], liveHit: false }))
    return
  }

  try {
    const normalizedQ = normalizeQuery(q)
    const city = resolveCity(region)

    const result = await SCRAPERS[source]({
      normalizedQuery: normalizedQ,
      limit: 30,
      city,
      timeoutMs: 45000,
      enrichSpecs: false,
    })

    // Фильтр мусора:
    //  • price > 0  — должна быть цена
    //  • image_url есть — без фото карточка непригодна для сравнения
    //  • все токены запроса встретились в названии (по 20 баллов за токен)
    //    — это автоматически отсекает товары не по теме, включая «12 ₽ за шину»,
    //    т.к. парсинг чужого поля редко даёт совпадение со всеми токенами запроса
    const minScore = normalizedQ.tokens.length * 20
    const relevant = (result.offers ?? [])
      .filter(o => (o.price ?? 0) > 0)
      .filter(o => (o.image_url ?? '').trim() !== '')
      .filter(o => (o.relevance_score ?? 0) >= minScore)
      .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0))
      .slice(0, 25)

    // Из релевантных по запросу — выбираем медианные по цене (методика НМЦК).
    const median = selectMedianProducts(relevant, limit)
    const products = median.map((offer, i) => offerToProduct(offer, source, i))

    res.writeHead(200)
    res.end(JSON.stringify({
      source,
      liveHit: result.liveHit ?? false,
      products,
    }))
  } catch (err) {
    console.error(`[${source}] error:`, err.message)
    res.writeHead(200)
    res.end(JSON.stringify({ source, products: [], liveHit: false, error: err.message }))
  }
})

server.listen(PORT, () => {
  console.log(`Parser server running on :${PORT}`)
  console.log('Sources: wildberries, ozon, yandex_market')
  console.log('Stealth browser:', process.env.STEALTH_BROWSER_URL ?? 'http://127.0.0.1:9377 (auto)')
})
