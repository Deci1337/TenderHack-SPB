"""
Playwright-based fallback для WB/Ozon/Яндекс.Маркет.

Используется когда httpx-путь в marketplace_parsers.py упирается в антибот
(WB 498, Ozon 403, YM 403). Открывает реальный браузер, грузит страницу,
перехватывает JSON-ответы XHR + парсит HTML.
"""

import asyncio
import json
import logging
import re
from urllib.parse import quote

from playwright.async_api import async_playwright

logger = logging.getLogger(__name__)

UA = ("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
      "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36")

PAGE_TIMEOUT = 30_000


def _extract_ym_price(p: dict) -> float:
    """Извлекает цену из объекта YM-продукта, пробуя все известные пути."""
    def _first_positive(obj) -> float:
        if isinstance(obj, (int, float)) and obj > 0:
            return float(obj)
        if isinstance(obj, str):
            try:
                v = float(obj.replace(" ", "").replace("\xa0", ""))
                if v > 0:
                    return v
            except Exception:
                pass
        if isinstance(obj, dict):
            for v in obj.values():
                r = _first_positive(v)
                if r > 0:
                    return r
        return 0.0

    for field in ("prices", "price", "offer", "salePrice", "minPrice"):
        val = p.get(field)
        if val is None:
            continue
        r = _first_positive(val)
        if r > 0:
            return r
    return 0.0


async def _new_browser_context(pw):
    browser = await pw.chromium.launch(
        headless=True,
        args=[
            "--no-sandbox",
            "--disable-blink-features=AutomationControlled",
            "--disable-dev-shm-usage",
        ],
    )
    context = await browser.new_context(
        user_agent=UA,
        locale="ru-RU",
        timezone_id="Europe/Moscow",
        viewport={"width": 1920, "height": 1080},
        extra_http_headers={"Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8"},
    )
    # webdriver-маскировка
    await context.add_init_script(
        "Object.defineProperty(navigator, 'webdriver', {get: () => undefined});"
        "window.chrome = {runtime: {}};"
    )
    return browser, context


# ─── WB через Playwright ─────────────────────────────────────────────────────

def _wb_image(nm_id: int) -> str:
    vol = nm_id // 100000
    part = nm_id // 1000
    ranges = [(143, 1), (287, 2), (431, 3), (719, 4), (1007, 5), (1061, 6),
              (1115, 7), (1169, 8), (1313, 9), (1601, 10), (1655, 11), (1919, 12),
              (2045, 13), (2189, 14), (2405, 15), (2621, 16), (2837, 17),
              (3053, 18), (3269, 19), (3485, 20)]
    basket = 21
    for max_vol, b in ranges:
        if vol <= max_vol:
            basket = b
            break
    return f"https://basket-{basket:02d}.wbbasket.ru/vol{vol}/part{part}/{nm_id}/images/c516x688/1.jpg"


