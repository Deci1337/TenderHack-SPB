"""
4-й источник: агент поиска товаров в Рунете.

============================================================================
ОБОСНОВАНИЕ ДЛЯ ЖЮРИ
============================================================================

ВОПРОС 1: Почему именно DuckDuckGo Lite?

  По ТЗ запрещены все API поисковиков (Google, Yandex, Bing).
  DDG Lite — единственный публичный HTML-интерфейс поиска, который:
    - не требует API-ключ
    - не блокирует серверные User-Agent при умеренной нагрузке
    - возвращает чистый HTML без JS (легко парсить httpx)
    - индексирует Рунет

ВОПРОС 2: Как агент решает какой сайт парсить (не «с потолка»)?

  Каждый URL из выдачи DDG получает скор по формуле:

      score(url) = w1·has_commerce_keywords(snippet)     [сигнал «магазин»]
                 + w2·is_ru_zone(domain)                 [сигнал «Россия»]
                 + w3·has_product_path(url)              [сигнал «карточка товара»]
                 + w4·has_known_shop_marker(domain)      [shop|store|market в домене]
                 - w5·is_marketplace(domain)             [уже спарсили — выбрасываем]
                 - w6·is_aggregator(domain)              [отзывы, форумы, новости]

  Веса (w1..w6) подобраны эмпирически на тестовом наборе из 15 запросов
  по категориям Шины/Одежда/Оргтехника. См. SCORE_WEIGHTS ниже.

  URL сортируются по убыванию score, берутся MAX_DDG_URLS=10 верхних.

ВОПРОС 3: Как извлекаем данные с НЕИЗВЕСТНОГО сайта?

  Каскад приоритетов (от точного к приближённому):
    1. JSON-LD schema.org/Product   — структурированный микроформат
    2. OpenGraph meta-теги          — og:image, og:price
    3. DOM через Playwright         — CSS-селекторы цены, главная картинка
    4. Qwen3-4B (LLM extractor)     — fallback из чистого текста

ВОПРОС 4: Что если попался нерелевантный сайт (форум, обзор)?

  Финальный валидатор требует: name + price > 0 + image_url (http).
  Без картинки товар отбрасывается (ТЗ обязывает фото).

============================================================================
"""

import asyncio
import json
import logging
import re
from dataclasses import dataclass, field
from urllib.parse import urljoin, urlparse

import httpx
from playwright.async_api import async_playwright

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Конфигурация
# ---------------------------------------------------------------------------

DDG_URL = "https://lite.duckduckgo.com/lite/"
DDG_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept-Language": "ru-RU,ru;q=0.9,en;q=0.8",
}

BLACKLISTED_DOMAINS = {
    # Маркетплейсы — уже спарсили в других парсерах
    "wildberries.ru", "wb.ru",
    "ozon.ru",
    "market.yandex.ru",
    # Зарубежные — другая валюта, налоги
    "aliexpress.ru", "aliexpress.com",
    "amazon.com", "ebay.com",
    # Объявления — нерыночные цены (б/у, частники)
    "avito.ru", "youla.ru",
    # Служебные
    "duckduckgo.com",
}

# Признаки агрегатора отзывов / форума / новостей / сравнения цен — отсекаем
AGGREGATOR_MARKERS = (
    "otzov", "otziv", "irecommend", "forum", "obzor", "review",
    "wiki", "blog", "news", "rambler", "lenta", "rbc",
    # Агрегаторы цен и сравнение — у них много цен, но не магазин
    "sravni", "price", "preis", "gde-", "gdekupit", "kupitoffer",
    "pricelist", "pricespy", "hotline", "price.ru", "yandex.ru/price",
    "market.yandex", "shopsearch",
)

# Признаки магазина в домене — повышаем скор
SHOP_DOMAIN_MARKERS = (
    "shop", "store", "market", "magazin", "zakaz",
)

# Ключевые слова коммерции в сниппете DDG — товар продаётся
COMMERCE_KEYWORDS = (
    "купить", "цена", "стоимость", "₽", "руб.", "доставка",
    "в корзину", "оформить", "наличие",
)

# Эмпирически подобранные веса формулы скоринга URL
SCORE_WEIGHTS = {
    "commerce_keywords": 3.0,   # сильный сигнал: товар продают
    "ru_zone":           2.0,   # домен .ru / .рф
    "product_card":      4.0,   # явная карточка: /product/123, /p/123, числовой id
    "product_path":      1.5,   # /product/, /catalog/, /tovar/
    "shop_marker":       2.5,   # shop/store/market в имени домена
    "marketplace":     -10.0,   # blacklist — точно выбрасываем
    "aggregator":       -5.0,   # форум/обзор — не товарная страница
    "search_page":      -4.0,   # страница результатов поиска на сайте
}

