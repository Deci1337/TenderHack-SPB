export function buildPriceSummary(offers) {
  const prices = offers.map((offer) => offer.price).filter((price) => Number.isFinite(price)).sort((a, b) => a - b);
  if (prices.length === 0) {
    return {
      count: 0,
      min_price: null,
      median_price: null,
      max_price: null,
      top_offers: [],
    };
  }

  const middle = Math.floor(prices.length / 2);
  const median =
    prices.length % 2 === 0 ? (prices[middle - 1] + prices[middle]) / 2 : prices[middle];

  const top_offers = [...offers]
    .sort((a, b) => (b.relevance_score ?? 0) - (a.relevance_score ?? 0) || a.price - b.price)
    .slice(0, 3)
    .map((offer) => ({
      source: offer.source,
      title: offer.title,
      price: offer.price,
      product_url: offer.product_url,
      relevance_score: offer.relevance_score ?? 0,
    }));

  return {
    count: offers.length,
    min_price: prices[0],
    median_price: median,
    max_price: prices[prices.length - 1],
    top_offers,
  };
}
