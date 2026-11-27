import { ImageOff } from "lucide-react";
import { useState } from "react";
import { formatPrice } from "../data/sources";

export function ProductImage({ product }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="product-image">
      {product.image_url && !failed ? (
        <img
          src={product.image_url}
          alt={product.name}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="image-fallback">
          <ImageOff size={28} aria-hidden="true" />
          Фото недоступно
        </span>
      )}
    </div>
  );
}
export default function ProductCard({ product, onDetails }) {
  return (
    <article className="product-card">
      <ProductImage product={product} />
      <div className="product-info">
        <p className="product-price">{formatPrice(product.price)}</p>
        <h3>{product.name}</h3>
        <button className="button secondary-button" onClick={onDetails}>
          Подробнее<span className="sr-only">: {product.name}</span>
        </button>
      </div>
    </article>
  );
}
