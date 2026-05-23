"""
Live-smoke тест: проверяет что все 4 источника возвращают результаты.
Требует сеть. Запуск:

    pytest ml/test_live_sources.py -v -s
    pytest ml/test_live_sources.py -v -s --skip-slow   # пропустить Runet (он медленный)

Помечен `live` маркером — можно исключить из CI через `pytest -m "not live"`.
"""

import asyncio
import logging
import os

import pytest

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s: %(message)s")

# Тестовый запрос — простой ходовой товар, гарантированно есть на всех источниках.
QUERY = os.getenv("LIVE_TEST_QUERY", "кофе молотый 250г")
REGION = "Москва"

pytestmark = pytest.mark.live


def _assert_valid_product(p, source: str):
    """Каждый товар обязан иметь: name, price > 0, source_url."""
    assert getattr(p, "name", "").strip(), f"[{source}] пустое название"
    assert getattr(p, "price", 0) > 0, f"[{source}] цена не положительная: {p.price}"
    assert getattr(p, "source_url", "").startswith("http"), (
        f"[{source}] невалидный source_url: {p.source_url}"
    )


@pytest.mark.asyncio
async def test_wildberries_returns_products():
    from marketplace_parsers import search_wildberries
    products = await search_wildberries(QUERY, REGION, limit=8)
    print(f"\n[WB] {len(products)} товаров:")
    for p in products[:3]:
        print(f"   {p.price:>8.0f} ₽  —  {p.name[:60]}")
    assert len(products) >= 3, f"WB вернул < 3 товаров: {len(products)}"
    assert len(products) <= 10, f"WB вернул > 10 товаров: {len(products)}"
    for p in products:
        _assert_valid_product(p, "wildberries")


@pytest.mark.asyncio
async def test_ozon_returns_products():
    from marketplace_parsers import search_ozon
    products = await search_ozon(QUERY, REGION, limit=8)
    print(f"\n[Ozon] {len(products)} товаров:")
    for p in products[:3]:
        print(f"   {p.price:>8.0f} ₽  —  {p.name[:60]}")
    # Ozon чаще блокирует — допускаем 0, но логируем.
    assert len(products) <= 10
    for p in products:
        _assert_valid_product(p, "ozon")
    if len(products) == 0:
        pytest.skip("Ozon заблокировал прямой парсинг — нужен stealth-browser")


@pytest.mark.asyncio
async def test_yandex_market_returns_products():
    from marketplace_parsers import search_yandex_market
    products = await search_yandex_market(QUERY, REGION, limit=8)
    print(f"\n[YM] {len(products)} товаров:")
    for p in products[:3]:
        print(f"   {p.price:>8.0f} ₽  —  {p.name[:60]}")
    assert len(products) <= 10
    for p in products:
        _assert_valid_product(p, "yandex_market")
    if len(products) == 0:
        pytest.skip("YM заблокировал — обычно требует cookies/stealth")


@pytest.mark.asyncio
@pytest.mark.slow
async def test_runet_returns_products():
    """Рунет: DDG → Playwright → JSON-LD/OG/DOM → медиана. Самый медленный (60-90с)."""
    from web_agent import search_runet
    products = await search_runet(QUERY, REGION)
    print(f"\n[Runet] {len(products)} товаров:")
    for p in products[:3]:
        print(f"   {p.price:>8.0f} ₽  —  {p.name[:60]}  ({p.extraction_method})")
    assert len(products) <= 10
    for p in products:
        _assert_valid_product(p, "runet")
    assert len(products) >= 1, "Рунет должен находить хотя бы 1 товар"


@pytest.mark.asyncio
async def test_median_selection_applied():
    """Каждый источник должен возвращать <= 10 товаров (медианный отбор работает)."""
    from marketplace_parsers import search_wildberries
    products = await search_wildberries(QUERY, REGION, limit=8)
    assert len(products) <= 10
    if len(products) >= 4:
        prices = sorted(p.price for p in products)
        spread = prices[-1] / prices[0]
        # После обрезки выбросов разброс цен должен быть умеренным (не x100).
        assert spread < 50, f"подозрительно большой разброс цен: x{spread:.1f}"


if __name__ == "__main__":
    """Ручной запуск: python ml/test_live_sources.py"""
    async def main():
        print(f"=== Live smoke тест 4 источников ===")
        print(f"Запрос: {QUERY!r}, регион: {REGION}\n")

        from marketplace_parsers import search_wildberries, search_ozon, search_yandex_market
        from web_agent import search_runet

        for name, fn in [
            ("WB", lambda: search_wildberries(QUERY, REGION, limit=8)),
            ("Ozon", lambda: search_ozon(QUERY, REGION, limit=8)),
            ("YM", lambda: search_yandex_market(QUERY, REGION, limit=8)),
            ("Runet", lambda: search_runet(QUERY, REGION)),
        ]:
            try:
                products = await fn()
                status = "OK" if products else "ПУСТО"
                print(f"[{status}] {name}: {len(products)} товаров")
                for p in products[:3]:
                    print(f"   {p.price:>8.0f} ₽  —  {p.name[:60]}")
            except Exception as e:
                print(f"[ОШИБКА] {name}: {e}")
            print()

    asyncio.run(main())
