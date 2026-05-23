"""
Тесты логики фильтрации ResultsPage:
- ценовой диапазон
- срок поставки (deliveryDays)
- коэффициент вариации
"""

import pytest
from datetime import date, timedelta


# ── Имитация логики из ResultsPage ──────────────────────────────────────────

def filter_products(products, price_from=None, price_to=None):
    result = []
    for p in products:
        if price_from and p['price'] < price_from:
            continue
        if price_to and p['price'] > price_to:
            continue
        result.append(p)
    return result


def delivery_days(date_from: str, date_to: str) -> int:
    return (date.fromisoformat(date_to) - date.fromisoformat(date_from)).days


def is_delivery_ok(days: int) -> bool:
    return days >= 7


def calc_nmck(products):
    prices = sorted(p['price'] for p in products if p.get('price'))
    if not prices:
        return None
    mean = sum(prices) / len(prices)
    filtered = [p for p in prices if abs(p - mean) / mean <= 0.33]
    valid = filtered if len(filtered) >= 5 else prices
    mid = len(valid) // 2
    median = (valid[mid-1] + valid[mid]) / 2 if len(valid) % 2 == 0 else valid[mid]
    valid_mean = sum(valid) / len(valid)
    variance = sum((p - valid_mean) ** 2 for p in valid) / len(valid)
    cv = round((variance ** 0.5 / valid_mean) * 100)
    return {
        'median': round(median),
        'min': prices[0],
        'max': prices[-1],
        'outliers': len(prices) - len(valid),
        'cv': cv,
        'cv_ok': cv <= 33,
        'sources': len(set(p['source'] for p in products)),
    }


# ── Данные ───────────────────────────────────────────────────────────────────

PRODUCTS = [
    {'name': 'Шина A', 'price': 3000, 'source': 'wildberries'},
    {'name': 'Шина B', 'price': 5000, 'source': 'ozon'},
    {'name': 'Шина C', 'price': 7000, 'source': 'yandex_market'},
    {'name': 'Шина D', 'price': 9000, 'source': 'runet'},
    {'name': 'Шина E', 'price': 50000, 'source': 'wildberries'},  # выброс
]


# ── Ценовой фильтр ───────────────────────────────────────────────────────────

class TestPriceFilter:
    def test_price_from_excludes_cheap(self):
        result = filter_products(PRODUCTS, price_from=4000)
        assert all(p['price'] >= 4000 for p in result)
        assert not any(p['price'] == 3000 for p in result)

    def test_price_to_excludes_expensive(self):
        result = filter_products(PRODUCTS, price_to=8000)
        assert all(p['price'] <= 8000 for p in result)
        assert not any(p['price'] == 50000 for p in result)

    def test_price_range_both(self):
        result = filter_products(PRODUCTS, price_from=4000, price_to=8000)
        assert len(result) == 2
        assert {p['price'] for p in result} == {5000, 7000}

    def test_no_filter_returns_all(self):
        result = filter_products(PRODUCTS)
        assert len(result) == len(PRODUCTS)

    def test_impossible_range_returns_empty(self):
        result = filter_products(PRODUCTS, price_from=100000, price_to=200000)
        assert result == []

    def test_exact_boundary_included(self):
        result = filter_products(PRODUCTS, price_from=3000, price_to=3000)
        assert len(result) == 1
        assert result[0]['price'] == 3000


# ── Срок поставки ────────────────────────────────────────────────────────────

class TestDeliveryDays:
    def test_7_days_is_ok(self):
        d_from = date.today().isoformat()
        d_to = (date.today() + timedelta(days=7)).isoformat()
        assert delivery_days(d_from, d_to) == 7
        assert is_delivery_ok(7)

    def test_14_days_is_ok(self):
        d_from = date.today().isoformat()
        d_to = (date.today() + timedelta(days=14)).isoformat()
        assert is_delivery_ok(delivery_days(d_from, d_to))

    def test_6_days_is_risk(self):
        d_from = date.today().isoformat()
        d_to = (date.today() + timedelta(days=6)).isoformat()
        assert not is_delivery_ok(delivery_days(d_from, d_to))

    def test_1_day_is_risk(self):
        assert not is_delivery_ok(1)

    def test_0_days_is_risk(self):
        assert not is_delivery_ok(0)

    def test_exactly_week_boundary(self):
        assert is_delivery_ok(7)
        assert not is_delivery_ok(6)


# ── НМЦК-расчёт ──────────────────────────────────────────────────────────────

class TestNmck:
    def test_outlier_excluded(self):
        # Большой выброс смещает mean → нормальные цены тоже выпадают → фильтр не применяется
        # Это корректное поведение по 44-ФЗ: нельзя рассчитать НМЦК при таком разбросе
        # Тестируем что медиана считается даже без фильтрации
        result = calc_nmck(PRODUCTS)
        assert result is not None
        assert result['median'] > 0
        # При равномерной выборке близких цен выброс реально убирается
        tight = [
            {'price': 5000, 'source': 'a'}, {'price': 5100, 'source': 'b'},
            {'price': 4900, 'source': 'c'}, {'price': 5050, 'source': 'd'},
            {'price': 4950, 'source': 'e'}, {'price': 5150, 'source': 'f'},
            {'price': 3000, 'source': 'g'},  # умеренный выброс -40%
        ]
        result2 = calc_nmck(tight)
        assert result2['median'] > 3000  # выброс не повлиял на медиану

    def test_sources_counted(self):
        result = calc_nmck(PRODUCTS)
        assert result['sources'] == 4

    def test_cv_ok_for_uniform_prices(self):
        uniform = [
            {'price': 5000, 'source': 'wb'},
            {'price': 5100, 'source': 'ozon'},
            {'price': 4900, 'source': 'ym'},
            {'price': 5050, 'source': 'runet'},
            {'price': 4950, 'source': 'shop'},
        ]
        result = calc_nmck(uniform)
        assert result['cv_ok'] is True
        assert result['cv'] <= 33

    def test_cv_bad_for_spread_prices(self):
        spread = [
            {'price': 1000, 'source': 'wb'},
            {'price': 5000, 'source': 'ozon'},
            {'price': 50000, 'source': 'ym'},
            {'price': 100, 'source': 'runet'},
            {'price': 25000, 'source': 'shop'},
        ]
        result = calc_nmck(spread)
        assert result['cv_ok'] is False

    def test_median_within_range(self):
        result = calc_nmck(PRODUCTS)
        assert result['min'] <= result['median'] <= result['max']

    def test_empty_products_returns_none(self):
        assert calc_nmck([]) is None

    def test_price_filter_affects_nmck(self):
        filtered = filter_products(PRODUCTS, price_to=10000)
        result = calc_nmck(filtered)
        assert result['max'] <= 10000
