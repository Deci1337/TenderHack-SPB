/**
 * Локальный прокси-сервер, эмулирующий REST API camofox-browser на порту 9377.
 * Использует playwright-extra + puppeteer-extra-plugin-stealth для обхода bot-detection.
 * Совместим с интерфейсом stealth-browser.js (openTab/navigate/evaluate/closeTab).
 */
import http from 'node:http'
import { chromium } from 'playwright-extra'
import StealthPlugin from 'puppeteer-extra-plugin-stealth'

chromium.use(StealthPlugin())

const PORT = 9377
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

let browser = null
const tabs = new Map()  // tabId → { page, context }
let tabCounter = 0

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
      ],
    })
  }
  return browser
}

async function openTab(url) {
  const b = await getBrowser()
  const ctx = await b.newContext({
    userAgent: UA,
    locale: 'ru-RU',
    timezoneId: 'Europe/Moscow',
    viewport: { width: 1920, height: 1080 },
    extraHTTPHeaders: { 'accept-language': 'ru-RU,ru;q=0.9,en;q=0.8' },
  })
  const page = await ctx.newPage()
  if (url) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  const tabId = `tab_${++tabCounter}`
  tabs.set(tabId, { page, context: ctx })
  return tabId
}

async function navigate(tabId, url) {
  const tab = tabs.get(tabId)
  if (!tab) throw new Error(`Tab ${tabId} not found`)
  await tab.page.goto(url, { waitUntil: 'networkidle', timeout: 45000 })
}

async function evaluate(tabId, expression) {
  const tab = tabs.get(tabId)
  if (!tab) throw new Error(`Tab ${tabId} not found`)
  return await tab.page.evaluate(expression)
}

async function closeTab(tabId) {
  const tab = tabs.get(tabId)
  if (tab) {
    await tab.context.close().catch(() => {})
    tabs.delete(tabId)
  }
}

function parseBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', chunk => { data += chunk })
    req.on('end', () => {
      try { resolve(JSON.parse(data)) } catch { resolve({}) }
    })
  })
}

function send(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*')

  try {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    const parts = url.pathname.split('/').filter(Boolean)

    // GET /health
    if (req.method === 'GET' && url.pathname === '/health') {
      return send(res, 200, { ok: true, browserConnected: true, engine: 'playwright-stealth' })
    }

    // POST /tabs → { tabId }
    if (req.method === 'POST' && url.pathname === '/tabs') {
      const body = await parseBody(req)
      const tabId = await openTab(body.url)
      return send(res, 200, { tabId })
    }

    // POST /tabs/:id/navigate
    if (req.method === 'POST' && parts[0] === 'tabs' && parts[2] === 'navigate') {
      const body = await parseBody(req)
      await navigate(parts[1], body.url)
      return send(res, 200, { ok: true })
    }

    // POST /tabs/:id/evaluate
    if (req.method === 'POST' && parts[0] === 'tabs' && parts[2] === 'evaluate') {
      const body = await parseBody(req)
      const result = await evaluate(parts[1], body.expression)
      return send(res, 200, { ok: true, result })
    }

    // DELETE /tabs/:id
    if (req.method === 'DELETE' && parts[0] === 'tabs' && parts[1]) {
      await closeTab(parts[1])
      return send(res, 200, { ok: true })
    }

    send(res, 404, { error: 'not found' })
  } catch (err) {
    console.error('[stealth-proxy] error:', err.message)
    send(res, 500, { error: err.message })
  }
})

server.listen(PORT, () => {
  console.log(`[stealth-proxy] playwright-extra stealth server running on :${PORT}`)
})
