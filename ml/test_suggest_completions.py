# test_suggest_completions.py
"""
Тестирование автодополнения запросов (suggest_completions).
Запуск: python test_suggest_completions.py
"""

import sys
from pathlib import Path

# Добавляем путь к модулю ml
sys.path.insert(0, str(Path(__file__).parent))

from ml.llm_service import suggest_completions_list

# ---------------------------------------------------------------------------
# Тестовые префиксы
# ---------------------------------------------------------------------------

PREFIXES = [
    # Короткие
    ("принтер", 5),
    ("бумага", 5),
    ("картридж", 5),
    ("ноутбук", 5),
    ("клавиатура", 5),
    
    # С опечатками
    ("прнтер", 5),
    ("бумгаа", 5),
    ("rfhnhbl;", 5),
    ("ноут", 5),
    
    # Разные категории
    ("шина летн", 5),
    ("мышь беспр", 5),
    ("монитор 24", 5),
    ("стол оф", 5),
    ("кресло комп", 5),
    
    # Детальные
    ("принтер лазерный а4", 5),
    ("бумага а4 80", 5),
    ("наушники с микрофоном", 5),
    
    # Сложные случаи
    ("вебка", 5),
    ("клава", 5),
    ("системник", 5),
    ("материнка", 5),
    ("оперативка", 5),
    
    # Смешанные
    ("hp laser", 5),
    ("canon lbp", 5),
    
    # Короткие (граничные)
    ("пр", 3),
    ("бу", 3),
    ("мы", 3),
]

def test_prefix(prefix: str, limit: int):
    """Тестирует один префикс."""
    print(f"ПРЕФИКС: '{prefix}'")
    
    result = suggest_completions_list(prefix, limit)
    
    if not result:
        print("Нет результатов")
        return
        
    for group in result:
        category = group.get("category", "Без категории")
        items = group.get("items", [])
        print(f"{category}:")
        for i, item in enumerate(items, 1):
            print(f"   {i}. {item}")
        print()


def run_all_tests():
    """Запускает все тесты."""
    print("\n" + "=" * 60)
    print("ТЕСТИРОВАНИЕ SUGGEST_COMPLETIONS")
    print("=" * 60)
    
    total = len(PREFIXES)
    success = 0
    
    for prefix, limit in PREFIXES:
        try:
            result = suggest_completions_list(prefix, limit)
            if result:
                success += 1
            test_prefix(prefix, limit)
        except Exception as e:
            print(f"\nОшибка для префикса '{prefix}': {e}")
    
    print(f"РЕЗУЛЬТАТЫ: {success}/{total} префиксов успешно")


def test_single():
    """Тестирует один префикс (для быстрой проверки)."""
    prefix = sys.argv[1] if len(sys.argv) > 1 else "принтер"
    limit = int(sys.argv[2]) if len(sys.argv) > 2 else 5
    
    test_prefix(prefix, limit)


# ---------------------------------------------------------------------------
# Детальный тест с выводом сырого ответа (для отладки)
# ---------------------------------------------------------------------------

def test_with_debug(prefix: str, limit: int = 5):
    """Тест с выводом сырого ответа от LLM."""
    from ml.llm_service import _SUGGEST_PROMPT, _run_chat_completion, _extract_json_object, _SUGGEST_CATEGORIES
    
    print(f"\n{'=' * 60}")
    print(f"ДЕТАЛЬНЫЙ ТЕСТ: '{prefix}'")
    print(f"{'=' * 60}")
    
    # Очищаем префикс
    from ml.llm_service import clean_query, is_product_query
    cleaned = clean_query(prefix)
    query_for_llm = cleaned if cleaned else prefix
    
    print(f"\n📝 Исходный префикс: {prefix}")
    print(f"🧹 Очищенный: {query_for_llm}")
    print(f"✅ is_product_query: {is_product_query(prefix)}")
    
    # Отправляем в LLM
    prompt = _SUGGEST_PROMPT.format(prefix=query_for_llm, limit=limit)
    messages = [{"role": "user", "content": prompt}]
    
    print(f"\n🤖 Отправляем запрос в LLM...")
    start = time.time()
    response = _run_chat_completion(messages, max_new_tokens=350)
    elapsed = time.time() - start
    
    print(f"\n📤 СЫРОЙ ОТВЕТ LLM ({elapsed:.2f} сек):")
    print(f"{'─' * 40}")
    print(response)
    print(f"{'─' * 40}")
    
    # Парсим
    data = _extract_json_object(response)
    if data:
        print(f"\n✅ Распарсенный JSON:")
        print(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        print(f"\n❌ Не удалось распарсить JSON")
    
    # Проверяем категории
    completions = data.get("completions", []) if data else []
    categories_used = set()
    for c in completions:
        cat = c.get("category", "")
        categories_used.add(cat)
    
    print(f"\n📁 Использованные категории: {categories_used}")
    print(f"📁 Доступные категории: {_SUGGEST_CATEGORIES}")
    unknown = categories_used - set(_SUGGEST_CATEGORIES)
    if unknown:
        print(f"⚠️ Неизвестные категории: {unknown}")


# ---------------------------------------------------------------------------
# Интерактивный тест
# ---------------------------------------------------------------------------

def interactive():
    """Интерактивный режим: вводишь префикс, получаешь подсказки."""
    print("\n" + "=" * 60)
    print("💬 ИНТЕРАКТИВНЫЙ РЕЖИМ")
    print("=" * 60)
    print("Вводите префиксы для автодополнения (или 'exit' для выхода)")
    
    while True:
        try:
            prefix = input("\n🔍 Введите префикс: ").strip()
            if prefix.lower() in ("exit", "quit", "q"):
                break
            if not prefix:
                continue
            
            result = suggest_completions_list(prefix, 5)
            
            if not result:
                print("  ❌ Нет подсказок")
            else:
                for group in result:
                    category = group.get("category", "Подсказки")
                    items = group.get("items", [])
                    print(f"\n  📁 {category}:")
                    for i, item in enumerate(items, 1):
                        print(f"     {i}. {item}")
                    
        except KeyboardInterrupt:
            break


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Тестирование suggest_completions")
    parser.add_argument("-p", "--prefix", help="Один префикс для теста")
    parser.add_argument("-l", "--limit", type=int, default=5, help="Количество подсказок")
    parser.add_argument("-d", "--debug", action="store_true", help="Детальный вывод с сырым ответом")
    parser.add_argument("-i", "--interactive", action="store_true", help="Интерактивный режим")
    parser.add_argument("-a", "--all", action="store_true", help="Запустить все тесты")
    
    args = parser.parse_args()
    
    if args.interactive:
        interactive()
    elif args.all:
        run_all_tests()
    elif args.prefix:
        if args.debug:
            test_with_debug(args.prefix, args.limit)
        else:
            test_prefix(args.prefix, args.limit)
    else:
        # По умолчанию тестируем один префикс
        test_prefix("принтер", 5)