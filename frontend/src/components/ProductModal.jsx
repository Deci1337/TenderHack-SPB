import { useEffect, useRef } from "react";
import { ArrowLeft, ArrowRight, ExternalLink, X } from "lucide-react";
import { SOURCE_LABEL, formatPrice, safeExternalUrl } from "../data/sources";
import { ProductImage } from "./ProductCard";

export default function ProductModal({
  product,
  allProducts,
  currentIndex,
  onClose,
  onNavigate,
}) {
  const dialog = useRef(null);
  const close = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    close.current?.focus();
    return () => {
      document.body.style.overflow = overflow;
      previous?.focus();
    };
  }, []);
  useEffect(() => {
    function keydown(event) {
      if (event.key === "Escape") onClose();
      if (event.key === "ArrowLeft" && currentIndex > 0)
        onNavigate(currentIndex - 1);
      if (event.key === "ArrowRight" && currentIndex < allProducts.length - 1)
        onNavigate(currentIndex + 1);
      if (event.key === "Tab") {
        const controls = [
          ...dialog.current.querySelectorAll("button:not(:disabled), a[href]"),
        ];
        const first = controls[0],
          last = controls.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last.focus();
        }
        if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first.focus();
        }
      }
    }
    window.addEventListener("keydown", keydown);
    return () => window.removeEventListener("keydown", keydown);
  }, [currentIndex, allProducts.length, onClose, onNavigate]);
  const chars = Object.entries(product.characteristics || {});
  const href = safeExternalUrl(product.source_url);
  return (
    <div
      className="dialog-backdrop"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="product-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="product-title"
        ref={dialog}
      >
        <div className="dialog-heading">
          <p>{SOURCE_LABEL[product.source] || product.source}</p>
          <button
            className="icon-button"
            aria-label="Закрыть карточку"
            ref={close}
            onClick={onClose}
          >
            <X size={24} />
          </button>
        </div>
        <div className="dialog-content">
          <ProductImage key={product.id} product={product} />
          <div>
            <h2 id="product-title">{product.name}</h2>
            <p className="dialog-price">{formatPrice(product.price)}</p>
            <h3>Характеристики</h3>
            {chars.length ? (
              <dl className="characteristics">
                {chars.map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd>{String(value)}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="secondary">Характеристики не указаны</p>
            )}
            {href ? (
              <a
                className="button primary source-link"
                href={href}
                target="_blank"
                rel="noreferrer"
              >
                Открыть предложение
                <ExternalLink size={18} aria-hidden="true" />
                <span className="sr-only"> в новой вкладке</span>
              </a>
            ) : (
              <p className="secondary">Ссылка на предложение недоступна</p>
            )}
          </div>
        </div>
        <div className="dialog-footer">
          <span>
            {currentIndex + 1} из {allProducts.length} предложений
          </span>
          <div>
            <button
              className="icon-button"
              disabled={currentIndex === 0}
              onClick={() => onNavigate(currentIndex - 1)}
              aria-label="Предыдущий товар"
            >
              <ArrowLeft size={20} />
            </button>
            <button
              className="icon-button"
              disabled={currentIndex === allProducts.length - 1}
              onClick={() => onNavigate(currentIndex + 1)}
              aria-label="Следующий товар"
            >
              <ArrowRight size={20} />
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
