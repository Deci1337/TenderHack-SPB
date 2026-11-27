export const SOURCES = [
  { id: "wildberries", title: "Wildberries" },
  { id: "ozon", title: "Ozon" },
  { id: "yandex_market", title: "Яндекс Маркет" },
  { id: "runet", title: "Другие источники" },
];
export const SOURCE_LABEL = Object.fromEntries(
  SOURCES.map((source) => [source.id, source.title]),
);
export function formatPrice(price) {
  return typeof price === "number" && Number.isFinite(price) && price > 0
    ? new Intl.NumberFormat("ru-RU", {
        style: "currency",
        currency: "RUB",
        maximumFractionDigits: 2,
      }).format(price)
    : "Цена не указана";
}
export function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}
