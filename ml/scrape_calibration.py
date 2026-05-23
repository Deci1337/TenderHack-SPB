"""
Запусти: python scrape_calibration.py
Покажет сколько товаров нужно парсить чтобы гарантированно получить 5 валидных.
"""

import asyncio
import statistics

# Замени на реальный парсер когда будет готов
# from parsers.wb import WBParser
# from parsers.ozon import OzonParser

TEST_QUERIES = [
    "шина летняя 205/55 R16",
    "принтер лазерный А4",
    "куртка мужская зимняя",
    "монитор 24 дюйма",
    "клавиатура беспроводная",
]

SCRAPE_AMOUNTS = [10, 15, 20, 30]  # перебираем разные лимиты


def is_valid(product: dict) -> bool:
    """Товар валиден если все обязательные поля есть."""
    return bool(
        product.get("price")
        and product.get("image_url")
        and product.get("name")
        and product.get("source_url")
    )


async def calibrate_parser(parser, parser_name: str):
    print(f"\n{'='*50}")
    print(f"Источник: {parser_name}")
    print(f"{'='*50}")

    results = []

    for query in TEST_QUERIES:
        print(f"\nЗапрос: '{query}'")

        for limit in SCRAPE_AMOUNTS:
            raw = await parser.search(query, limit=limit)
            valid = [p for p in raw if is_valid(p)]
            loss_pct = round((1 - len(valid) / max(len(raw), 1)) * 100)

            print(f"  Спаршено {limit:2d} → валидных {len(valid):2d} "
                  f"(потери {loss_pct}%)")

            results.append({
                "query": query,
                "scraped": limit,
                "valid": len(valid),
                "loss_pct": loss_pct,
            })

    # Итоговая статистика
    print(f"\n--- Итог для {parser_name} ---")

    for limit in SCRAPE_AMOUNTS:
        subset = [r for r in results if r["scraped"] == limit]
        valid_counts = [r["valid"] for r in subset]
        avg_loss = statistics.mean(r["loss_pct"] for r in subset)
        min_valid = min(valid_counts)

        print(f"Лимит {limit:2d}: "
              f"минимум валидных = {min_valid}, "
              f"средние потери = {avg_loss:.0f}%")

        if min_valid >= 5:
            print(f"  ✓ При лимите {limit} гарантированно получаем 5+ для НМЦК")
            break
    else:
        print("  ✗ Даже при максимальном лимите не всегда набирается 5 — проверь парсер")


async def main():
    # Раскомментируй нужный парсер:
    # await calibrate_parser(WBParser(), "Wildberries")
    # await calibrate_parser(OzonParser(), "Ozon")
    print("Подключи реальный парсер и раскомментируй строки выше")


if __name__ == "__main__":
    asyncio.run(main())
