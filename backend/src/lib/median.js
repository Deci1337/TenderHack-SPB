/**
 * Методика НМЦК: после фильтрации валидных карточек выбираем товары
 * вокруг медианной цены. Выбросы (топ/низ 10%) считаем нерепрезентативными
 * (фейки за 1₽, опт, премиум). Возвращаем `count` шт. симметрично вокруг медианы.
 */
export function selectMedianProducts(items, count = 8) {
  if (!Array.isArray(items) || items.length === 0) return []
  if (items.length <= count) return items
  const sorted = [...items].sort((a, b) => (a.price ?? 0) - (b.price ?? 0))
  // Drop outliers only when we have a comfortable surplus (2× count); otherwise all items are core.
  const dropEach = sorted.length >= count * 2 ? Math.floor(sorted.length * 0.1) : 0
  const core = dropEach > 0 ? sorted.slice(dropEach, sorted.length - dropEach) : sorted
  if (core.length <= count) return core
  const midIdx = Math.floor(core.length / 2)
  const half = Math.floor(count / 2)
  let start = midIdx - half
  let end = start + count
  if (start < 0) { end -= start; start = 0 }
  if (end > core.length) { start -= (end - core.length); end = core.length }
  return core.slice(Math.max(0, start), end)
}
