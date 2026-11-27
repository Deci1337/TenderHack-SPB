import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ChevronDown } from "lucide-react";
import SearchForm from "../components/SearchForm";
import ProductCard from "../components/ProductCard";
import ProductModal from "../components/ProductModal";
import { SOURCES } from "../data/sources";

function plural(count) {
  if (count % 100 >= 11 && count % 100 <= 14) return "предложений";
  const last = count % 10;
  return last === 1
    ? "предложение"
    : last >= 2 && last <= 4
      ? "предложения"
      : "предложений";
}
function OfferResults({ query, region, priceFrom, priceTo }) {
  const [sources, setSources] = useState({});
  const [correction, setCorrection] = useState(null);
  const [modal, setModal] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/correct?q=${encodeURIComponent(query)}`, {
      signal: controller.signal,
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.changed) setCorrection(data);
      })
      .catch(() => {});
    for (const source of SOURCES) {
      fetch(
        `/api/search/${source.id}?${new URLSearchParams({ q: query, region })}`,
        {
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(60000),
          ]),
        },
      )
        .then(async (response) => {
          if (!response.ok) throw new Error("Source unavailable");
          const data = await response.json();
          const products = data.products ?? data;
          if (!Array.isArray(products)) throw new Error("Invalid response");
          return products.map((product, index) => ({
            ...product,
            id: product.id ?? `${source.id}_${index}`,
            source: product.source ?? source.id,
          }));
        })
        .then((products) => {
          if (!controller.signal.aborted)
            setSources((previous) => ({
              ...previous,
              [source.id]: { products },
            }));
        })
        .catch(() => {
          if (!controller.signal.aborted)
            setSources((previous) => ({
              ...previous,
              [source.id]: { products: [], error: true },
            }));
        });
    }
    return () => controller.abort();
  }, [query, region]);
  const products = useMemo(
    () =>
      SOURCES.flatMap((source) => sources[source.id]?.products || []).filter(
        (product) => {
          if (priceFrom && product.price < priceFrom) return false;
          if (priceTo && product.price > priceTo) return false;
          return true;
        },
      ),
    [sources, priceFrom, priceTo],
  );
  const complete = Object.keys(sources).length === SOURCES.length;
  return (
    <>
      <div className="results-heading">
        <div>
          <p className="eyebrow">Предложения из открытых источников</p>
          <h1>{query ? `«${query}»` : "Результаты поиска"}</h1>
        </div>
        <p className="result-count" aria-live="polite">
          {products.length} {plural(products.length)}
          <span>
            {complete ? "Поиск завершён" : "Идёт поиск по площадкам…"}
          </span>
        </p>
      </div>
      {correction && (
        <p className="correction">
          Ищем с учётом исправления: <strong>{correction.corrected}</strong>
        </p>
      )}
      <p className="result-description">
        {region} · Цены за товар в рублях
        {priceFrom ? ` · от ${priceFrom.toLocaleString("ru-RU")} ₽` : ""}
        {priceTo ? ` · до ${priceTo.toLocaleString("ru-RU")} ₽` : ""}
      </p>
      <div className="source-summary" aria-label="Состояние источников">
        {SOURCES.map((source) => (
          <a href={`#source-${source.id}`} key={source.id}>
            {source.title}
            <span>
              {sources[source.id]
                ? sources[source.id].error
                  ? "Недоступен"
                  : products.filter((product) => product.source === source.id)
                      .length
                : "Поиск…"}
            </span>
          </a>
        ))}
      </div>
      {SOURCES.map((source) => {
        const data = sources[source.id];
        const list = products.filter((product) => product.source === source.id);
        return (
          <section
            className="source-section"
            id={`source-${source.id}`}
            key={source.id}
            aria-labelledby={`title-${source.id}`}
            aria-busy={!data}
          >
            <div className="source-heading">
              <h2 id={`title-${source.id}`}>{source.title}</h2>
              <span>
                {data
                  ? `${list.length} ${plural(list.length)}`
                  : "Ищем предложения"}
              </span>
            </div>
            {!data ? (
              <div className="loading-row" role="status">
                <span className="loading-indicator" />
                Загружаем цены и характеристики…
              </div>
            ) : data.error ? (
              <p className="empty-source">
                Не удалось получить предложения. Повторите поиск позже.
              </p>
            ) : !list.length ? (
              <p className="empty-source">
                Нет предложений по выбранным условиям
              </p>
            ) : (
              <div className="product-grid">
                {list.map((product, index) => (
                  <ProductCard
                    key={`${product.id}-${index}`}
                    product={product}
                    onDetails={() => setModal(products.indexOf(product))}
                  />
                ))}
              </div>
            )}
          </section>
        );
      })}
      {complete && !products.length && (
        <div className="no-results">
          <h2>Попробуйте уточнить запрос</h2>
          <p>Укажите другое название товара или расширьте диапазон цен</p>
          <Link
            className="button secondary-button"
            to={`/?q=${encodeURIComponent(query)}`}
          >
            Изменить запрос
          </Link>
        </div>
      )}
      {modal !== null && products[modal] && (
        <ProductModal
          product={products[modal]}
          allProducts={products}
          currentIndex={modal}
          onClose={() => setModal(null)}
          onNavigate={setModal}
        />
      )}
    </>
  );
}
export default function ResultsPage() {
  const [filtersOpen, setFiltersOpen] = useState(
    () => !window.matchMedia("(max-width: 800px)").matches,
  );
  useEffect(() => {
    const media = window.matchMedia("(max-width: 800px)");
    const resize = (event) => setFiltersOpen(!event.matches);
    media.addEventListener("change", resize);
    return () => media.removeEventListener("change", resize);
  }, []);
  const [params] = useSearchParams();
  const query = params.get("q") || "";
  const region = params.get("region") || "Москва";
  const priceFrom = parseFloat(params.get("priceFrom")) || null;
  const priceTo = parseFloat(params.get("priceTo")) || null;
  return (
    <main id="main" className="workspace results-workspace">
      <Link className="back-link" to={`/?q=${encodeURIComponent(query)}`}>
        <ArrowLeft size={18} aria-hidden="true" />
        Новый поиск
      </Link>
      <div className="results-layout">
        <details
          className="filter-panel"
          open={filtersOpen}
          onToggle={(event) => setFiltersOpen(event.currentTarget.open)}
        >
          <summary
            aria-expanded={filtersOpen}
            tabIndex={window.matchMedia("(max-width: 800px)").matches ? 0 : -1}
            onClick={(event) => {
              if (!window.matchMedia("(max-width: 800px)").matches)
                event.preventDefault();
            }}
          >
            <h2>Параметры поиска</h2>
            <ChevronDown size={20} aria-hidden="true" />
          </summary>
          <div className="filter-content">
            <SearchForm
              key={params.toString()}
              initialQuery={query}
              initialRegion={region}
              initialFrom={params.get("priceFrom") || ""}
              initialTo={params.get("priceTo") || ""}
              compact
            />
            <p className="filter-note">
              Проверяйте комплектацию и условия поставки на сайте продавца
            </p>
          </div>
        </details>
        <div className="results-content">
          <OfferResults
            key={`${query}-${region}`}
            query={query}
            region={region}
            priceFrom={priceFrom}
            priceTo={priceTo}
          />
        </div>
      </div>
    </main>
  );
}