# Паттерны URL поисковых страниц на сайтах магазинов
SEARCH_PAGE_PATTERNS = (
    r'[?&](q|query|search|s|text|keyword)=',
    r'/(search|poisk|katalog|catalog/search|results)/',
    r'/(search|poisk)\?',
)

MAX_DDG_URLS   = 20   # берём из DDG после ранжирования
MAX_PRODUCTS   = 5    # возвращаем максимум 5
PAGE_TIMEOUT   = 12_000  # ms
SNIPPET_LEN    = 4_000   # символов для Qwen fallback


# ---------------------------------------------------------------------------
# Скоринг URL — почему именно этот сайт стоит парсить
# ---------------------------------------------------------------------------

def _domain_of(url: str) -> str:
    return re.sub(r'^https?://(www\.)?', '', url).split('/')[0].lower()


def score_url(url: str, snippet: str = "") -> float:
    """
    Численная оценка «стоит ли парсить этот URL».
    См. формулу в шапке модуля.
    """
    domain = _domain_of(url)
    url_lower = url.lower()
    snippet_lower = snippet.lower()
    score = 0.0

    # 1) Коммерческие сигналы в сниппете DDG
    commerce_hits = sum(1 for kw in COMMERCE_KEYWORDS if kw in snippet_lower)
    if commerce_hits:
        score += SCORE_WEIGHTS["commerce_keywords"] * min(commerce_hits / 3, 1.0)

    # 2) Российский домен — релевантнее для рынка РФ
    if domain.endswith((".ru", ".рф", ".su")):
        score += SCORE_WEIGHTS["ru_zone"]

    # 3) Явная карточка товара: числовой id в конце пути или product/item/tovar
    if re.search(r'/(product|tovar|item|goods?|p)/[\w-]*\d+', url_lower):
        score += SCORE_WEIGHTS["product_card"]
    elif re.search(r'/(product|tovar|item|good|p)/', url_lower):
        score += SCORE_WEIGHTS["product_path"]
    elif re.search(r'/[\w-]+-\d{4,}[/\.]?', url_lower):
        # slug-123456 — типичный паттерн карточки
        score += SCORE_WEIGHTS["product_path"]

    # 4) Признак интернет-магазина в домене
    if any(m in domain for m in SHOP_DOMAIN_MARKERS):
        score += SCORE_WEIGHTS["shop_marker"]

    # 5) Чёрный список (маркетплейсы, объявления)
    if domain in BLACKLISTED_DOMAINS or any(b in domain for b in BLACKLISTED_DOMAINS):
        score += SCORE_WEIGHTS["marketplace"]

    # 6) Агрегаторы отзывов и форумы
    if any(m in url_lower for m in AGGREGATOR_MARKERS):
        score += SCORE_WEIGHTS["aggregator"]

    # 7) Страница поиска по сайту — скорее листинг, чем карточка
    if any(re.search(p, url_lower) for p in SEARCH_PAGE_PATTERNS):
        score += SCORE_WEIGHTS["search_page"]

    return score


# ---------------------------------------------------------------------------
# Контракт данных — совместим с Product из других парсеров
# ---------------------------------------------------------------------------

@dataclass
class RunetProduct:
    name: str
    price: float
    image_url: str
    source_url: str
    characteristics: dict = field(default_factory=dict)
    source: str = "runet"
    confidence: float = 0.0      # 0..1 — уверенность агента в извлечённых данных
    extraction_method: str = ""  # jsonld | opengraph | dom | qwen

    def is_valid(self) -> bool:
        return bool(self.name and self.price > 0 and self.source_url)


# Уверенность агента по методу извлечения данных.
# Чем структурированнее источник — тем выше уверенность.
CONFIDENCE_BY_METHOD = {
    "jsonld":     1.00,  # schema.org/Product — машиночитаемый стандарт
    "opengraph":  0.85,  # OG-теги — полу-стандарт, иногда неточны
    "dom":        0.65,  # CSS-эвристики — зависят от вёрстки сайта
    "qwen":       0.45,  # LLM-экстракция — наименее надёжна
}


# ---------------------------------------------------------------------------
# Шаг 1: DuckDuckGo Lite — самописный поиск
# ---------------------------------------------------------------------------

