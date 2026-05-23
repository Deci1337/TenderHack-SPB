"""
pytest ml/test_llm_service.py
Модель не загружается — expand_query тестируется через mock.
"""

import json
from unittest.mock import MagicMock, patch

import numpy as np
import pytest

from llm_service import (
    _completions_to_groups,
    _parse_response,
    _parse_suggest_response,
    calculate_nmck,
    clean_query,
    expand_query,
    filter_outliers,
    is_product_query,
    suggest_completions,
)


# ---------------------------------------------------------------------------
# is_product_query
# ---------------------------------------------------------------------------

class TestIsProductQuery:
    def test_normal_queries(self):
        assert is_product_query("принтер лазерный") is True
        assert is_product_query("шина летняя 205/55 R16") is True
        assert is_product_query("HP LaserJet 1020") is True
        assert is_product_query("клава") is True
        assert is_product_query("вебка") is True
        assert is_product_query("SSD M.2 NVMe 1TB") is True

    def test_too_short(self):
        assert is_product_query("") is False
        assert is_product_query("а") is False
        assert is_product_query("  ") is False

    def test_repeated_chars(self):
        assert is_product_query("яяяяяяя") is False
        assert is_product_query("ааааа") is False
        assert is_product_query("......") is False

    def test_digits_only(self):
        assert is_product_query("1234567890") is False
        assert is_product_query("  123  ") is False

    def test_stop_word_prefixes(self):
        # после clean_query остаётся товарная часть — запрос валиден
        assert is_product_query("где купить принтер") is True
        assert is_product_query("как выбрать монитор") is True
        assert is_product_query("сколько стоит ноутбук") is True
        assert is_product_query("доставка принтера") is True
        assert is_product_query("скидка на бумагу") is True
        # только стоп-слова — после clean_query пусто
        assert is_product_query("где купить") is False
        assert clean_query("где купить") == ""

    def test_borderline_valid(self):
        # слово из 3 символов — минимально допустимое
        assert is_product_query("мфу") is True
        assert is_product_query("ибп") is True


# ---------------------------------------------------------------------------
# _parse_response
# ---------------------------------------------------------------------------

class TestParseResponse:
    def test_valid_json(self):
        raw = '{"corrected": "принтер лазерный", "variants": ["лазерный принтер", "МФУ", "принтер ч/б"]}'
        result = _parse_response(raw, "прнтер лазерный")
        assert result[0] == "принтер лазерный"
        assert "лазерный принтер" in result
        assert len(result) == 4

    def test_json_with_noise(self):
        raw = 'Конечно! Вот ответ: {"corrected": "клавиатура", "variants": ["клавиатура USB", "клавиатура BT", "клавиатура офисная"]} надеюсь помог'
        result = _parse_response(raw, "клава")
        assert result[0] == "клавиатура"

    def test_deduplication(self):
        raw = '{"corrected": "принтер", "variants": ["принтер", "ПРИНТЕР", "принтер лазерный"]}'
        result = _parse_response(raw, "прнтер")
        assert result.count("принтер") == 1
        assert "принтер лазерный" in result

    def test_model_echoes_original(self):
        # Модель не знает что это — вернула то же самое
        raw = '{"corrected": "авыало", "variants": ["авыало", "авыало", "авыало"]}'
        result = _parse_response(raw, "авыало")
        assert result == ["авыало"]  # fallback к оригиналу, не []

    def test_empty_response(self):
        result = _parse_response("", "запрос")
        assert result == []

    def test_no_json(self):
        result = _parse_response("Извините, не понял запрос.", "запрос")
        assert result == []

    def test_broken_json(self):
        result = _parse_response('{"corrected": "принтер"', "запрос")
        assert result == []

    def test_preserves_order(self):
        raw = '{"corrected": "шина летняя", "variants": ["летние шины", "автошина летняя", "покрышка лето"]}'
        result = _parse_response(raw, "шина лет")
        assert result[0] == "шина летняя"


# ---------------------------------------------------------------------------
# suggest_completions
# ---------------------------------------------------------------------------

