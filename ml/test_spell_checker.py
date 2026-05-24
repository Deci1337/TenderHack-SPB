"""pytest ml/test_spell_checker.py — без LLM/torch."""

from spell_checker import correct


def test_known_word_unchanged():
    assert correct("клавиатура") == "клавиатура"
    assert correct("принтер лазерный") == "принтер лазерный"


def test_domain_typo_fixed():
    assert correct("прнтер") == "принтер"
    assert correct("бумгаа") == "бумага"
    assert correct("принтер лазерны") == "принтер лазерный"


def test_slang_unchanged():
    """Сленга нет в domain-словаре — не трогаем, Qwen исправит."""
    assert correct("вебка") == "вебка"
    assert correct("клава") == "клава"


def test_short_words_unchanged():
    assert correct("мфу а4") == "мфу а4"