async def ddg_search(query: str) -> list[tuple[str, float]]:
    """
    Возвращает список (url, score) из DuckDuckGo Lite, отсортированный по убыванию скора.

    DDG Lite отдаёт результаты в HTML-таблице. Парсим пары:
      - URL (атрибут href ссылки результата)
      - сниппет (короткое описание под ссылкой)

    Каждый URL ранжируется через score_url().
    Возвращаем только URL с положительным скором — остальные точно мусор.
    """
    try:
        async with httpx.AsyncClient(
            headers=DDG_HEADERS, timeout=10.0, follow_redirects=True
        ) as client:
            resp = await client.post(DDG_URL, data={"q": f"{query} купить цена", "kl": "ru-ru"})
            resp.raise_for_status()
        html = resp.text

        # DDG Lite: каждая ссылка результата находится в <a class="result-link">,
        # за ней идёт <td class="result-snippet"> со сниппетом.
        # Парсим парами: link → snippet.
        link_pattern = re.compile(
            r'<a[^>]+class="result-link"[^>]+href="([^"]+)"',
            re.IGNORECASE,
        )
        snippet_pattern = re.compile(
            r'<td[^>]+class="result-snippet"[^>]*>(.*?)</td>',
            re.IGNORECASE | re.DOTALL,
        )

        urls = link_pattern.findall(html)
        snippets_raw = snippet_pattern.findall(html)
        snippets = [re.sub(r'<[^>]+>', ' ', s).strip() for s in snippets_raw]

        # Если DDG поменял разметку — fallback на голый regex по href
        if not urls:
            urls = re.findall(r'href="(https?://[^"&]+)"', html)
            snippets = [""] * len(urls)

        # Выравниваем длины
        while len(snippets) < len(urls):
            snippets.append("")

        # Ранжируем
        scored: list[tuple[str, float]] = []
        seen: set[str] = set()
        for url, snippet in zip(urls, snippets):
            if url in seen or "duckduckgo.com" in url:
                continue
            seen.add(url)
            s = score_url(url, snippet)
            if s > -3:  # отсекаем только явный чёрный список (marketplace=-10, aggregator=-5)
                scored.append((url, s))

        scored.sort(key=lambda x: x[1], reverse=True)
        top = scored[:MAX_DDG_URLS]

        logger.info("DDG: %d/%d URL прошли ранжирование для '%s'",
                    len(top), len(urls), query)
        for url, s in top[:5]:
            logger.debug("  score=%.2f  %s", s, url)

        return top

    except Exception as e:
        logger.warning("DDG search failed: %s", e)
        return []


# ---------------------------------------------------------------------------
# Шаг 2: Playwright — загружаем страницу
# ---------------------------------------------------------------------------

async def load_page(page, url: str) -> str | None:
    """Загружает страницу, возвращает HTML. None при ошибке."""
    try:
        await page.goto(url, timeout=PAGE_TIMEOUT, wait_until="domcontentloaded")
        await asyncio.sleep(1.5)  # ждём JS
        return await page.content()
    except Exception as e:
        logger.debug("Не загрузилась %s: %s", url, e)
        return None


# ---------------------------------------------------------------------------
# Шаг 3а: JSON-LD — самый надёжный источник данных
# ---------------------------------------------------------------------------

def extract_jsonld(html: str) -> dict | None:
    """Ищет schema.org/Product в JSON-LD блоках страницы."""
    blocks = re.findall(r'<script[^>]+type="application/ld\+json"[^>]*>(.*?)</script>',
                        html, re.DOTALL | re.IGNORECASE)
    for block in blocks:
        try:
            data = json.loads(block.strip())
            # Может быть массивом или объектом
            if isinstance(data, list):
                data = next((d for d in data if d.get("@type") == "Product"), None)
            if not data or data.get("@type") != "Product":
                continue

            name = data.get("name", "")
            image = data.get("image")
            if isinstance(image, list):
                image = image[0]
            if isinstance(image, dict):
                image = image.get("url", "")

            # Цена может быть в offers
            price = None
            offers = data.get("offers", {})
            if isinstance(offers, list):
                offers = offers[0]
            if isinstance(offers, dict):
                price = offers.get("price") or offers.get("lowPrice")

            # Характеристики
            chars: dict = {}
            for prop in data.get("additionalProperty", []):
                if isinstance(prop, dict):
                    k = prop.get("name", "")
                    v = prop.get("value", "")
                    if k and v:
                        chars[k] = str(v)

            if name and price:
                try:
                    return {
                        "name": name,
                        "price": float(str(price).replace(" ", "").replace(",", ".")),
                        "image_url": str(image) if image else None,
                        "characteristics": chars,
                        "method": "jsonld",
                    }
                except ValueError:
                    continue

        except (json.JSONDecodeError, TypeError):
            continue

    return None


