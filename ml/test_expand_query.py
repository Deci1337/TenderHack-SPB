"""
Прогон expand_query — смотрим, что вернёт Qwen для каждого запроса.

Нужна модель: python ml/download_model.py

Запуск из корня проекта:
    python -m ml.test_expand_query
    python -m ml.test_expand_query -q "прнтер"
    python -m ml.test_expand_query --raw   # + сырой JSON от модели
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

QUERIES = [
    "клавиатура",
    "джинсы",
    "прнтер",
    "бумгаа",
    "rfhnhbl;",
    "ноут",
    "шина летн",
    "мышь беспр",
    "монитор 24",
    "принтер лазерный а4",
    "наушники с микрофоном",
    "вебка",
    "клава",
    "системник",
    "материнка",
    "оперативка",
    "hp laser",
    "canon lbp",
    "пр",
    "бу",
    "мы",
]


def run_one(query: str, *, show_raw: bool = False) -> None:
    from query_normalize import normalize_query
    from llm_service import _PROMPT, _run_chat_completion, expand_query

    normalized = normalize_query(query)
    norm_note = f"  normalize: {query!r} -> {normalized!r}\n" if normalized.lower() != query.lower() else ""

    print(f"\n{'=' * 60}")
    print(f"QUERY: {query!r}")
    if norm_note:
        print(norm_note.rstrip())

    t0 = time.perf_counter()

    if show_raw:
        expand_query.cache_clear()
        from llm_service import _parse_response, is_product_query

        if not normalized or not is_product_query(normalized):
            print("  (пропущено фильтром is_product_query)")
            return

        messages = [{"role": "user", "content": _PROMPT.format(query=normalized)}]
        raw = _run_chat_completion(messages, max_new_tokens=100)
        parsed = _parse_response(raw, normalized)
        elapsed = time.perf_counter() - t0

        print(f"  RAW ({elapsed:.1f}s):\n{raw}\n")
        print(f"  PARSED ({len(parsed)}): {parsed if parsed else '(пусто)'}")
    else:
        expand_query.cache_clear()
        variants = expand_query(query)
        elapsed = time.perf_counter() - t0

        if not variants:
            print(f"  результат: (пусто)  [{elapsed:.1f}s]")
        else:
            print(f"  результат [{elapsed:.1f}s]:")
            for i, v in enumerate(variants, 1):
                print(f"    {i}. {v}")


def run_all(*, show_raw: bool = False) -> None:
    from llm_service import MODEL_NAME

    print("=" * 60)
    print("EXPAND_QUERY — прогон по списку")
    print(f"Модель: {MODEL_NAME}")
    print(f"Запросов: {len(QUERIES)}")
    print("=" * 60)

    for q in QUERIES:
        try:
            run_one(q, show_raw=show_raw)
        except Exception as e:
            print(f"\n  ERROR: {e}")

    print(f"\n{'=' * 60}")
    print("Готово")
    print("=" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description="Тест expand_query")
    parser.add_argument("-q", "--query", help="Один запрос")
    parser.add_argument("--raw", action="store_true", help="Показать сырой ответ LLM")
    args = parser.parse_args()

    if args.query:
        run_one(args.query, show_raw=args.raw)
    else:
        run_all(show_raw=args.raw)


if __name__ == "__main__":
    main()
