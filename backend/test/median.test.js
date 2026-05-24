import test from 'node:test'
import assert from 'node:assert/strict'
import { selectMedianProducts } from '../src/lib/median.js'

test('пустой вход → пустой выход', () => {
  assert.deepEqual(selectMedianProducts([], 8), [])
  assert.deepEqual(selectMedianProducts(null, 8), [])
})

test('меньше элементов чем count → возвращаем все', () => {
  const items = [{ price: 100 }, { price: 200 }]
  assert.equal(selectMedianProducts(items, 8).length, 2)
})

test('обрезает выбросы по 10% с каждого края', () => {
  // 20 элементов: цены 1..20. dropEach=2, остаётся 17 элементов (3..19).
  // Минимум 1 и максимум 20 — выбросы (фейки/премиум) — должны уйти.
  const items = Array.from({ length: 20 }, (_, i) => ({ price: i + 1 }))
  const result = selectMedianProducts(items, 8)
  const prices = result.map(p => p.price)
  assert.ok(!prices.includes(1), 'минимум-выброс должен уйти')
  assert.ok(!prices.includes(20), 'максимум-выброс должен уйти')
  assert.equal(result.length, 8)
})

test('возвращает count товаров вокруг медианы', () => {
  // Цены 1..100, count=10. Медиана ≈ 50. Должны получить ~10 товаров около середины.
  const items = Array.from({ length: 100 }, (_, i) => ({ price: i + 1 }))
  const result = selectMedianProducts(items, 10)
  assert.equal(result.length, 10)
  const prices = result.map(p => p.price)
  const avg = prices.reduce((s, p) => s + p, 0) / prices.length
  assert.ok(avg > 40 && avg < 60, `средняя цена результата должна быть около медианы (50), получили ${avg}`)
})

test('товары с одной ценой → все валидны', () => {
  const items = Array.from({ length: 15 }, () => ({ price: 1000 }))
  const result = selectMedianProducts(items, 8)
  assert.equal(result.length, 8)
  assert.ok(result.every(p => p.price === 1000))
})

test('фильтрует фейки за 1₽ при наличии нормальных цен', () => {
  // 18 товаров: 2 фейка по 1₽, остальные 5000-7000₽
  const items = [
    { price: 1 }, { price: 1 },
    ...Array.from({ length: 16 }, (_, i) => ({ price: 5000 + i * 100 })),
  ]
  const result = selectMedianProducts(items, 8)
  assert.ok(result.every(p => p.price > 100), 'фейки за 1₽ должны быть отброшены')
})

test('сохраняет порядок по цене внутри медианного среза', () => {
  const items = Array.from({ length: 30 }, (_, i) => ({ price: (i + 1) * 100, id: i }))
  const result = selectMedianProducts(items, 8)
  for (let i = 1; i < result.length; i++) {
    assert.ok(result[i].price >= result[i - 1].price, 'отсортировано по возрастанию цены')
  }
})