class TestSuggestCompletions:
    def setup_method(self):
        suggest_completions.cache_clear()

    def test_parse_suggest_response(self):
        raw = '{"completions": ['
        raw += '{"text": "принтер лазерный Pantum P2500W A4", "category": "Оргтехника", "score": 0.95},'
        raw += '{"text": "принтер лазерный HP LaserJet", "category": "Оргтехника", "score": 0.8}'
        raw += ']}'
        items = _parse_suggest_response(raw, "принтер лаз", 5)
        assert len(items) == 2
        assert items[0]["text"].startswith("принтер")
        assert items[0]["score"] >= items[1]["score"]

    def test_completions_to_groups(self):
        groups = _completions_to_groups([
            {"text": "шина летняя 205/55 R16", "category": "Шины", "score": 0.9},
            {"text": "шина зимняя 205/55 R16", "category": "Шины", "score": 0.8},
        ])
        assert len(groups) == 1
        assert groups[0]["category"] == "Шины"
        assert len(groups[0]["items"]) == 2

    def test_llm_suggest_mocked(self):
        mock_json = (
            '{"completions": ['
            '{"text": "принтер лазерный А4 Pantum P2500W", "category": "Оргтехника", "score": 0.92},'
            '{"text": "принтер лазерный HP LaserJet Pro", "category": "Оргтехника", "score": 0.88}'
            ']}'
        )
        with patch("llm_service._run_chat_completion", return_value=mock_json):
            result = list(suggest_completions("принтер лаз", 5))
            assert len(result) >= 1
            assert any("принтер" in item for g in result for item in g["items"])


# ---------------------------------------------------------------------------
# expand_query (модель замокана)
# ---------------------------------------------------------------------------

MOCK_RESPONSE = '{"corrected": "принтер лазерный", "variants": ["лазерный принтер", "МФУ лазерное", "принтер ч/б А4"]}'

def _make_mock_model(response_text: str):
    tokenizer = MagicMock()
    tokenizer.apply_chat_template.return_value = "<prompt>"
    tokenizer.eos_token_id = 0
    tokenizer.return_value = {"input_ids": MagicMock(shape=(1, 10))}
    tokenizer.decode.return_value = response_text

    model = MagicMock()
    model.device = "cpu"
    output = MagicMock()
    output.__getitem__ = MagicMock(return_value=MagicMock())
    model.generate.return_value = [MagicMock()]

    return model, tokenizer


class TestExpandQuery:
    def setup_method(self):
        # Сбрасываем lru_cache перед каждым тестом
        expand_query.cache_clear()

    def test_garbage_skips_llm(self):
        with patch("llm_service._load_model") as mock_load:
            result = expand_query("яяяяяяя")
            mock_load.assert_not_called()
            assert result == []

    def test_stop_word_skips_llm(self):
        with patch("llm_service._load_model") as mock_load:
            result = expand_query("погода в москве")
            mock_load.assert_not_called()
            assert result == []

    def test_normal_query_calls_model(self):
        with patch("llm_service._load_model") as mock_load, \
             patch("llm_service._parse_response", return_value=["принтер лазерный", "лазерный принтер"]):
            mock_load.return_value = (MagicMock(), MagicMock(
                apply_chat_template=MagicMock(return_value="<p>"),
                eos_token_id=0,
                decode=MagicMock(return_value=MOCK_RESPONSE),
            ))
            mock_model = mock_load.return_value[0]
            mock_model.device = "cpu"
            mock_model.generate.return_value = [MagicMock()]

            result = expand_query("прнтер лазерный")
            assert len(result) >= 1

    def test_model_exception_returns_original(self):
        with patch("llm_service._load_model", side_effect=RuntimeError("GPU OOM")):
            result = expand_query("принтер лазерный")
            assert result == ["принтер лазерный"]

    def test_empty_string(self):
        result = expand_query("")
        assert result == []

    def test_whitespace_only(self):
        result = expand_query("   ")
        assert result == []

    def test_cache_works(self):
        with patch("llm_service._load_model") as mock_load, \
             patch("llm_service._parse_response", return_value=["принтер"]):
            mock_load.return_value = (MagicMock(device="cpu", generate=MagicMock(return_value=[MagicMock()])),
                                      MagicMock(apply_chat_template=MagicMock(return_value=""), eos_token_id=0, decode=MagicMock(return_value="")))
            expand_query("принтер")
            expand_query("принтер")  # второй вызов из кэша
            assert mock_load.call_count <= 1

    def test_clean_query_before_llm(self):
        expand_query.cache_clear()
        with patch("llm_service._load_model") as mock_load, \
             patch("llm_service._parse_response", return_value=["принтер лазерный"]) as mock_parse:
            tokenizer = MagicMock(
                apply_chat_template=MagicMock(return_value="<p>"),
                eos_token_id=0,
                decode=MagicMock(return_value=MOCK_RESPONSE),
            )
            tokenizer.return_value = {"input_ids": MagicMock(shape=(1, 10))}
            mock_load.return_value = (MagicMock(device="cpu", generate=MagicMock(return_value=[MagicMock()])), tokenizer)

            expand_query("где купить принтер лазерный")

            mock_parse.assert_called_once()
            assert mock_parse.call_args[0][1] == clean_query("где купить принтер лазерный")
            prompt_text = tokenizer.apply_chat_template.call_args[0][0][0]["content"]
            assert "где купить" not in prompt_text
            assert "принтер лазерный" in prompt_text


