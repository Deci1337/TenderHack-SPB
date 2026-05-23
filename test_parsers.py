"""
Тест всех 4 парсеров с детальными логами.
Запуск: python test_parsers.py
Или с кастомным запросом: QUERY="ноутбук lenovo" python test_parsers.py
"""

import asyncio
import os
import sys
import time
import logging
import traceback

# Добавляем ml/ в PYTHONPATH
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "ml"))

logging.basicConfig(
    level=logging.DEBUG,
    format="%(asctime)s %(levelname)-7s %(name)s: %(message)s",
    datefmt="%H:%M:%S",
)
# Только наши логи на DEBUG, httpx/playwright — INFO
logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("httpcore").setLevel(logging.WARNING)
logging.getLogger("playwright").setLevel(logging.INFO)

QUERY = os.getenv("QUERY", "кресло офисное")
REGION = os.getenv("REGION", "Москва")
LIMIT = int(os.getenv("LIMIT", "8"))

SEP = "─" * 70


def print_products(products, source: str):
    if not products:
        print(f"  [!] {source}: 0 товаров — ПУСТО")
        return
    print(f"  [{source}] {len(products)} товаров:")
    for i, p in enumerate(products, 1):
        name = getattr(p, "name", getattr(p, "title", "???"))[:65]
        price = getattr(p, "price", 0)
        url = getattr(p, "source_url", getattr(p, "product_url", ""))[:80]
        img = getattr(p, "image_url", "")
        img_status = "img✓" if img and img.startswith("http") else "img✗"
        print(f"  {i:2}. {price:>8.0f} ₽  {img_status}  {name}")
        if url:
            print(f"      {url}")


async def test_wb():
    print(f"\n{SEP}")
    print("WILDBERRIES (Python API)")
    print(SEP)
    t0 = time.time()
    try:
        from marketplace_parsers import search_wildberries
        products = await search_wildberries(QUERY, REGION, limit=LIMIT)
        elapsed = time.time() - t0
        print(f"  Время: {elapsed:.1f}s")
        print_products(products, "WB")
        return len(products)
    except Exception:
        elapsed = time.time() - t0
        print(f"  [ОШИБКА] за {elapsed:.1f}s:")
        traceback.print_exc()
        return 0


async def test_ozon():
    print(f"\n{SEP}")
    print("OZON (Python API)")
    print(SEP)
    t0 = time.time()
    try:
        from marketplace_parsers import search_ozon
        products = await search_ozon(QUERY, REGION, limit=LIMIT)
        elapsed = time.time() - t0
        print(f"  Время: {elapsed:.1f}s")
        print_products(products, "Ozon")
        return len(products)
    except Exception:
        elapsed = time.time() - t0
        print(f"  [ОШИБКА] за {elapsed:.1f}s:")
        traceback.print_exc()
        return 0


async def test_ym():
    print(f"\n{SEP}")
    print("ЯНДЕКС.МАРКЕТ (Python API)")
    print(SEP)
    t0 = time.time()
    try:
        from marketplace_parsers import search_yandex_market
        products = await search_yandex_market(QUERY, REGION, limit=LIMIT)
        elapsed = time.time() - t0
        print(f"  Время: {elapsed:.1f}s")
        print_products(products, "YM")
        return len(products)
    except Exception:
        elapsed = time.time() - t0
        print(f"  [ОШИБКА] за {elapsed:.1f}s:")
        traceback.print_exc()
        return 0


async def test_runet():
    print(f"\n{SEP}")
    print("РУНЕТ (DDG + Playwright)")
    print(SEP)
    t0 = time.time()
    try:
        from web_agent import search_runet
        products = await search_runet(QUERY, REGION)
        elapsed = time.time() - t0
        print(f"  Время: {elapsed:.1f}s")
        print_products(products, "Runet")
        return len(products)
    except Exception:
        elapsed = time.time() - t0
        print(f"  [ОШИБКА] за {elapsed:.1f}s:")
        traceback.print_exc()
        return 0


async def test_node_server(source: str):
    """Проверяет Node parser-server на :8008"""
    import urllib.request
    import urllib.parse
    import json as jsonlib
    params = urllib.parse.urlencode({"source": source, "q": QUERY, "region": REGION, "limit": LIMIT})
    url = f"http://localhost:8008/search?{params}"
    t0 = time.time()
    try:
        with urllib.request.urlopen(url, timeout=60) as r:
            data = jsonlib.loads(r.read())
        elapsed = time.time() - t0
        products = data.get("products", [])
        live = data.get("liveHit", False)
        err = data.get("error", "")
        print(f"  liveHit={live}  время={elapsed:.1f}s  ошибка={err!r}")
        if products:
            print(f"  {len(products)} товаров:")
            for i, p in enumerate(products, 1):
                name = (p.get("name") or "")[:65]
                price = p.get("price", 0)
                img = p.get("image_url", "")
                img_status = "img✓" if img and img.startswith("http") else "img✗"
                src_url = (p.get("source_url") or "")[:80]
                print(f"  {i:2}. {price:>8.0f} ₽  {img_status}  {name}")
                if src_url:
                    print(f"      {src_url}")
        else:
            print(f"  [!] 0 товаров — ПУСТО")
        return len(products)
    except Exception as e:
        elapsed = time.time() - t0
        print(f"  [ОШИБКА] за {elapsed:.1f}s: {e}")
        return -1


async def main():
    print(f"\n{'═' * 70}")
    print(f"  ТЕСТ ПАРСЕРОВ — запрос: {QUERY!r}, регион: {REGION}")
    print(f"{'═' * 70}")

    # --- Python-парсеры (прямые) ---
    print("\n>>> PYTHON-ПАРСЕРЫ (прямой вызов функций из ml/)")

    wb_cnt, ozon_cnt, ym_cnt, runet_cnt = await asyncio.gather(
        test_wb(),
        test_ozon(),
        test_ym(),
        test_runet(),
        return_exceptions=False,
    )

    # --- Node parser-server (если запущен) ---
    print(f"\n{SEP}")
    print("NODE PARSER-SERVER :8008 (требует запущенного node server.js)")
    for src in ["wildberries", "ozon", "yandex_market"]:
        print(f"\n  --- {src} ---")
        await test_node_server(src)

    # --- Итог ---
    print(f"\n{'═' * 70}")
    print("  ИТОГ:")
    for name, cnt in [("WB", wb_cnt), ("Ozon", ozon_cnt), ("YM", ym_cnt), ("Runet", runet_cnt)]:
        status = "OK" if cnt >= 3 else ("МАЛО" if cnt > 0 else "ПУСТО")
        print(f"  {status:6}  {name}: {cnt} товаров")
    print(f"{'═' * 70}\n")


if __name__ == "__main__":
    asyncio.run(main())
