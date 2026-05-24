"""
pytest ml/test_median.py -v

Тесты медианного отбора и проверка контракта 4 источников НМЦК.
"""

import pytest

from marketplace_parsers import MarketProduct, select_median_products


def _make(price: float, idx: int = 0) -> MarketProduct:
    return MarketProduct(
        name=f"Товар {idx}",
        price=price,
        image_url=f"https://example.ru/{idx}.jpg",
        source_url=f"https://example.ru/p/{idx}",
        source="test",
    )


class TestSelectMedian:
    def test_empty_input(self):
        assert select_median_products([], 8) == []

    def test_less_than_count_returns_all(self):
        items = [_make(100, 0), _make(200, 1)]
        assert len(select_median_products(items, 8)) == 2

    def test_drops_outliers(self):
        """Минимум и максимум при 20 элементах должны попасть в обрезку 10%."""
        items = [_make(i + 1, i) for i in range(20)]
        result = select_median_products(items, 8)
        prices = [p.price for p in result]
        assert 1 not in prices, "минимум-выброс должен уйти"
        assert 20 not in prices, "максимум-выброс должен уйти"
        assert len(result) == 8

    def test_returns_around_median(self):
        items = [_make(i + 1, i) for i in range(100)]
        result = select_median_products(items, 10)
        assert len(result) == 10
        avg = sum(p.price for p in result) / len(result)
        assert 40 < avg < 60, f"средняя должна быть около медианы 50, получили {avg}"

    def test_fakes_at_1_rub_filtered(self):
        """2 фейка по 1₽ + 16 нормальных товаров → фейки должны уйти."""
        items = [_make(1, 0), _make(1, 1)] + [_make(5000 + i * 100, i + 2) for i in range(16)]
        result = select_median_products(items, 8)
        assert all(p.price > 100 for p in result), "фейки за 1₽ должны быть отброшены"

    def test_skips_zero_price_items(self):
        items = [_make(0, 0), _make(100, 1), _make(200, 2)]
        result = select_median_products(items, 8)
        assert all(p.price > 0 for p in result)


class TestWildberriesPriceFix:
    """WB API всегда отдаёт цену в копейках — должны делить на 100 безусловно."""

    @pytest.mark.asyncio
    async def test_cheap_product_divided_by_100(self, monkeypatch):
        """Товар за 50₽ = 5000 копеек. Старая логика показала бы 5000₽."""
        from unittest.mock import AsyncMock, MagicMock

        mock_response = MagicMock()
        mock_response.status_code = 200
        mock_response.json = MagicMock(return_value={
            "data": {
                "products": [
                    {"id": 1, "name": "Дешёвый товар",
                     "sizes": [{"price": {"product": 5000}}]},
                    {"id": 2, "name": "Средний товар",
                     "sizes": [{"price": {"product": 50000}}]},
                    {"id": 3, "name": "Дорогой товар",
                     "sizes": [{"price": {"product": 2500000}}]},
                ]
            }
        })

        async def fake_get(url, headers=None):
            return mock_response

        import httpx
        client_mock = AsyncMock()
        client_mock.get = AsyncMock(side_effect=fake_get)
        client_mock.__aenter__.return_value = client_mock
        client_mock.__aexit__.return_value = None
        monkeypatch.setattr(httpx, "AsyncClient", lambda *a, **kw: client_mock)

        from marketplace_parsers import search_wildberries
        results = await search_wildberries("товар", limit=10)
        prices = sorted(p.price for p in results)
        assert prices == [50.0, 500.0, 25000.0], (
            f"ожидаем корректное деление копеек на 100, получили {prices}"
        )
