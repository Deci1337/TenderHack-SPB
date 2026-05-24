"""pytest ml/test_spell_checker.py — без LLM/torch."""

from spell_checker import correct


def test_known_word_unchanged():
    assert correct("клавиатура") == "клавиатура"


def test_unknown_typo_unchanged():
    """Не в словаре — не трогаем, Qwen исправит."""
    assert correct("прнтер") == "прнтер"
    assert correct("бумгаа") == "бумгаа"


def test_slang_unchanged():
    assert correct("вебка") == "вебка"
    assert correct("клава") == "клава"
    assert correct("системник") == "системник"
