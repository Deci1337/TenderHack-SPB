#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
import sys
import time
from dataclasses import dataclass
from typing import List
from urllib.parse import parse_qs, quote, urlparse, urlunparse

from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0.0.0 Safari/537.36"
)

PRICE_RE = re.compile(r"(?P<value>[\d\s]{2,}(?:[.,]\d{1,2})?)\s?(?:₽|руб\.?|RUB)", re.IGNORECASE)


@dataclass
class Offer:
    title: str
    price: str
    url: str


def normalize_price_text(text: str) -> str:
    match = PRICE_RE.search(text or "")
    return match.group("value").replace("\xa0", " ").strip() if match else ""


def extract_title_from_card_text(text: str) -> str:
    lines = [line.strip() for line in (text or "").splitlines() if line.strip()]
    return lines[0] if lines else ""


def is_ozon_url(url: str) -> bool:
    host = urlparse(url).netloc.lower()
    return host.endswith("ozon.ru")


def build_ozon_search_paths(url: str) -> list[str]:
    parsed = urlparse(url)
    query = parse_qs(parsed.query).get("text", [""])[0].strip()
    original_path = urlunparse(("", "", parsed.path, "", parsed.query, ""))
    candidates = [original_path]

    if query:
        candidates.insert(0, f"/search/?text={quote(query)}&from_global=true")

    deduped: list[str] = []
    seen = set()
    for candidate in candidates:
        if candidate and candidate not in seen:
            seen.add(candidate)
            deduped.append(candidate)
    return deduped


def build_composer_urls(path: str) -> list[str]:
    encoded = quote(path, safe="")
    return [
        f"https://api.ozon.ru/composer-api.bx/page/json/v1?url={encoded}",
        f"https://api.ozon.ru/composer-api.bx/page/json/v2?url={encoded}",
        f"https://www.ozon.ru/api/composer-api.bx/page/json/v1?url={encoded}",
        f"https://www.ozon.ru/api/composer-api.bx/page/json/v2?url={encoded}",
    ]


def extract_composer_offers(payload: object) -> list[Offer]:
    if not isinstance(payload, dict):
        return []
    catalog = payload.get("catalog")
    if not isinstance(catalog, dict):
        return []
    search_results = catalog.get("searchResultsV2")
    if not isinstance(search_results, dict):
        return []

    offers: list[Offer] = []
    for widget in search_results.values():
        if not isinstance(widget, dict):
            continue
        items = widget.get("items")
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            info = item.get("cellTrackingInfo") or {}
            if not isinstance(info, dict):
                continue
            title = str(info.get("title") or "").strip()
            price = str(info.get("finalPrice") or info.get("price") or "").strip()
            if not title or not price:
                continue
            url = str(item.get("url") or item.get("link") or info.get("url") or info.get("link") or "").strip()
            offers.append(Offer(title=title, price=price, url=url))
    return offers


def fetch_json(api_request, url: str) -> tuple[int, object]:
    response = api_request.get(
        url,
        headers={
            "accept": "application/json,text/plain,*/*",
            "accept-language": "ru-RU,ru;q=0.9,en;q=0.8",
            "user-agent": DEFAULT_USER_AGENT,
        },
        timeout=60000,
    )
    status = response.status
    text = response.text()
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = None
    return status, payload


def collect_product_card_texts(url: str) -> List[str]:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(headless=True)
        context = browser.new_context(user_agent=DEFAULT_USER_AGENT)
        page = context.new_page()

        page.goto(url, wait_until="domcontentloaded", timeout=60000)
        try:
            page.wait_for_load_state("networkidle", timeout=60000)
        except PlaywrightTimeoutError:
            pass

        offers: list[Offer] = []
        total_height = page.evaluate("document.body.scrollHeight")
        viewport_height = page.viewport_size["height"] if page.viewport_size else 800
        step = max(400, viewport_height)
        for offset in range(0, total_height + step, step):
            page.evaluate("(y) => window.scrollTo(0, y)", offset)
            time.sleep(0.35)
        page.evaluate("window.scrollTo(0, 0)")
        try:
            page.wait_for_load_state("networkidle", timeout=5000)
        except PlaywrightTimeoutError:
            pass

        cards = page.locator(".product-card")
        count = cards.count()
        for index in range(count):
            text = cards.nth(index).inner_text(timeout=10000).strip()
            title = extract_title_from_card_text(text)
            price = normalize_price_text(text)
            if title and price:
                offers.append(Offer(title=title, price=price, url=""))

        title = page.title().strip()
        print(f"URL: {page.url}", file=sys.stderr)
        print(f"Title: {title}", file=sys.stderr)
        print(f"Matched .product-card elements: {count}", file=sys.stderr)

        composer_blocked = False
        composer_attempted = False
        if not offers and is_ozon_url(url):
            for path in build_ozon_search_paths(url):
                composer_offers: list[Offer] = []
                for composer_url in build_composer_urls(path):
                    composer_attempted = True
                    status, payload = fetch_json(context.request, composer_url)
                    print(f"Composer: {composer_url} status={status}", file=sys.stderr)
                    if status in {403, 429}:
                        composer_blocked = True
                    composer_offers = extract_composer_offers(payload)
                    if composer_offers:
                        offers = composer_offers
                        break
                if offers:
                    break

        if not offers and composer_attempted and composer_blocked:
            print("Ozon anti-bot blocked the page and composer endpoints.", file=sys.stderr)

        browser.close()
        return [f"{offer.title} | {offer.price} | {offer.url}".strip() for offer in offers]


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Collect text content from elements with class .product-card."
    )
    parser.add_argument("url", help="Target URL to open with Playwright")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    texts = collect_product_card_texts(args.url)
    if not texts:
        print("No prices could be extracted.", file=sys.stderr)
        return 2
    for text in texts:
        sys.stdout.write(f"{text}\n---\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
