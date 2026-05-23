import test from 'node:test';
import assert from 'node:assert/strict';
import { parseProcurementPdfText } from '../src/lib/pdf-ingest.js';

test('parseProcurementPdfText extracts registry positions and source rows', () => {
  const text = `
РЕЕСТР ТОВАРОВ
Позиция 1. Ноутбук для административного персонала
ОКПД2: 26.20.11.110 КТРУ:
26.20.11.110-00000001
Количество
:
10 шт.
Цена за ед. (руб., с НДС):
68 500,00
Сумма
(руб.):
685 000,00
НДС:
20 %
Технические характеристики:
Процессор Intel Core i5-1335U, 10 ядер, до 4,6 ГГц
Источники ценовой информации:
1 КП ООО «ТехноПлюс» Исх.№ 47 от 68 500,00
05.05.2025
technoplius.ru/offer/47
2 КП ООО «ИТ-Снаб» Исх.№ 112 от 71 000,00
07.05.2025
it-snab.ru/kp/112
Принятая цена за ед.:
68 500,00 руб. (с НДС 20%)
Обоснование:
Выбрано КП.
`;

  const result = parseProcurementPdfText({
    filePath: '/tmp/Реестр_товаров.pdf',
    pages: [{ page_number: 1, text }],
  });

  assert.equal(result.document_type, 'product_registry');
  assert.equal(result.parsed.summary.position_count, 1);
  assert.equal(result.parsed.positions[0].title, 'Ноутбук для административного персонала');
  assert.equal(result.parsed.positions[0].price_per_unit, 68500);
  assert.equal(result.parsed.positions[0].accepted_price, 68500);
  assert.equal(result.parsed.positions[0].source_rows.length, 2);
  assert.equal(result.parsed.positions[0].source_rows[0].price, 68500);
  assert.equal(result.parsed.positions[0].source_rows[0].link, 'technoplius.ru/offer/47');
});

test('parseProcurementPdfText extracts nmck sources and calculation', () => {
  const text = `
ОБОСНОВАНИЕ
1. ОБЩИЕ СВЕДЕНИЯ О ЗАКУПКЕ
Наименование заказчика:
ГБОУ «Школа № 154»
ИНН / КПП заказчика:
7701234567 / 770101001
Наименование объекта закупки:
Поставка компьютерного оборудования для нужд учреждения
Идентификационный код закупки (ИКЗ):
231770123456777010100100120004040000
Способ определения поставщика:
Электронный аукцион
Источник финансирования:
Средства субсидии из бюджета г. Москвы
Дата составления обоснования:
14 мая 2025 г.
3. ИСТОЧНИКИ ЦЕНОВОЙ ИНФОРМАЦИИ
1 КП ООО «ТехноПлюс» (поставщик компьютерной техники) Исх. № 47 от 1 258 400,00
05.05.2025
2 КП ООО «ИТ-Снаб» (официальный дилер) Исх. № 112 от 1 304 200,00
07.05.2025
4. РАСЧЁТ НМЦК
Цена № 1 (КП ООО «ТехноПлюс») 1 258 400,00 руб.
Цена № 2 (КП ООО «ИТ-Снаб») 1 304 200,00 руб.
Среднеарифметическое значение (НМЦК) 1 237 420,00 руб.
Коэффициент вариации (V) 4,26 % (< 33 %)
НМЦК (с НДС 20%), итого 1 237 420,00 руб.
5. НОРМАТИВНЫЕ ОСНОВАНИЯ И ПРИМЕЧАНИЯ
• Федеральный закон от 05.04.2013 № 44-ФЗ, ст. 22.
`;

  const result = parseProcurementPdfText({
    filePath: '/tmp/НМЦК_Обоснование.pdf',
    pages: [{ page_number: 1, text }],
  });

  assert.equal(result.document_type, 'nmck_justification');
  assert.equal(result.parsed.customer.name, 'ГБОУ «Школа № 154»');
  assert.equal(result.parsed.source_prices.length, 2);
  assert.equal(result.parsed.source_prices[0].price, 1258400);
  assert.equal(result.parsed.calculation.average_price, 1237420);
  assert.equal(result.parsed.calculation.variation_percent, 4.26);
  assert.equal(result.parsed.calculation.total_price, 1237420);
  assert.equal(result.parsed.normative_basis[0], 'Федеральный закон от 05.04.2013 № 44-ФЗ, ст. 22.');
});
