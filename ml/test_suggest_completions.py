"""
Тест suggest_completions (нужна скачанная Qwen: python ml/download_model.py).

Запуск из корня проекта:
    python -m ml.test_suggest_completions -a
    python -m ml.test_suggest_completions -p прнтер

Только проверка орфографии (без LLM):
    python -m ml.test_suggest_completions --spell-only
"""

from __future__ import annotations

import argparse
import sys
import time
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
if str(ML_DIR) not in sys.path:
    sys.path.insert(0, str(ML_DIR))

PREFIXES = [
    ("клавиатура", 5),
    ("прнтер", 5),
    ("бумгаа", 5),
    ("rfhnhbl;", 5),
    ("ноут", 5),
    ("шина летн", 5),
    ("мышь беспр", 5),
    ("монитор 24", 5),
    ("принтер лазерный а4", 5),
    ("наушники с микрофоном", 5),
    ("вебка", 5),
    ("клава", 5),
    ("системник", 5),
    ("hp laser", 5),
    ("платье белое", 5),
    ("пр", 3),
    ("бу", 3),
    ("мы", 3),
]

SPELL_CASES = (
    ("клавиатура", "клавиатура"),
    ("прнтер", "прнтер"),
    ("вебка", "вебка"),
)


def preflight_spell() -> None:
    from spell_checker import correct, dictionary_paths, ensure_dictionaries

    ensure_dictionaries()
    paths = dictionary_paths()
    print(f"Словари: {paths['main']}")
    if Path(paths["domain"]).is_file():
        print(f"         {paths['domain']}")

    for raw, expected in SPELL_CASES:
        got = correct(raw)
        status = "OK" if got == expected else "FAIL"
        print(f"  [{status}] {raw!r} -> {got!r}")
        if got != expected:
            raise SystemExit(
                f"Spell-check не исправил {raw!r} (получено {got!r}, ожидалось {expected!r}). "
                "Проверьте наличие ml/ru_dict.txt в репозитории."
            )
    print("Орфография: OK\n")


def test_prefix(prefix: str, limit: int) -> bool:
    from query_normalize import normalize_query
    from llm_service import clear_suggest_cache, suggest_completions_list

    clear_suggest_cache()
    normalized = normalize_query(prefix)
    spell_note = f" -> {normalized!r}" if normalized.lower() != prefix.lower() else ""

    print(f"\n{'=' * 60}")
    print(f"PREFIX: '{prefix}'{spell_note} (limit={limit})")
    print(f"{'=' * 60}")

    t0 = time.perf_counter()
    result = suggest_completions_list(prefix, limit)
    elapsed = time.perf_counter() - t0

    if not result:
        print(f"No results (time: {elapsed:.2f} sec)")
        return False

    print(f"Categories: {len(result)}, time: {elapsed:.2f} sec\n")
    for group in result:
        category = group.get("category", "Подсказки")
        print(f"[{category}]:")
        for i, item in enumerate(group.get("items", []), 1):
            print(f"  {i}. {item}")
    return True


def run_all_tests() -> None:
    print("=" * 60)
    print("START TESTING suggest_completions")
    print("=" * 60)

    preflight_spell()

    from llm_service import MODEL_NAME

    print(f"LLM: {MODEL_NAME}")
    print("(первый запрос загружает модель ~1–2 мин, дальше быстрее)\n")

    success = 0
    for prefix, limit in PREFIXES:
        try:
            if test_prefix(prefix, limit):
                success += 1
        except Exception as e:
            print(f"\nError for '{prefix}': {e}")

    print(f"\n{'=' * 60}")
    print(f"RESULTS: {success}/{len(PREFIXES)} prefixes successful")
    print("=" * 60)


def main() -> None:
    parser = argparse.ArgumentParser(description="Тест suggest_completions")
    parser.add_argument("-a", "--all", action="store_true", help="Все префиксы")
    parser.add_argument("-p", "--prefix", help="Один префикс")
    parser.add_argument("-l", "--limit", type=int, default=5)
    parser.add_argument(
        "--spell-only",
        action="store_true",
        help="Только проверка SymSpell, без LLM",
    )
    args = parser.parse_args()

    if args.spell_only:
        preflight_spell()
        return

    if args.all:
        run_all_tests()
    elif args.prefix:
        preflight_spell()
        ok = test_prefix(args.prefix, args.limit)
        raise SystemExit(0 if ok else 1)
    else:
        preflight_spell()
        ok = test_prefix("принтер", args.limit)
        raise SystemExit(0 if ok else 1)


if __name__ == "__main__":
    main()
