import { useEffect, useId, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search } from "lucide-react";
import { fetchSuggestions } from "../api/suggest";

const REGIONS = [
  "Москва",
  "Казань",
  "Санкт-Петербург",
  "Екатеринбург",
  "Новосибирск",
  "Нижний Новгород",
  "Челябинск",
  "Самара",
  "Омск",
  "Ростов-на-Дону",
];
export default function SearchForm({
  initialQuery = "",
  initialRegion = "Москва",
  initialFrom = "",
  initialTo = "",
  compact = false,
}) {
  const [query, setQuery] = useState(initialQuery);
  const [region, setRegion] = useState(initialRegion);
  const [from, setFrom] = useState(initialFrom);
  const [to, setTo] = useState(initialTo);
  const [hints, setHints] = useState([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [error, setError] = useState("");
  const id = useId();
  const navigate = useNavigate();
  useEffect(() => {
    let cancelled = false;
    const timer = setTimeout(() => {
      fetchSuggestions(query.trim(), 7).then((groups) => {
        if (!cancelled)
          setHints(groups.flatMap((group) => group.items || []).slice(0, 7));
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);
  function submit(event, value = query) {
    event?.preventDefault();
    if (!value.trim()) {
      setError("Укажите название товара");
      return;
    }
    if (from !== "" && to !== "" && Number(from) > Number(to)) {
      setError("Цена «от» должна быть не больше цены «до»");
      return;
    }
    const params = new URLSearchParams({ q: value.trim(), region });
    if (from !== "") params.set("priceFrom", from);
    if (to !== "") params.set("priceTo", to);
    setOpen(false);
    setError("");
    navigate(`/results?${params}`);
  }
  const showHints = open && hints.length > 0;
  return (
    <form
      className={`search-form ${compact ? "compact" : ""}`}
      onSubmit={submit}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className="query-group">
        <label htmlFor={`${id}-query`}>
          Название или характеристики товара
        </label>
        <div className="query-row">
          <div className="query-input">
            <Search size={20} aria-hidden="true" />
            <input
              id={`${id}-query`}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(-1);
                setOpen(true);
                setError("");
              }}
              onFocus={() => setOpen(true)}
              placeholder="Например, бумага офисная А4"
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={showHints}
              aria-controls={showHints ? `${id}-hints` : undefined}
              aria-activedescendant={
                showHints && active >= 0 ? `${id}-hint-${active}` : undefined
              }
              autoComplete="off"
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  setOpen(false);
                  event.preventDefault();
                }
                if (event.key === "ArrowDown" && hints.length) {
                  event.preventDefault();
                  setOpen(true);
                  setActive((index) => (index + 1) % hints.length);
                }
                if (event.key === "ArrowUp" && hints.length) {
                  event.preventDefault();
                  setOpen(true);
                  setActive(
                    (index) => (index + hints.length - 1) % hints.length,
                  );
                }
                if (event.key === "Enter" && showHints && active >= 0) {
                  event.preventDefault();
                  setQuery(hints[active]);
                  submit(null, hints[active]);
                }
              }}
            />
          </div>
          {!compact && (
            <button className="button primary" type="submit">
              Найти товары
            </button>
          )}
        </div>
        {showHints && (
          <ul
            className="suggestions"
            id={`${id}-hints`}
            role="listbox"
            aria-label="Подсказки поиска"
          >
            {hints.map((hint, index) => (
              <li
                role="option"
                id={`${id}-hint-${index}`}
                key={`${hint}-${index}`}
                aria-selected={index === active}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  setQuery(hint);
                  submit(null, hint);
                }}
              >
                <Search size={16} aria-hidden="true" />
                {hint}
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="search-filters">
        <div className="field">
          <label htmlFor={`${id}-region`}>Регион</label>
          <select
            id={`${id}-region`}
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          >
            {REGIONS.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        <fieldset className="price-fields">
          <legend>Цена, ₽</legend>
          <div>
            <label className="price-input" htmlFor={`${id}-from`}>
              <span>от</span>
              <input
                id={`${id}-from`}
                aria-label="Цена от"
                type="number"
                min="0"
                step="any"
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                placeholder="0"
              />
            </label>
            <span className="price-separator">—</span>
            <label className="price-input" htmlFor={`${id}-to`}>
              <span>до</span>
              <input
                id={`${id}-to`}
                aria-label="Цена до"
                type="number"
                min="0"
                step="any"
                value={to}
                onChange={(event) => setTo(event.target.value)}
                placeholder="Любая"
              />
            </label>
          </div>
        </fieldset>
      </div>
      {compact && (
        <button className="button primary" type="submit">
          Найти товары
        </button>
      )}
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
    </form>
  );
}