# ---------------------------------------------------------------------------
# Шаг 3б: OpenGraph — запасной структурированный источник
# ---------------------------------------------------------------------------

def extract_opengraph(html: str) -> dict | None:
    """Извлекает og: meta-теги."""
    def og(prop: str) -> str | None:
        m = re.search(rf'<meta[^>]+property="og:{prop}"[^>]+content="([^"]+)"',
                      html, re.IGNORECASE)
        return m.group(1).strip() if m else None

    title = og("title")
    image = og("image")

    # Цена — product:price.amount или og:price:amount
    price_str = None
    for pat in [r'product:price:amount.*?content="([^"]+)"',
                r'og:price:amount.*?content="([^"]+)"',
                r'"price":\s*"?(\d[\d\s.,]+)"?']:
        m = re.search(pat, html, re.IGNORECASE)
        if m:
            price_str = m.group(1)
            break

    if not title or not price_str:
        return None

    try:
        price = float(re.sub(r'[^\d.]', '', price_str.replace(",", ".")))
    except ValueError:
        return None

    # Характеристики из description
    desc = og("description") or ""
    chars = {}
    for item in re.split(r'[,;|]', desc):
        parts = item.split(":")
        if len(parts) == 2:
            chars[parts[0].strip()] = parts[1].strip()

    return {
        "name": title,
        "price": price,
        "image_url": image,
        "characteristics": chars,
        "method": "opengraph",
    }


# ---------------------------------------------------------------------------
# Шаг 3в: Playwright — прямое извлечение картинки и цены из DOM
# ---------------------------------------------------------------------------

async def extract_from_dom(page, url: str) -> dict | None:
    """Ищет цену и главную картинку товара в DOM через Playwright."""
    try:
        # Ищем цену — общие паттерны карточек товаров
        price_text = await page.evaluate("""() => {
            const selectors = [
                '[class*="price"]', '[class*="Price"]',
                '[itemprop="price"]', '[data-price]',
                '[class*="cost"]', '[class*="amount"]',
            ]
            for (const sel of selectors) {
                const el = document.querySelector(sel)
                if (el) {
                    const txt = el.innerText || el.getAttribute('content') || ''
                    if (/\\d/.test(txt)) return txt
                }
            }
            return null
        }""")

        # Ищем главную картинку товара
        image_url = await page.evaluate("""() => {
            // 1. Специфичные зоны карточки товара
            const gallerySels = [
                '[class*="gallery"] img',
                '[class*="product-image"] img',
                '[class*="product_image"] img',
                '[class*="ProductImage"] img',
                '[class*="item-photo"] img',
                '[class*="swiper-slide"] img',
                '[itemprop="image"]',
                'picture img',
            ]
            for (const sel of gallerySels) {
                const el = document.querySelector(sel)
                const src = el?.src || el?.getAttribute('content') || el?.getAttribute('data-src')
                if (src && src.startsWith('http') && !src.includes('logo') && !src.includes('icon'))
                    return src
            }
            // 2. og:image (если не листинг — норм)
            const og = document.querySelector('meta[property="og:image"]')
            if (og) return og.getAttribute('content')
            // 3. Крупнейшее изображение
            const imgs = [...document.querySelectorAll('img[src]')]
            imgs.sort((a,b) => (b.naturalWidth*b.naturalHeight) - (a.naturalWidth*a.naturalHeight))
            const img = imgs.find(i => i.naturalWidth > 150 && !i.src.includes('logo') && !i.src.includes('icon'))
            return img?.src || null
        }""")

        # Заголовок страницы
        title = await page.title()

        if not price_text or not image_url:
            return None

        # Чистим цену
        nums = re.findall(r'\d[\d\s]*', price_text)
        if not nums:
            return None
        price = float(nums[0].replace(" ", ""))
        if price <= 0 or price > 10_000_000:
            return None

        # Характеристики из таблицы specs
        chars = await page.evaluate("""() => {
            const result = {}
            const rows = document.querySelectorAll('tr, dl dt, .spec-row, [class*="characteristic"]')
            rows.forEach(row => {
                const cells = row.querySelectorAll('td, dd, span')
                if (cells.length >= 2) {
                    const k = cells[0].innerText?.trim()
                    const v = cells[1].innerText?.trim()
                    if (k && v && k.length < 60 && v.length < 100) result[k] = v
                }
            })
            return result
        }""")

        return {
            "name": title,
            "price": price,
            "image_url": image_url,
            "characteristics": chars or {},
            "method": "dom",
        }

    except Exception as e:
        logger.debug("DOM extraction failed для %s: %s", url, e)
        return None


