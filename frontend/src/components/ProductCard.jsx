import { ExternalLink } from 'lucide-react'

const SOURCE_STYLE = {
  wildberries:   { label: 'WB',   bg: '#F5F3FF', color: '#6D28D9', border: '#DDD6FE' },
  ozon:          { label: 'Ozon', bg: '#EFF6FF', color: '#1D4ED8', border: '#BFDBFE' },
  yandex_market: { label: 'ЯМ',  bg: '#FFFBEB', color: '#92400E', border: '#FDE68A' },
  runet:         { label: 'Сеть', bg: '#ECFDF5', color: '#065F46', border: '#A7F3D0' },
}

export default function ProductCard({ product, onDetails }) {
  const s = SOURCE_STYLE[product.source] || { label: '?', bg: '#F1F5F9', color: '#475569', border: '#CBD5E1' }

  return (
    <article
      onClick={onDetails}
      style={{
        background: '#FFFFFF',
        borderRadius: '12px',
        border: '1.5px solid #F1F5F9',
        overflow: 'hidden',
        display: 'flex', flexDirection: 'column',
        cursor: 'pointer',
        transition: 'transform 0.18s, box-shadow 0.18s, border-color 0.18s',
      }}
      onMouseEnter={e => {
        e.currentTarget.style.transform = 'translateY(-2px)'
        e.currentTarget.style.boxShadow = '0 8px 24px rgba(11,22,40,0.1)'
        e.currentTarget.style.borderColor = '#BFDBFE'
      }}
      onMouseLeave={e => {
        e.currentTarget.style.transform = 'translateY(0)'
        e.currentTarget.style.boxShadow = 'none'
        e.currentTarget.style.borderColor = '#F1F5F9'
      }}
    >
      {/* Картинка */}
      <div style={{ position: 'relative', background: '#F8FAFC', aspectRatio: '1/1', overflow: 'hidden' }}>
        <img
          src={product.image_url}
          alt={product.name}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '8px' }}
          onError={e => { e.target.src = 'https://placehold.co/300x300/F1F5F9/94A3B8?text=Фото' }}
        />
        <span style={{
          position: 'absolute', top: '6px', left: '6px',
          padding: '2px 7px', borderRadius: '100px',
          fontSize: '10px', fontWeight: 700,
          background: s.bg, color: s.color, border: `1px solid ${s.border}`,
        }}>
          {s.label}
        </span>
      </div>

      {/* Контент */}
      <div style={{ padding: '8px 8px 8px', flex: 1, display: 'flex', flexDirection: 'column' }}>
        <p style={{
          fontSize: '11px', lineHeight: 1.3, color: '#334155',
          fontWeight: 500, flex: 1, marginBottom: '6px',
          display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden',
        }}>
          {product.name}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <p style={{ fontSize: '14px', fontWeight: 800, color: '#0F172A', letterSpacing: '-0.02em' }}>
            {product.price.toLocaleString('ru-RU')}
            <span style={{ fontSize: '10px', color: '#94A3B8', fontWeight: 400, marginLeft: '2px' }}>₽</span>
          </p>
          <a
            href={product.source_url}
            target="_blank"
            rel="noreferrer"
            onClick={e => e.stopPropagation()}
            aria-label="Открыть источник"
            style={{
              width: '22px', height: '22px', borderRadius: '6px',
              border: '1px solid #E2E8F0', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: '#94A3B8', textDecoration: 'none', transition: 'all 0.15s',
            }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = '#1D6ECA'; e.currentTarget.style.color = '#1D6ECA' }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = '#E2E8F0'; e.currentTarget.style.color = '#94A3B8' }}
          >
            <ExternalLink size={10} strokeWidth={2} />
          </a>
        </div>
      </div>
    </article>
  )
}
