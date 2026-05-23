import { useEffect } from 'react'
import { X, ChevronLeft, ChevronRight, ExternalLink } from 'lucide-react'

const SOURCES = {
  wildberries:   { label: 'Wildberries',   cls: 'bg-purple-50 text-purple-700 border-purple-100' },
  ozon:          { label: 'Ozon',          cls: 'bg-blue-50 text-blue-700 border-blue-100' },
  yandex_market: { label: 'Яндекс Маркет', cls: 'bg-amber-50 text-amber-700 border-amber-100' },
  runet:         { label: 'Рунет',         cls: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
}

export default function ProductModal({ product, allProducts, currentIndex, onClose, onNavigate }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft' && currentIndex > 0) onNavigate(currentIndex - 1)
      if (e.key === 'ArrowRight' && currentIndex < allProducts.length - 1) onNavigate(currentIndex + 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIndex, allProducts.length, onClose, onNavigate])

  const src = SOURCES[product.source] || { label: product.source, cls: 'bg-gray-50 text-gray-600 border-gray-100' }
  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < allProducts.length - 1

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-label={product.name}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-[#0F172A]/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Карточка */}
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">

        {/* Кнопка закрыть */}
        <button
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-gray-100 hover:bg-gray-200 text-[#475569] transition-colors duration-150 cursor-pointer"
        >
          <X className="w-4 h-4" strokeWidth={2.5} />
        </button>

        {/* Картинка */}
        <div className="h-52 bg-gray-50 overflow-hidden rounded-t-2xl">
          <img
            src={product.image_url}
            alt={product.name}
            className="w-full h-full object-cover"
            onError={e => { e.target.src = 'https://placehold.co/400x208/F1F5F9/94A3B8?text=Нет+фото' }}
          />
        </div>

        <div className="p-6">
          {/* Источник */}
          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-500 border mb-3 ${src.cls}`}>
            {src.label}
          </span>

          {/* Название */}
          <h2 className="text-base font-600 text-[#0F172A] leading-snug mb-3">
            {product.name}
          </h2>

          {/* Цена */}
          <p className="text-3xl font-700 text-[#0369A1] mb-5">
            {product.price.toLocaleString('ru-RU')} <span className="text-lg text-[#94A3B8] font-400">₽</span>
          </p>

          {/* Характеристики */}
          {product.characteristics && Object.keys(product.characteristics).length > 0 && (
            <div className="mb-5">
              <h3 className="text-xs font-600 text-[#94A3B8] uppercase tracking-widest mb-2">
                Характеристики
              </h3>
              <dl className="divide-y divide-gray-50 border border-gray-100 rounded-xl overflow-hidden">
                {Object.entries(product.characteristics).map(([key, val]) => (
                  <div key={key} className="flex justify-between items-center px-4 py-2.5 text-sm">
                    <dt className="text-[#64748B]">{key}</dt>
                    <dd className="text-[#0F172A] font-500 text-right ml-4">{val}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Кнопка перехода */}
          <a
            href={product.source_url}
            target="_blank"
            rel="noreferrer"
            className="flex items-center justify-center gap-2 w-full py-3 bg-[#0369A1] hover:bg-[#0284C7] text-white font-600 rounded-xl transition-colors duration-200 text-sm cursor-pointer"
          >
            Перейти к источнику
            <ExternalLink className="w-4 h-4" strokeWidth={2} />
          </a>
        </div>

        {/* Карусель навигация */}
        <div className="flex items-center justify-between px-6 pb-5 border-t border-gray-50 pt-4">
          <button
            onClick={() => hasPrev && onNavigate(currentIndex - 1)}
            disabled={!hasPrev}
            aria-label="Предыдущий товар"
            className="flex items-center gap-1 text-sm text-[#475569] hover:text-[#0369A1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" strokeWidth={2} />
            Предыдущий
          </button>

          <span className="text-xs text-[#94A3B8] tabular-nums">
            {currentIndex + 1} / {allProducts.length}
          </span>

          <button
            onClick={() => hasNext && onNavigate(currentIndex + 1)}
            disabled={!hasNext}
            aria-label="Следующий товар"
            className="flex items-center gap-1 text-sm text-[#475569] hover:text-[#0369A1] disabled:opacity-30 disabled:cursor-not-allowed transition-colors duration-150 cursor-pointer"
          >
            Следующий
            <ChevronRight className="w-4 h-4" strokeWidth={2} />
          </button>
        </div>
      </div>
    </div>
  )
}