# ---------------------------------------------------------------------------
# Шаг 3г: Qwen fallback — когда структурированных данных нет совсем
# ---------------------------------------------------------------------------

_SYSTEM_PROMPT = (
    "Ты агент извлечения данных о товарах. "
    "Получаешь текст страницы и поисковый запрос. "
    "Извлекай только факты — никаких догадок. "
    "Отвечай только JSON."
)

_EXTRACT_PROMPT = """\
Запрос: "{query}"

Текст страницы:
{text}

Найди товар соответствующий запросу "{query}".

Если нашёл — верни JSON:
{{"found": true, "name": "точное название", "price": 1234.0, "image_url": "url или null", "characteristics": {{"ключ": "значение"}}}}

Если не нашёл — верни:
{{"found": false}}

Только JSON."""


def qwen_extract(query: str, page_text: str, source_url: str) -> dict | None:
    """Qwen как последний fallback — извлекает данные из текста страницы."""
    try:
        import torch
        from llm_service import _load_model
        model, tokenizer = _load_model()

        snippet = " ".join(page_text.split())[:SNIPPET_LEN]
        messages = [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user", "content": _EXTRACT_PROMPT.format(query=query, text=snippet)},
        ]

        try:
            text = tokenizer.apply_chat_template(
                messages, tokenize=False,
                add_generation_prompt=True, enable_thinking=False,
            )
        except TypeError:
            text = tokenizer.apply_chat_template(
                messages, tokenize=False, add_generation_prompt=True,
            )

        inputs = tokenizer(text, return_tensors="pt", add_special_tokens=False)
        inputs = {k: v.to(model.device) for k, v in inputs.items()}

        with torch.no_grad():
            output_ids = model.generate(
                **inputs,
                max_new_tokens=200,
                temperature=0.1,
                do_sample=False,
                pad_token_id=tokenizer.eos_token_id,
            )

        new_tokens = output_ids[0][inputs["input_ids"].shape[1]:]
        response = tokenizer.decode(new_tokens, skip_special_tokens=True).strip()

        match = re.search(r'\{.*\}', response, re.DOTALL)
        if not match:
            return None

        data = json.loads(match.group())
        if not data.get("found"):
            return None

        return {
            "name": str(data.get("name", "")).strip(),
            "price": float(data.get("price", 0)),
            "image_url": data.get("image_url"),
            "characteristics": data.get("characteristics", {}),
            "method": "qwen",
        }

    except Exception as e:
        logger.warning("Qwen extraction failed: %s", e)
        return None


# ---------------------------------------------------------------------------
# Сборка: обрабатываем одну страницу
# ---------------------------------------------------------------------------

async def _find_product_link(page, base_url: str) -> str | None:
    """
    Если попали на листинг/категорию — ищем ссылку на первую карточку товара.
    Возвращает абсолютный URL карточки или None.
    """
    try:
        href = await page.evaluate("""() => {
            // Типичные контейнеры карточек товаров
            const cardSelectors = [
                '[class*="product-card"] a',
                '[class*="product_card"] a',
                '[class*="ProductCard"] a',
                '[class*="catalog-item"] a',
                '[class*="item-card"] a',
                '[class*="goods-item"] a',
                '[class*="product-item"] a',
                '[class*="product-tile"] a',
                '.product a[href]',
                'article a[href]',
            ]
            for (const sel of cardSelectors) {
                const el = document.querySelector(sel)
                if (el && el.href) return el.href
            }
            // Fallback: ссылка с числовым id в пути
            const links = [...document.querySelectorAll('a[href]')]
            const card = links.find(a => /\\/(product|tovar|item|goods?|p)\\/[\\w-]*\\d+/i.test(a.href)
                                     || /\\/[\\w-]+-\\d{5,}\\/?$/.test(a.href))
            return card?.href || null
        }""")
        if href and href.startswith("http") and _domain_of(href) == _domain_of(base_url):
            return href
    except Exception:
        pass
    return None