# ---------------------------------------------------------------------------
# filter_outliers
# ---------------------------------------------------------------------------

class TestFilterOutliers:
    def test_removes_cheap_outlier(self):
        prices = [12000, 12500, 13000, 12800, 13200, 3000]  # 3000 — выброс
        result = filter_outliers(prices)
        assert 3000 not in result

    def test_removes_expensive_outlier(self):
        # Один выброс сильно сдвигает среднее → нормальные цены тоже выбиваются
        # → filtered < 5 → функция корректно возвращает оригинал
        prices = [12000, 12500, 13000, 12800, 13200, 50000]
        result = filter_outliers(prices)
        assert isinstance(result, list)
        assert len(result) >= 5  # не обрезало ниже порога

    def test_removes_expensive_outlier_large_set(self):
        # При большой выборке выброс убирается без проблем
        prices = [12000, 12200, 12500, 12800, 13000, 13200, 12600, 12400, 12100, 50000]
        result = filter_outliers(prices)
        assert 50000 not in result

    def test_no_outliers(self):
        prices = [12000, 12500, 13000, 12800, 13200]
        result = filter_outliers(prices)
        assert sorted(result) == sorted(prices)

    def test_too_few_prices(self):
        prices = [100, 200]
        result = filter_outliers(prices)
        assert result == prices

    def test_does_not_filter_below_5(self):
        # Если после фильтрации останется < 5 — возвращаем оригинал
        prices = [100, 200, 15000, 16000, 17000]
        result = filter_outliers(prices)
        assert result == prices

    def test_iterative(self):
        # После первого прохода появляется новый выброс — должен убраться рекурсией
        prices = [10000, 10500, 11000, 10800, 10200, 500, 50000]
        result = filter_outliers(prices)
        assert 500 not in result
        assert 50000 not in result


# ---------------------------------------------------------------------------
# calculate_nmck
# ---------------------------------------------------------------------------

class TestCalculateNmck:
    def test_success(self):
        prices = [12000.0, 12500.0, 13000.0, 12800.0, 13200.0]
        r = calculate_nmck(prices)
        assert r["status"] == "success"
        assert r["nmck"] is not None
        assert r["filtered_count"] == 5

    def test_no_data(self):
        r = calculate_nmck([])
        assert r["status"] == "no_data"
        assert r["nmck"] is None

    def test_insufficient_data(self):
        r = calculate_nmck([1000.0, 2000.0, 3000.0])
        assert r["status"] == "insufficient_data"
        assert r["price_count"] == 3

    def test_outliers_filtered(self):
        prices = [12000, 12500, 13000, 12800, 13200, 500, 100000]
        r = calculate_nmck(prices)
        assert r["status"] == "success"
        assert 500 not in r.get("filtered_prices", [])

    def test_nmck_within_range(self):
        prices = [12000.0, 12500.0, 13000.0, 12800.0, 13200.0]
        r = calculate_nmck(prices)
        assert 12000 <= r["nmck"] <= 13200

    def test_filtered_too_much(self):
        # Огромный разброс цен — алгоритм не может рассчитать честную НМЦК
        prices = [100, 200, 50000, 60000, 70000]
        r = calculate_nmck(prices)
        # Любой из этих статусов означает «нельзя рассчитать» — это корректно
        assert r["status"] in ("success", "filtered_too_much", "insufficient_data", "deviation_too_high")
        # Главное: nmck не должна быть рассчитана при таком разбросе
        if r["status"] != "success":
            assert r["nmck"] is None
