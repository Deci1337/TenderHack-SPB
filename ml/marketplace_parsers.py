"""
Нативные Python-парсеры для WB, Ozon, Яндекс Маркет.
Работают без Docker/stealth-браузера через httpx + JSON-API.
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from urllib.parse import quote, urljoin

import httpx

logger = logging.getLogger(__name__)

TIMEOUT = httpx.Timeout(20.0)
BASE_HEADERS = {
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
    "Accept-Encoding": "gzip, deflate, br",
    "Connection": "keep-alive",
}


def select_median_products(items: list, count: int = 8) -> list:
    """
    Из набора кандидатов выбирает `count` товаров вокруг медианной цены.
    Обрезает по 10% выбросов с каждого края (фейки за 1₽, опт, премиум).
    Методика НМЦК: цена сопоставимых предложений ≈ медиана рыночных.
    """
    valid = [p for p in items if getattr(p, "price", 0) > 0]
    if len(valid) <= count:
        return valid
    s = sorted(valid, key=lambda p: p.price)
    drop = len(s) // 10
    core = s[drop: len(s) - drop] if drop > 0 else s
    if len(core) <= count:
        return core
    mid = len(core) // 2
    half = count // 2
    start = mid - half
    end = start + count
    if start < 0:
        end -= start
        start = 0
    if end > len(core):
        start -= end - len(core)
        end = len(core)
    return core[max(0, start): end]


@dataclass
class MarketProduct:
    name: str
    price: float
    image_url: str
    source_url: str
    source: str
    characteristics: dict = field(default_factory=dict)

    def to_dict(self, idx: int) -> dict:
        return {
            "id": f"{self.source}_{idx}",
            "name": self.name,
            "price": self.price,
            "image_url": self.image_url,
            "source_url": self.source_url,
            "source": self.source,
            "characteristics": self.characteristics,
        }


# ─────────────────────────────────────────────────────────────
# WILDBERRIES
# ─────────────────────────────────────────────────────────────

def _wb_image(nm_id: int) -> str:
    """Конструирует URL главного фото товара WB по nmId."""
    vol = nm_id // 100000
    part = nm_id // 1000
    # Таблица basket → диапазон vol (из исходников WB JS)
    basket_ranges = [
        (143, 1), (287, 2), (431, 3), (719, 4), (1007, 5),
        (1061, 6), (1115, 7), (1169, 8), (1313, 9), (1601, 10),
        (1655, 11), (1919, 12), (2045, 13), (2189, 14), (2405, 15),
        (2621, 16), (2837, 17), (3053, 18), (3269, 19), (3485, 20),
    ]
    basket = 21
    for max_vol, b in basket_ranges:
        if vol <= max_vol:
            basket = b
            break
    return f"https://basket-{basket:02d}.wbbasket.ru/vol{vol}/part{part}/{nm_id}/images/c516x688/1.jpg"


def _wb_extract_products_from_text(text: str) -> dict:
    """Извлекает массив products из частично невалидного JSON ответа WB."""
    m = re.search(r'"products"\s*:\s*\[', text)
    if not m:
        return {}
    start = m.end() - 1  # позиция открывающей [
    decoder = json.JSONDecoder()
    try:
        arr, _ = decoder.raw_decode(text, start)
        if isinstance(arr, list) and arr:
            logger.debug("WB raw_decode: нашли %d продуктов", len(arr))
            return {"data": {"products": arr}}
    except Exception as e:
        logger.debug("WB raw_decode failed: %s", e)
    return {}


async def search_wildberries(query: str, region: str = "Москва", limit: int = 8) -> list[MarketProduct]:
    dests = ["-1257786", "-1275551", "12358062", "-446031"]
    user_agents = [
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
    ]
    q = quote(query)

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        for i, dest in enumerate(dests):
            ua = user_agents[i % len(user_agents)]
            # Пробуем v18 (same-origin) и v9 поочерёдно
            urls = [
                f"https://www.wildberries.ru/__internal/u-search/exactmatch/ru/common/v18/search"
                f"?appType=1&curr=rub&dest={dest}&query={q}&resultset=catalog&sort=popular&spp=30&lang=ru",
                f"https://search.wb.ru/exactmatch/ru/common/v9/search"
                f"?appType=1&curr=rub&dest={dest}&query={q}&resultset=catalog&sort=popular&spp=30&lang=ru",
            ]
            for url in urls:
                is_v18 = "v18" in url
                headers = {
                    **BASE_HEADERS,
                    "Accept": "*/*",
                    "User-Agent": ua,
                    "Origin": "https://www.wildberries.ru",
                    "Referer": f"https://www.wildberries.ru/catalog/0/search.aspx?search={q}",
                }
                if is_v18:
                    headers.update({
                        "x-requested-with": "XMLHttpRequest",
                        "x-spa-version": "13.21.4",
                        "x-userid": "0",
                        "sec-fetch-site": "same-origin",
                        "sec-fetch-mode": "cors",
                        "sec-fetch-dest": "empty",
                    })
                try:
                    r = await client.get(url, headers=headers)
                    if r.status_code == 429:
                        await asyncio.sleep(1.5)
                        continue
                    if r.status_code != 200:
                        logger.debug("WB %s status=%d", "v18" if is_v18 else "v9", r.status_code)
                        continue
                    try:
                        data = r.json()
                    except json.JSONDecodeError as e:
                        logger.debug("WB JSON error at char %d, trying raw_decode fallback", e.pos)
                        data = _wb_extract_products_from_text(r.text)
                    products = data.get("data", {}).get("products", [])
                    if not products:
                        logger.debug("WB %s/dest=%s: 200 пустой результат, ключи=%s, body=%s",
                                     "v18" if is_v18 else "v9", dest,
                                     list(data.keys())[:6], r.text[:200])
                        continue

                    result = []
                    # Тянем 25 кандидатов чтобы было из чего выбрать медиану.
                    for p in products[:25]:
                        nm_id = p.get("id") or p.get("nmId") or p.get("nmID")
                        if not nm_id:
                            continue
                        name = p.get("name", "").strip()
                        # Цена: sizes[0].price.product (всегда в копейках) или salePriceU/priceU (тоже копейки)
                        sizes = p.get("sizes", [])
                        price_raw = (
                            (sizes[0].get("price", {}).get("product") if sizes else None)
                            or p.get("salePriceU")
                            or p.get("priceU")
                            or 0
                        )
                        price = price_raw / 100
                        if not name or price <= 0:
                            continue
                        chars = {}
                        if p.get("brand"):
                            chars["Бренд"] = p["brand"]
                        if p.get("subjectName"):
                            chars["Категория"] = p["subjectName"]
                        result.append(MarketProduct(
                            name=name,
                            price=price,
                            image_url=_wb_image(int(nm_id)),
                            source_url=f"https://www.wildberries.ru/catalog/{nm_id}/detail.aspx",
                            source="wildberries",
                            characteristics=chars,
                        ))
                    if result:
                        result = select_median_products(result, limit)
                        logger.info("WB: %d медианных товаров для '%s' (dest=%s)", len(result), query, dest)
                        return result
                    if products:
                        sample = products[0]
                        logger.debug(
                            "WB %s/dest=%s: %d в API, но все отфильтрованы. "
                            "id=%s name=%r sizes=%s saleU=%s priceU=%s",
                            "v18" if is_v18 else "v9", dest, len(products),
                            sample.get("id"), sample.get("name", "")[:30],
                            bool(sample.get("sizes")), sample.get("salePriceU"),
                            sample.get("priceU"),
                        )
                except Exception as e:
                    logger.debug("WB attempt failed: %s", e)
                await asyncio.sleep(0.6)

    # httpx упёрся в антибот (498/429) — пробуем Playwright
    logger.info("WB: httpx заблокирован, переключаемся на Playwright")
    try:
        from marketplace_playwright import search_wb_playwright
        raw = await search_wb_playwright(query, limit=25)
        products = [MarketProduct(
            name=r["name"], price=r["price"], image_url=r["image_url"],
            source_url=r["source_url"], source="wildberries",
            characteristics=r.get("characteristics", {}),
        ) for r in raw]
        if products:
            return select_median_products(products, limit)
    except Exception as e:
        logger.warning("WB Playwright fallback failed: %s", e)

    logger.warning("WB: ничего не найдено для '%s'", query)
    return []


# ─────────────────────────────────────────────────────────────
# OZON
# ─────────────────────────────────────────────────────────────

async def search_ozon(query: str, region: str = "Москва", limit: int = 8) -> list[MarketProduct]:
    q = quote(query)
    url = f"https://www.ozon.ru/api/entrypoint-api.bx/page/json/v2?url=%2Fsearch%2F%3Ftext%3D{q}%26layout_container%3DsearchResultsV2"
    headers = {
        **BASE_HEADERS,
        "Accept": "application/json",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/144.0.0.0 Safari/537.36",
        "Referer": f"https://www.ozon.ru/search/?text={q}",
        "x-o3-app-name": "ozonweb",
        "x-o3-app-version": "5.73.0",
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                logger.warning("Ozon API: %d для '%s'", r.status_code, query)
                return await _search_ozon_html(query, limit)

            data = r.json()
            # Ищем виджет с товарами
            widgets = {}
            for key in ["catalog", "searchResultsV2", "searchPage"]:
                widgets = data.get(key, {})
                if widgets:
                    break
            if not widgets:
                widgets = data  # попробуем весь ответ

            # Тянем 25 кандидатов, потом выбираем медианные.
            products = _extract_ozon_items(widgets, 25)
            if products:
                return select_median_products(products, limit)

    except Exception as e:
        logger.warning("Ozon API error: %s", e)

    products = await _search_ozon_html(query, 25)
    if products:
        return select_median_products(products, limit)

    # httpx путь не сработал (403/captcha) — Playwright
    logger.info("Ozon: httpx заблокирован, переключаемся на Playwright")
    try:
        from marketplace_playwright import search_ozon_playwright
        raw = await search_ozon_playwright(query, limit=25)
        products = [MarketProduct(
            name=r["name"], price=r["price"], image_url=r["image_url"],
            source_url=r["source_url"], source="ozon",
            characteristics=r.get("characteristics", {}),
        ) for r in raw]
        if products:
            return select_median_products(products, limit)
    except Exception as e:
        logger.warning("Ozon Playwright fallback failed: %s", e)

    # Последний шанс: DDG site:ozon.ru → JSON-LD с карточек товаров
    logger.info("Ozon: пробуем DDG site:ozon.ru")
    products = await _search_ozon_via_ddg(query, limit)
    if products:
        return select_median_products(products, limit)
    return []


async def _search_ozon_via_ddg(query: str, limit: int = 8) -> list[MarketProduct]:
    """Ищет товары Ozon через DDG site:ozon.ru, извлекает JSON-LD с карточек."""
    ddg_url = "https://lite.duckduckgo.com/lite/"
    ddg_headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept-Language": "ru-RU,ru;q=0.9",
    }
    product_urls: list[str] = []
    try:
        async with httpx.AsyncClient(headers=ddg_headers, timeout=10.0, follow_redirects=True) as client:
            resp = await client.post(ddg_url, data={"q": f"{query} site:ozon.ru", "kl": "ru-ru"})
            resp.raise_for_status()
        hrefs = re.findall(r'href="(https?://(?:www\.)?ozon\.ru/[^"]+)"', resp.text)
        seen_u: set[str] = set()
        for href in hrefs:
            if "/product/" in href and href not in seen_u:
                seen_u.add(href)
                # Убираем лишние query-параметры
                product_urls.append(href.split("?")[0])
            if len(product_urls) >= (limit + 4) * 2:
                break
    except Exception as e:
        logger.warning("Ozon DDG search failed: %s", e)
        return []

    if not product_urls:
        logger.info("Ozon DDG: product URLs не найдены для '%s'", query)
        return []

    logger.info("Ozon DDG: %d product URLs для '%s'", len(product_urls), query)
    ozon_headers = {
        **BASE_HEADERS,
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    products: list[MarketProduct] = []
    seen_k: set[str] = set()
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        for url in product_urls[:limit + 4]:
            if len(products) >= limit:
                break
            try:
                r = await client.get(url, headers=ozon_headers)
                if r.status_code != 200:
                    continue
                for block in re.findall(
                    r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
                    r.text, re.DOTALL,
                ):
                    try:
                        data = json.loads(block.strip())
                        if isinstance(data, list):
                            data = next((d for d in data if d.get("@type") == "Product"), None)
                        if not data or data.get("@type") != "Product":
                            continue
                        name = data.get("name", "")
                        offers = data.get("offers", {})
                        if isinstance(offers, list):
                            offers = offers[0] if offers else {}
                        price_raw = offers.get("price") or offers.get("lowPrice") or 0
                        price = float(re.sub(r"[^\d.]", "", str(price_raw).replace(",", ".")))
                        image = data.get("image", "")
                        if isinstance(image, list):
                            image = image[0] if image else ""
                        if isinstance(image, dict):
                            image = image.get("url", "")
                        key = name[:40] + str(price)
                        if key in seen_k or not name or price <= 0:
                            continue
                        seen_k.add(key)
                        products.append(MarketProduct(
                            name=name[:120], price=price,
                            image_url=str(image) if image else "",
                            source_url=url, source="ozon",
                        ))
                        break
                    except Exception:
                        continue
            except Exception as e:
                logger.debug("Ozon DDG page %s: %s", url, e)

    logger.info("Ozon DDG: извлечено %d товаров для '%s'", len(products), query)
    return products


def _extract_ozon_items(data: dict, limit: int) -> list[MarketProduct]:
    """Рекурсивно ищет items с title+price в ответе Ozon."""
    results = []
    seen = set()

    def walk(node):
        if not isinstance(node, dict) or len(results) >= limit:
            return
        # Формат виджета searchResultsV2: {items: [{trackingInfo: {title, finalPrice, ...}}]}
        items = node.get("items") or node.get("products") or []
        if isinstance(items, list):
            for item in items:
                if len(results) >= limit:
                    return
                _try_ozon_item(item, seen, results)
        for v in node.values():
            if isinstance(v, dict):
                walk(v)
            elif isinstance(v, list):
                for el in v:
                    if isinstance(el, dict):
                        walk(el)

    walk(data)
    return results


def _try_ozon_item(item: dict, seen: set, results: list):
    # Разные форматы ответа Ozon
    info = item.get("cellTrackingInfo") or item.get("trackingInfo") or item
    title = info.get("title") or info.get("name", "")
    price_raw = info.get("finalPrice") or info.get("price") or info.get("salePrice") or 0
    url_path = item.get("url") or info.get("url") or info.get("link", "")
    img = (item.get("image") or info.get("image")
           or (item.get("images") or [None])[0] or "")
    if isinstance(img, dict):
        img = img.get("url", "")

    try:
        price = float(str(price_raw).replace(" ", "").replace(",", "."))
    except Exception:
        return

    if not title or price <= 0:
        return

    key = title[:40] + str(price)
    if key in seen:
        return
    seen.add(key)

    source_url = f"https://www.ozon.ru{url_path}" if url_path.startswith("/") else url_path
    results.append(MarketProduct(
        name=title[:120],
        price=price,
        image_url=img,
        source_url=source_url or "https://www.ozon.ru",
        source="ozon",
    ))


async def _search_ozon_html(query: str, limit: int) -> list[MarketProduct]:
    """Fallback: парсим __NEXT_DATA__ из HTML страницы Ozon."""
    q = quote(query)
    url = f"https://www.ozon.ru/search/?text={q}&from_global=true"
    headers = {
        **BASE_HEADERS,
        "Accept": "text/html,application/xhtml+xml",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/144.0.0.0 Safari/537.36",
    }
    try:
        async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
            r = await client.get(url, headers=headers)
            if r.status_code != 200:
                return []
            # Ищем __NEXT_DATA__
            m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', r.text, re.DOTALL)
            if not m:
                return []
            data = json.loads(m.group(1))
            results = []
            seen = set()
            _extract_ozon_items_from_next(data, seen, results, limit)
            return results
    except Exception as e:
        logger.warning("Ozon HTML fallback error: %s", e)
        return []


def _extract_ozon_items_from_next(node, seen, results, limit):
    if not isinstance(node, dict) or len(results) >= limit:
        return
    _try_ozon_item(node, seen, results)
    for v in node.values():
        if isinstance(v, dict):
            _extract_ozon_items_from_next(v, seen, results, limit)
        elif isinstance(v, list):
            for el in v:
                if isinstance(el, dict):
                    _extract_ozon_items_from_next(el, seen, results, limit)


# ─────────────────────────────────────────────────────────────
# ЯНДЕКС МАРКЕТ
# ─────────────────────────────────────────────────────────────

YM_RS_TOKEN = "eJwzEv_EKMLBKLDwEKsEg8azbh6NVUdYNT6fYQUAWiMIFg,,"


async def search_yandex_market(query: str, region: str = "Москва", limit: int = 8) -> list[MarketProduct]:
    q = quote(query)
    region_id = _ym_region_id(region)

    rs = quote(YM_RS_TOKEN)
    endpoints = [
        # allowSemanticRedirect=0 — запрещает редирект на карточку одного товара
        f"https://market.yandex.ru/search?text={q}&lr={region_id}&allowSemanticRedirect=0&how=dpop",
        f"https://market.yandex.ru/search?text={q}&rs={rs}&lr={region_id}&allowSemanticRedirect=0",
        f"https://market.yandex.ru/search?text={q}&lr={region_id}",
    ]

    headers_html = {
        **BASE_HEADERS,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        "sec-fetch-dest": "document",
        "sec-fetch-mode": "navigate",
        "sec-fetch-site": "none",
    }

    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=True) as client:
        for endpoint in endpoints:
            try:
                r = await client.get(endpoint, headers=headers_html)
                final_url = str(r.url)
                # YM иногда делает семантический редирект на карточку одного товара —
                # /card/ или /product/ содержат только 1 JSON-LD, не список.
                if r.status_code == 200 and "/card/" not in final_url and "/product/" not in final_url:
                    products = _parse_ym_html(r.text, 25)
                    if len(products) >= 3:
                        products = select_median_products(products, limit)
                        logger.info("YM: %d медианных товаров для '%s' (url=%s)", len(products), query, final_url)
                        return products
                    logger.debug("YM: html дал только %d товаров, идём в Playwright, url=%s", len(products), final_url)
                elif r.status_code == 200:
                    logger.debug("YM: пропускаем редирект на карточку %s", final_url)
            except Exception as e:
                logger.debug("YM error: %s", e)

    # httpx путь не сработал — Playwright fallback
    logger.info("YM: httpx заблокирован, переключаемся на Playwright")
    try:
        from marketplace_playwright import search_ym_playwright
        raw = await search_ym_playwright(query, limit=25)
        products = [MarketProduct(
            name=r["name"], price=r["price"], image_url=r["image_url"],
            source_url=r["source_url"], source="yandex_market",
            characteristics=r.get("characteristics", {}),
        ) for r in raw]
        if products:
            return select_median_products(products, limit)
    except Exception as e:
        logger.warning("YM Playwright fallback failed: %s", e)

    logger.warning("YM: ничего не найдено для '%s'", query)
    return []


def _ym_region_id(region: str) -> int:
    mapping = {
        "Москва": 213, "Санкт-Петербург": 2, "Новосибирск": 65,
        "Екатеринбург": 54, "Казань": 43, "Нижний Новгород": 47,
        "Челябинск": 56, "Самара": 51, "Омск": 66, "Ростов-на-Дону": 39,
    }
    return mapping.get(region, 213)


def _extract_ym_items(data: dict, limit: int) -> list[MarketProduct]:
    results = []
    seen = set()

    def walk(node):
        if not isinstance(node, dict) or len(results) >= limit:
            return
        name = node.get("name") or node.get("title", "")
        price_node = node.get("price") or node.get("prices") or {}
        if isinstance(price_node, dict):
            price_raw = price_node.get("value") or price_node.get("min") or price_node.get("avg") or 0
        elif isinstance(price_node, (int, float, str)):
            price_raw = price_node
        else:
            price_raw = 0
        try:
            price = float(str(price_raw).replace(" ", ""))
        except Exception:
            price = 0

        if name and price > 0:
            key = name[:40] + str(price)
            if key not in seen:
                seen.add(key)
                url = node.get("url") or node.get("link") or ""
                if url and not url.startswith("http"):
                    url = "https://market.yandex.ru" + url
                img = node.get("picture") or node.get("image") or node.get("photo") or ""
                if isinstance(img, dict):
                    img = img.get("url", "")
                results.append(MarketProduct(
                    name=name[:120],
                    price=price,
                    image_url=img,
                    source_url=url or "https://market.yandex.ru",
                    source="yandex_market",
                ))

        for v in node.values():
            if isinstance(v, dict):
                walk(v)
            elif isinstance(v, list):
                for el in v:
                    if isinstance(el, dict):
                        walk(el)

    walk(data)
    return results


def _ym_extract_price(p: dict) -> float:
    def _first_pos(obj) -> float:
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
                r = _first_pos(v)
                if r > 0:
                    return r
        return 0.0
    for field in ("prices", "price", "offer", "salePrice", "minPrice"):
        r = _first_pos(p.get(field))
        if r > 0:
            return r
    return 0.0


def _parse_ym_html(html: str, limit: int) -> list[MarketProduct]:
    """Парсит HTML страницы YM. Приоритет: noframes apiary → __NEXT_DATA__ → JSON-LD."""
    results = []
    seen: set[str] = set()

    # Диагностика: что вообще есть в HTML
    noframes_count = len(re.findall(r'<noframes[^>]+data-apiary="patch"', html))
    jsonld_types = re.findall(r'"@type"\s*:\s*"([^"]+)"', html[:50000])
    next_data_present = '__NEXT_DATA__' in html
    logger.debug("YM HTML диагностика: noframes=%d, __NEXT_DATA__=%s, jsonld_types=%s, html_size=%d",
                 noframes_count, next_data_present, list(dict.fromkeys(jsonld_types))[:10], len(html))

    # 1) YM встраивает данные товаров в <noframes data-apiary="patch"> блоки
    _ym_colls_logged = False
    for blob_text in re.findall(r'<noframes[^>]+data-apiary="patch"[^>]*>(.*?)</noframes>', html, re.DOTALL):
        try:
            blob = json.loads(blob_text)
            collections = blob.get("collections") or {}
            if not collections:
                continue
            # Один раз логируем какие коллекции существуют
            if not _ym_colls_logged:
                logger.debug("YM noframes коллекции: %s", list(collections.keys()))
                _ym_colls_logged = True
            # Ищем товары в ЛЮБОЙ коллекции (YM переименовывал "product" в другие ключи)
            for coll_name, coll_data in collections.items():
                if not isinstance(coll_data, dict):
                    continue
                for p in coll_data.values():
                    if not isinstance(p, dict) or len(results) >= limit:
                        break
                    name = (p.get("titles") or {}).get("raw") or p.get("name", "")
                    price = _ym_extract_price(p)
                    if not name or price <= 0 or len(name) < 4:
                        continue
                    key = name[:40] + str(price)
                    if key in seen:
                        continue
                    seen.add(key)
                    pid = p.get("id")
                    slug = p.get("slug", "")
                    url = (f"https://market.yandex.ru/product--{slug}/{pid}"
                           if slug and pid else "https://market.yandex.ru")
                    img = p.get("picture") or p.get("image") or ""
                    if isinstance(img, dict):
                        img = img.get("url", "")
                    if isinstance(img, str) and img.startswith("//"):
                        img = "https:" + img
                    results.append(MarketProduct(
                        name=name[:120], price=price, image_url=img,
                        source_url=url, source="yandex_market",
                    ))
        except Exception:
            continue
    logger.debug("YM noframes итого: %d товаров", len(results))
    if results:
        return results

    # 2) __NEXT_DATA__
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.DOTALL)
    if m:
        try:
            products = _extract_ym_items(json.loads(m.group(1)), limit)
            if products:
                return products
        except Exception:
            pass

    # 3) JSON-LD: Product / ItemList / OfferCatalog
    for block in re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>', html, re.DOTALL):
        try:
            data = json.loads(block)
            items_to_try = data if isinstance(data, list) else [data]
            for item in items_to_try:
                t = item.get("@type", "")
                if t == "Product":
                    _try_jsonld_product(item, seen, results, limit)
                elif t in ("ItemList", "OfferCatalog"):
                    for list_el in (item.get("itemListElement") or []):
                        inner = list_el.get("item") or list_el
                        if isinstance(inner, dict) and inner.get("@type") == "Product":
                            _try_jsonld_product(inner, seen, results, limit)
                elif t == "WebPage":
                    # YM иногда кладёт товары в mainEntity
                    main = item.get("mainEntity") or {}
                    if main.get("@type") == "ItemList":
                        for list_el in (main.get("itemListElement") or []):
                            inner = list_el.get("item") or list_el
                            if isinstance(inner, dict) and inner.get("@type") == "Product":
                                _try_jsonld_product(inner, seen, results, limit)
        except Exception:
            continue
        if len(results) >= limit:
            break

    # 4) Инлайн JSON с товарами: YM встраивает {"entity":"product",...} в JS
    if not results:
        for m_js in re.finditer(r'\{"entity":"product"[^}]{10,500}"price":\s*(\d+)', html):
            try:
                # Извлекаем фрагмент вокруг совпадения и пробуем его распарсить
                start = m_js.start()
                decoder = json.JSONDecoder()
                obj, _ = decoder.raw_decode(html, start)
                prices_obj = obj.get("prices") or {}
                price_val = prices_obj.get("min") or prices_obj.get("avg") or obj.get("price", 0)
                try:
                    price = float(str(price_val).replace(" ", ""))
                except Exception:
                    continue
                name = obj.get("name") or obj.get("title", "")
                if name and price > 0:
                    key = name[:40] + str(price)
                    if key not in seen:
                        seen.add(key)
                        slug = obj.get("slug", "")
                        pid = obj.get("id", "")
                        url = f"https://market.yandex.ru/product--{slug}/{pid}" if slug else "https://market.yandex.ru"
                        results.append(MarketProduct(
                            name=name[:120], price=price,
                            image_url=obj.get("picture") or "",
                            source_url=url, source="yandex_market",
                        ))
                if len(results) >= limit:
                    break
            except Exception:
                continue

    return results


def _try_jsonld_product(data: dict, seen: set, results: list, limit: int):
    if len(results) >= limit:
        return
    name = data.get("name", "")
    offers = data.get("offers", {})
    if isinstance(offers, list):
        offers = offers[0] if offers else {}
    price_raw = offers.get("price", 0) or offers.get("lowPrice", 0)
    try:
        price = float(str(price_raw).replace(" ", ""))
    except Exception:
        return
    if not name or price <= 0:
        return
    key = name[:40] + str(price)
    if key in seen:
        return
    seen.add(key)
    img = data.get("image", "")
    if isinstance(img, list):
        img = img[0] if img else ""
    results.append(MarketProduct(
        name=name[:120],
        price=price,
        image_url=img if isinstance(img, str) else "",
        source_url=data.get("url", "https://market.yandex.ru"),
        source="yandex_market",
    ))
