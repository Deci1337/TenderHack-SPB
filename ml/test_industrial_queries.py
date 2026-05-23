"""
Прогон 19 промышленных запросов через пайплайн.
Проверяем: пре-фильтр пропускает, формула скоринга находит магазины,
отсеивает форумы и маркетплейсы.
"""

import pytest

from llm_service import is_product_query
from web_agent import score_url


INDUSTRIAL_QUERIES = [
    "Клапан обратный пружинный муфтовый Ду50 Ру16 PN16 стальной",
    "Модуль входной IP CCTV BNC 4 канала компрессионный H.265",
    "Сенсорный экран HMI 7 дюймов Mitsubishi GT2307-VTBA",
    "Фильтр масляный гидравлический W920 Mann-Filter промышленный",
    "Реле давления воды PS-3/20 1-5 бар с манометром итальянский",
    "Кабель сверхгибкий роботизированный 5G1.5mm² PUR 100м",
    "Датчик приближения индуктивный M12 PNP NO 4mm круглый металлический",
    "Сопло пескоструйное боросиликатное Ду8 латунное с быстрым соединением",
    "Термопара Type-K миниатюрная с мини-разъемом 1м силиконовая гибкая",
    "Блок питания 24В 5А DIN-рейка с PFC и защитой от перегрузки Mean Well IRS-120-24",
    "Подшипник роликовый конический 32008X/T 40x68x19мм SKF",
    "Светодиодная лента COB 24В 144лм/м 960лм/м CRI>90 3м без лампы",
    "Насос дозированный перистальтический 0.5-5мл/мин с головной ролью Watson-Marlow 520S",
    "Муфта компенсирующая резиновая КМД Ду100 Ру16 с фланцами ГОСТ",
    "Плита прижимная пневматическая 150x100x25мм с вакуумным патрубком Festo",
    "Анализатор качества электроэнергии Fluke 435-II Series 3 фазы 0.5 класс",
    "Шланг арматурный гибкий ПНД Ду32 SDR11 100м черный PE100",
    "Изолятор опорный фарфоровый ПО-6кВ-400/3 наружной установки",
    "Уплотнение кольцевое O-ring NBR 70 Shore A 15.5x2.0мм ГОСТ 9833-73",
]


# ============================================================================
# Тест 1: все запросы должны пройти пре-фильтр LLM (is_product_query)
# ============================================================================

@pytest.mark.parametrize("query", INDUSTRIAL_QUERIES)
def test_industrial_queries_pass_prefilter(query):
    """
    Промышленные запросы — это товарные запросы, должны пройти пре-фильтр
    и попасть в LLM для расширения.
    """
    assert is_product_query(query), f"Запрос не прошёл пре-фильтр: {query}"


# ============================================================================
# Тест 2: формула скоринга должна давать высокий скор для промышленных
# поставщиков (характерные домены и пути)
# ============================================================================

# Типичные URL промышленных интернет-магазинов которые могут найтись в DDG
EXPECTED_GOOD_URLS_PER_QUERY = {
    "Клапан обратный пружинный муфтовый": [
        ("https://armatura-shop.ru/product/klapan-obratnyj-du50",
         "Купить клапан обратный Ду50 Ру16 цена доставка"),
        ("https://promtorgshop.ru/catalog/klapany/123",
         "Клапан обратный пружинный стальной купить"),
    ],
    "Модуль входной IP CCTV BNC": [
        ("https://video-store.ru/product/ip-modul-bnc-4ch",
         "Купить IP модуль BNC 4 канала цена ₽"),
    ],
    "Сенсорный экран HMI Mitsubishi": [
        ("https://industrial-shop.ru/product/gt2307-vtba",
         "Mitsubishi GT2307-VTBA HMI 7 дюймов купить"),
    ],
    "Подшипник SKF": [
        ("https://podshipnik-shop.ru/product/32008x-skf",
         "Подшипник конический 32008X SKF цена доставка"),
    ],
    "Блок питания Mean Well": [
        ("https://meanwell-store.ru/product/irs-120-24",
         "Mean Well IRS-120-24 купить цена ₽"),
    ],
    "Анализатор Fluke": [
        ("https://measure-shop.ru/product/fluke-435-ii",
         "Fluke 435-II анализатор купить цена доставка"),
    ],
}


@pytest.mark.parametrize("good_url,snippet", [
    (url, snip)
    for urls in EXPECTED_GOOD_URLS_PER_QUERY.values()
    for url, snip in urls
])
def test_industrial_shop_urls_get_positive_score(good_url, snippet):
    """Промышленные магазины с правильными URL и сниппетами должны набирать score > 5"""
    score = score_url(good_url, snippet)
    assert score > 5, f"Магазин получил низкий скор {score}: {good_url}"


# ============================================================================
# Тест 3: маркетплейсы для этих же запросов должны отсеиваться
# ============================================================================

MARKETPLACE_URLS_FOR_INDUSTRIAL = [
    ("https://www.wildberries.ru/catalog/podshipnik-skf-32008", "купить SKF подшипник"),
    ("https://ozon.ru/product/blok-pitaniya-mean-well", "Mean Well купить ₽"),
    ("https://market.yandex.ru/product/fluke-435", "Fluke 435 цена"),
]


@pytest.mark.parametrize("url,snippet", MARKETPLACE_URLS_FOR_INDUSTRIAL)
def test_marketplaces_filtered_for_industrial(url, snippet):
    """Промышленные товары на маркетплейсах должны отсеиваться (они уже спарсены другими источниками)"""
    score = score_url(url, snippet)
    assert score < 0, f"Маркетплейс получил положительный скор: {url}"


# ============================================================================
# Тест 4: форумы и обзоры для промышленных запросов — отсев
# ============================================================================

FORUM_URLS = [
    ("https://forum.cxem.net/topic/blok-pitaniya-meanwell", "обсуждение Mean Well"),
    ("https://chipmaker.ru/forum/topic/podshipnik-skf", "SKF обсуждение"),
    ("https://radiokot.ru/forum/viewtopic/datchik-m12", "датчик обсуждение"),
]


@pytest.mark.parametrize("url,snippet", FORUM_URLS)
def test_forums_filtered_for_industrial(url, snippet):
    """Форумы по промтоварам отсеиваются — там обсуждения, не цены"""
    score = score_url(url, snippet)
    assert score <= 0, f"Форум получил положительный скор: {url}"


# ============================================================================
# Тест 5: сводный отчёт — кто из запросов вообще проходит
# ============================================================================

def test_summary_report(capsys):
    """Печатает таблицу: запрос → проходит пре-фильтр + сколько символов."""
    print("\n" + "=" * 80)
    print("СВОДНЫЙ ОТЧЁТ ПО 19 ПРОМЫШЛЕННЫМ ЗАПРОСАМ")
    print("=" * 80)

    for i, query in enumerate(INDUSTRIAL_QUERIES, 1):
        passes = is_product_query(query)
        status = "✓ ОК" if passes else "✗ ОТСЕЯН"
        print(f"{i:2d}. [{status}] ({len(query):3d} симв.) {query[:60]}...")

    captured = capsys.readouterr()
    assert "СВОДНЫЙ ОТЧЁТ" in captured.out