async def search_wb_playwright(query: str, limit: int = 25) -> list[dict]:
    """Открываем WB через Playwright и перехватываем search API ответ."""
    results: list[dict] = []
    captured_json: list[dict] = []

    async with async_playwright() as pw:
        browser, context = await _new_browser_context(pw)
        page = await context.new_page()

        async def on_response(resp):
            url = resp.url
            if ("search.wb.ru" in url or "wildberries.ru/__internal" in url) \
                    and "search" in url and resp.status == 200:
                try:
                    text = await resp.text()
                    if text.startswith("{"):
                        captured_json.append(json.loads(text))
                except Exception:
                    pass

        page.on("response", on_response)

        try:
            search_url = f"https://www.wildberries.ru/catalog/0/search.aspx?search={quote(query)}"
            await page.goto(search_url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
            await asyncio.sleep(3)  # дожидаемся XHR
        except Exception as e:
            logger.warning("WB Playwright nav error: %s", e)

        await browser.close()

    for blob in captured_json:
        products = (blob.get("data") or {}).get("products") or []
        for p in products[:limit]:
            nm_id = p.get("id") or p.get("nmId")
            if not nm_id:
                continue
            sizes = p.get("sizes") or []
            price_raw = (
                (sizes[0].get("price", {}).get("product") if sizes else None)
                or p.get("salePriceU") or p.get("priceU") or 0
            )
            price = (price_raw or 0) / 100
            name = (p.get("name") or "").strip()
            if not name or price <= 0:
                continue
            results.append({
                "name": name,
                "price": price,
                "image_url": _wb_image(int(nm_id)),
                "source_url": f"https://www.wildberries.ru/catalog/{nm_id}/detail.aspx",
                "characteristics": {k: v for k, v in [
                    ("Бренд", p.get("brand")),
                    ("Категория", p.get("subjectName")),
                ] if v},
            })
            if len(results) >= limit:
                break
        if len(results) >= limit:
            break

    logger.info("WB Playwright: %d товаров для '%s'", len(results), query)
    return results


# ─── Ozon через Playwright ───────────────────────────────────────────────────

async def search_ozon_playwright(query: str, limit: int = 25) -> list[dict]:
    results: list[dict] = []
    seen: set[str] = set()
    api_payloads: list[dict] = []

    async with async_playwright() as pw:
        browser, context = await _new_browser_context(pw)
        page = await context.new_page()

        async def on_response(resp):
            url = resp.url
            if "ozon.ru" in url and ("entrypoint-api" in url or "composer-api" in url) \
                    and resp.status == 200:
                try:
                    text = await resp.text()
                    if text.startswith("{"):
                        api_payloads.append(json.loads(text))
                except Exception:
                    pass

        page.on("response", on_response)

        try:
            search_url = f"https://www.ozon.ru/search/?text={quote(query)}&from_global=true"
            await page.goto(search_url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
            # Ozon подгружает товары через XHR после рендера
            await asyncio.sleep(5)
            # Прокрутка для подгрузки
            await page.evaluate("window.scrollBy(0, 1500)")
            await asyncio.sleep(2)
        except Exception as e:
            logger.warning("Ozon Playwright nav error: %s", e)

        await browser.close()

    def walk(node):
        if not isinstance(node, dict) or len(results) >= limit:
            return
        items = node.get("items") or node.get("products") or []
        if isinstance(items, list):
            for item in items:
                if len(results) >= limit:
                    return
                info = item.get("cellTrackingInfo") or item.get("trackingInfo") or item
                title = (info.get("title") or info.get("name") or "").strip()
                price_raw = info.get("finalPrice") or info.get("price") or 0
                try:
                    price = float(str(price_raw).replace(" ", "").replace(",", "."))
                except Exception:
                    continue
                if not title or price <= 0:
                    continue
                key = title[:40] + str(price)
                if key in seen:
                    continue
                seen.add(key)
                url_path = item.get("url") or info.get("url") or ""
                img = item.get("image") or info.get("image") or ""
                if isinstance(img, dict):
                    img = img.get("url", "")
                source_url = (f"https://www.ozon.ru{url_path}"
                              if url_path.startswith("/") else url_path) or "https://www.ozon.ru"
                results.append({
                    "name": title[:120],
                    "price": price,
                    "image_url": img,
                    "source_url": source_url,
                    "characteristics": {},
                })
        for v in node.values():
            if isinstance(v, dict):
                walk(v)
            elif isinstance(v, list):
                for el in v:
                    if isinstance(el, dict):
                        walk(el)

    for payload in api_payloads:
        walk(payload)

    logger.info("Ozon Playwright: %d товаров для '%s'", len(results), query)
    return results


# ─── Яндекс.Маркет через Playwright ──────────────────────────────────────────

YM_RS = "eJwzEv_EKMLBKLDwEKsEg8azbh6NVUdYNT6fYQUAWiMIFg,,"


async def search_ym_playwright(query: str, limit: int = 25) -> list[dict]:
    """YM: открываем поиск, ждём загрузку, извлекаем из noframes data-apiary blob."""
    results: list[dict] = []
    seen: set[str] = set()
    html_content = ""

    async with async_playwright() as pw:
        browser, context = await _new_browser_context(pw)
        page = await context.new_page()
        try:
            search_url = (f"https://market.yandex.ru/search?text={quote(query)}"
                          f"&rs={quote(YM_RS)}&lr=213")
            await page.goto(search_url, wait_until="domcontentloaded", timeout=PAGE_TIMEOUT)
            await asyncio.sleep(4)
            html_content = await page.content()
        except Exception as e:
            logger.warning("YM Playwright nav error: %s", e)

        await browser.close()

    if not html_content:
        return []

    # Парсим noframes data-apiary patch блоки
    for blob_text in re.findall(
        r'<noframes[^>]+data-apiary="patch"[^>]*>(.*?)</noframes>',
        html_content, re.DOTALL,
    ):
        try:
            blob = json.loads(blob_text)
            collections = blob.get("collections") or {}
            for coll_name, coll_data in collections.items():
                if not isinstance(coll_data, dict):
                    continue
                for p in coll_data.values():
                    if not isinstance(p, dict) or len(results) >= limit:
                        break
                    name = (p.get("titles") or {}).get("raw") or p.get("name", "")
                    price = _extract_ym_price(p)
                    if not name or price <= 0 or len(name) < 4:
                        continue
                    key = name[:40] + str(price)
                    if key in seen:
                        continue
                    seen.add(key)
                    pid = p.get("id")
                    slug = p.get("slug", "")
                    source_url = (f"https://market.yandex.ru/product--{slug}/{pid}"
                                  if slug and pid else "https://market.yandex.ru")
                    img = p.get("picture") or p.get("image") or ""
                    if isinstance(img, dict):
                        img = img.get("url", "")
                    if isinstance(img, str) and img.startswith("//"):
                        img = "https:" + img
                    results.append({
                        "name": name[:120],
                        "price": price,
                        "image_url": img,
                        "source_url": source_url,
                        "characteristics": {},
                    })
        except Exception:
            continue

    # Fallback: JSON-LD
    if not results:
        for block in re.findall(
            r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
            html_content, re.DOTALL,
        ):
            try:
                data = json.loads(block)
                items = data if isinstance(data, list) else [data]
                for item in items:
                    if item.get("@type") != "Product":
                        continue
                    if len(results) >= limit:
                        break
                    name = item.get("name", "")
                    offers = item.get("offers", {})
                    if isinstance(offers, list):
                        offers = offers[0] if offers else {}
                    try:
                        price = float(str(offers.get("price", 0) or offers.get("lowPrice", 0))
                                      .replace(" ", ""))
                    except Exception:
                        continue
                    if not name or price <= 0:
                        continue
                    img = item.get("image", "")
                    if isinstance(img, list):
                        img = img[0] if img else ""
                    results.append({
                        "name": name[:120],
                        "price": price,
                        "image_url": img if isinstance(img, str) else "",
                        "source_url": item.get("url", "https://market.yandex.ru"),
                        "characteristics": {},
                    })
            except Exception:
                continue

    logger.info("YM Playwright: %d товаров для '%s'", len(results), query)
    return results
