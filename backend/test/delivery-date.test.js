import test from 'node:test';
import assert from 'node:assert/strict';
import {
  diffDays,
  enrichAndFilterByDelivery,
  filterAndSortByDelivery,
  formatDeliveryDays,
  parseDeliveryDeadline,
  parseDeliveryText,
  parseShipmentOriginCity,
  parseRuDate,
} from '../src/lib/delivery-date.js';

const NOW = new Date(2026, 4, 23);

test('parseDeliveryDeadline converts calendar deadline into max delivery days', () => {
  const deadline = parseDeliveryDeadline('2026-06-15', { now: NOW });

  assert.equal(deadline.maxDeliveryDays, 23);
  assert.equal(deadline.date.getFullYear(), 2026);
  assert.equal(deadline.date.getMonth(), 5);
  assert.equal(deadline.date.getDate(), 15);
});

test('filterAndSortByDelivery keeps only offers inside deadline and orders fastest first', () => {
  const offers = [
    { title: 'slow', price: 100, delivery_days: 10 },
    { title: 'fast expensive', price: 200, delivery_days: 2 },
    { title: 'outside', price: 1, delivery_days: 30 },
    { title: 'unknown', price: 1 },
    { title: 'fast cheap', price: 150, delivery_days: 2 },
  ];

  assert.deepEqual(
    filterAndSortByDelivery(offers, 10).map((o) => o.title),
    ['fast cheap', 'fast expensive', 'slow'],
  );
});

test('parseDeliveryDeadline rejects past and invalid dates', () => {
  assert.equal(parseDeliveryDeadline('2026-05-22', { now: NOW }), null);
  assert.equal(parseDeliveryDeadline('2026-02-31', { now: NOW }), null);
  assert.equal(parseDeliveryDeadline('15/06/2026', { now: NOW }), null);
});

test('parseRuDate and diffDays understand marketplace delivery text', () => {
  assert.equal(diffDays(parseRuDate('Доставим 15 июня', { now: NOW }), { now: NOW }), 23);
  assert.equal(diffDays(parseRuDate('завтра', { now: NOW }), { now: NOW }), 1);
  assert.equal(diffDays(parseRuDate('27 мая, ПВЗПо клику', { now: NOW }), { now: NOW }), 4);
  assert.equal(formatDeliveryDays(0), 'сегодня');
});

test('parseDeliveryText converts search-snippet delivery hints', () => {
  const info = parseDeliveryText('доставка 15 июня со склада в Красноярске', { now: NOW });

  assert.equal(info.days, 23);
  assert.equal(info.dateIso, '2026-06-15');
  assert.equal(info.shipmentOriginCity, 'Красноярск');
});

test('parseShipmentOriginCity extracts source city from delivery text', () => {
  assert.equal(parseShipmentOriginCity('Доставим 15 июня со склада в Красноярске'), 'Красноярск');
  assert.equal(parseShipmentOriginCity('Отправка из Москвы, привезём завтра'), 'Москва');
});

test('enrichAndFilterByDelivery keeps hint date and supplements origin from product page', async () => {
  const offers = [{
    source: 'yandex_market',
    title: 'coffee',
    price: 100,
    product_url: 'https://market.yandex.ru/card/test',
    delivery_text: 'Завтра, ПВЗПо клику',
  }];

  const result = await enrichAndFilterByDelivery(offers, {
    maxDeliveryDays: 10,
    fetchDeliveryInfoImpl: async () => parseDeliveryText('Доставим 30 мая со склада в Красноярске', { now: NOW }),
  });

  assert.equal(result[0].delivery_days, 1);
  assert.equal(result[0].delivery_date, '2026-05-24');
  assert.equal(result[0].shipment_origin_city, 'Красноярск');
  assert.equal(result[0].delivery_deep_text, 'Доставим 30 мая со склада в Красноярске');
});