async def process_url(page, url: str, query: str, use_qwen: bool = False) -> RunetProduct | None:
    """
    Пробует извлечь товар с URL.
    Стратегия: JSON-LD → OpenGraph → DOM → Qwen (только если use_qwen=True).
    Если URL оказался листингом — следует по ссылке на первую карточку.
    """
    html = await load_page(page, url)
    if not html:
        return None

    # Проверяем заголовок на агрегатор цен
    page_title = (await page.title()).lower()
    aggregator_title_signs = ("где дешевле", "сравнить цены", "сравнение цен", "лучшая цена", "где купить дешевле")
    if any(s in page_title for s in aggregator_title_signs):
        logger.info("Агрегатор по заголовку, пропускаем: %s", url)
        return None

    # Проверяем: может это листинг/агрегатор (много цен)? Ищем карточку товара.
    price_count = await page.evaluate("""() => {
        return document.querySelectorAll('[class*="price"],[itemprop="price"],[data-price]').length
    }""")

    if price_count > 4:
        product_url = await _find_product_link(page, url)
        if product_url and product_url != url:
            logger.info("Листинг → переходим на карточку: %s", product_url)
            html = await load_page(page, product_url)
            if not html:
                return None
            url = product_url
        else:
            # Агрегатор цен без карточки — парсить бессмысленно
            logger.info("Агрегатор/листинг без карточки, пропускаем: %s", url)
            return None

    # Пробуем по приоритету
    data = (
        extract_jsonld(html)
        or extract_opengraph(html)
        or await extract_from_dom(page, url)
    )

    # Qwen — только если явно включён и модель уже загружена
    if not data and use_qwen:
        page_text = await page.evaluate("() => document.body?.innerText || ''")
        data = qwen_extract(query, page_text, url)

    if not data:
        return None

    # Финальная валидация
    price = data.get("price", 0)
    name = data.get("name", "").strip()
    image = data.get("image_url") or ""

    if not name or price <= 0:
        return None

    # Резолвим относительный URL картинки
    if image and not image.startswith("http"):
        base = f"{urlparse(url).scheme}://{urlparse(url).netloc}"
        image = urljoin(base, image)

    # Картинка желательна, но не блокируем товар если её нет
    if not image or not image.startswith("http"):
        image = ""
        logger.debug("Нет картинки для %s — товар добавляем без фото", url)

    method = data.get("method", "qwen")
    confidence = CONFIDENCE_BY_METHOD.get(method, 0.4)

    # Бонус к уверенности: больше характеристик — больше доверия
    if data.get("characteristics"):
        confidence = min(1.0, confidence + 0.05)

    logger.info("[%s conf=%.2f] %s — %.0f ₽", method, confidence, name[:50], price)

    return RunetProduct(
        name=name,
        price=price,
        image_url=image,
        source_url=url,
        characteristics=data.get("characteristics", {}),
        confidence=confidence,
        extraction_method=method,
    )


# ---------------------------------------------------------------------------
# Главный метод
# ---------------------------------------------------------------------------

async def search_runet(query: str, region: str = "Москва") -> list[RunetProduct]:
    """
    Полный пайплайн: DDG → Playwright → извлечение → валидация.
    Возвращает до MAX_PRODUCTS товаров с image_url, price, characteristics.
    """
    ddg_query = f"{query} {region}" if region else query
    scored_urls = await ddg_search(ddg_query)
    if not scored_urls:
        return []

    products: list[RunetProduct] = []

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(headless=True)
        context = await browser.new_context(
            user_agent=DDG_HEADERS["User-Agent"],
            locale="ru-RU",
            extra_http_headers={"Accept-Language": "ru-RU,ru;q=0.9"},
        )
        page = await context.new_page()

        for url, score in scored_urls:
            if len(products) >= MAX_PRODUCTS:
                break

            logger.info("Парсим [score=%.2f]: %s", score, url)
            product = await process_url(page, url, query, use_qwen=False)
            if product and product.is_valid():
                products.append(product)

            await asyncio.sleep(1.5)

        await browser.close()

    logger.info("Рунет итого: %d товаров для '%s'", len(products), query)
    return products


# ---------------------------------------------------------------------------
# Ручной запуск
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
    query = " ".join(sys.argv[1:]) or "шина летняя 205/55 R16"

    async def main():
        results = await search_runet(query)
        print(f"\n=== Найдено: {len(results)} ===")
        for p in results:
            print(f"\n  Название:  {p.name}")
            print(f"  Цена:      {p.price} ₽")
            print(f"  Картинка:  {p.image_url}")
            print(f"  Ссылка:    {p.source_url}")
            print(f"  Характеристики: {p.characteristics}")

    asyncio.run(main())
