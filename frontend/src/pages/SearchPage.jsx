import { useSearchParams } from "react-router-dom";
import SearchForm from "../components/SearchForm";
import { SOURCES } from "../data/sources";

export default function SearchPage() {
  const [params] = useSearchParams();
  return (
    <main id="main" className="workspace search-workspace">
      <div className="page-heading">
        <p className="eyebrow">TenderHack · Санкт-Петербург</p>
        <h1>Поиск цен для закупки</h1>
        <p className="lead">
          Найдите сопоставимые предложения и проверьте характеристики товаров в
          открытых источниках
        </p>
      </div>
      <div className="search-layout">
        <section className="search-panel" aria-labelledby="search-title">
          <div className="section-heading">
            <span className="step">01</span>
            <h2 id="search-title">Какой товар нужен?</h2>
          </div>
          <SearchForm initialQuery={params.get("q") || ""} />
        </section>
        <aside className="source-panel" aria-labelledby="sources-title">
          <h2 id="sources-title">Источники цен</h2>
          <p className="secondary">
            Поиск выполняется сразу на четырёх площадках
          </p>
          <ul className="provider-list">
            {SOURCES.map((source) => (
              <li key={source.id}>
                <span>{source.title}</span>
              </li>
            ))}
          </ul>
        </aside>
      </div>
      <section className="workflow-note" aria-labelledby="workflow-title">
        <h2 id="workflow-title">От запроса к сравнению цен</h2>
        <ol>
          <li>
            <span>01</span>Укажите товар и регион
          </li>
          <li>
            <span>02</span>Сравните предложения
          </li>
          <li>
            <span>03</span>Проверьте характеристики
          </li>
        </ol>
      </section>
    </main>
  );
}
