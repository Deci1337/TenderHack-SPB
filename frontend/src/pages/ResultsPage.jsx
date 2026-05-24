import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react'
import ProductCard from '../components/ProductCard'
import ProductModal from '../components/ProductModal'
import SkeletonCard from '../components/SkeletonCard'

const SOURCE_ORDER = ['wildberries', 'ozon', 'yandex_market', 'runet']
const SOURCE_META = {
  wildberries:   { title: 'Wildberries',   color: '#6D28D9', dot: '#7C3AED', light: '#F5F3FF' },
  ozon:          { title: 'Ozon',          color: '#1D4ED8', dot: '#2563EB', light: '#EFF6FF' },
  yandex_market: { title: 'Яндекс Маркет', color: '#92400E', dot: '#D97706', light: '#FFFBEB' },
  runet:         { title: 'Рунет',         color: '#065F46', dot: '#059669', light: '#ECFDF5' },
}
const SOURCE_DELAYS = { wildberries: 800, ozon: 2200, yandex_market: 3800, runet: 5000 }

const CARD_WIDTH = 240   // px — крупная карточка
const CARD_GAP   = 16    // px — зазор между карточками

function Carousel({ products, onDetails }) {
  const trackRef = useRef(null)
  const [canLeft,  setCanLeft]  = useState(false)
  const [canRight, setCanRight] = useState(true)

  const step = (CARD_WIDTH + CARD_GAP) * 2

  const scroll = (dir) => {
    const el = trackRef.current
    if (!el) return
    el.scrollBy({ left: dir * step, behavior: 'smooth' })
  }

  const onScroll = () => {
    const el = trackRef.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }

  useEffect(() => {
    const el = trackRef.current
    if (!el) return
    onScroll()
    el.addEventListener('scroll', onScroll, { passive: true })
    return () => el.removeEventListener('scroll', onScroll)
  }, [products])

  const btn = (dir, enabled) => ({
    position: 'absolute',
    top: '50%', transform: 'translateY(-50%)',
    [dir === -1 ? 'left' : 'right']: '-18px',
    zIndex: 10,
    width: '40px', height: '40px', borderRadius: '50%',
    background: enabled ? '#FFFFFF' : 'rgba(255,255,255,0.4)',
    border: '1.5px solid #E2E8F0',
    boxShadow: enabled ? '0 4px 14px rgba(0,0,0,0.12)' : 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: enabled ? 'pointer' : 'default',
    transition: 'all 0.15s',
    color: enabled ? '#0F172A' : '#CBD5E1',
    fontFamily: 'inherit',
  })

  return (
    <div style={{ position: 'relative', padding: '4px 24px' }}>
      <button
        style={btn(-1, canLeft)}
        onClick={() => canLeft && scroll(-1)}
        aria-label="Листать назад"
      >
        <ChevronLeft size={20} strokeWidth={2.5} />
      </button>

      <div
        ref={trackRef}
        style={{
          display: 'flex', gap: `${CARD_GAP}px`,
          overflowX: 'auto',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
          WebkitOverflowScrolling: 'touch',
        }}
      >
        <style>{`div::-webkit-scrollbar { display: none }`}</style>
        {products.map((product, i) => (
          <div key={product.id} style={{ minWidth: `${CARD_WIDTH}px`, flexShrink: 0 }}>
            <ProductCard product={product} onDetails={() => onDetails(i)} />
          </div>
        ))}
      </div>

      <button
        style={btn(1, canRight)}
        onClick={() => canRight && scroll(1)}
        aria-label="Листать вперёд"
      >
        <ChevronRight size={20} strokeWidth={2.5} />
      </button>
    </div>
  )
}

export default function ResultsPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const query      = searchParams.get('q') || ''
  const region     = searchParams.get('region') || 'Москва'
  const priceFrom  = parseFloat(searchParams.get('priceFrom')) || null
  const priceTo    = parseFloat(searchParams.get('priceTo'))   || null
  const dateTo     = searchParams.get('dateTo') || null

  const deliveryDays = useMemo(() => {
    if (!dateTo) return null
    const today = new Date(); today.setHours(0, 0, 0, 0)
    return Math.round((new Date(dateTo) - today) / 86400000)
  }, [dateTo])

  const [loadedSources, setLoadedSources] = useState([])
  const [modalIndex, setModalIndex] = useState(null)
  const [sourceProducts, setSourceProducts] = useState({})  // source → products[]
  const [correction, setCorrection] = useState(null)

  useEffect(() => {
    fetch(`/api/correct?q=${encodeURIComponent(query)}`)
      .then(r => r.json())
      .then(d => { if (d.changed) setCorrection(d) })
      .catch(() => {})
  }, [query])

  useEffect(() => {
    setLoadedSources([])
    setSourceProducts({})

    const q = encodeURIComponent(query)
    const r = encodeURIComponent(region)

    const fetchSource = async (src, apiPath, delay) => {
      await new Promise(res => setTimeout(res, delay))
      try {
        const resp = await fetch(`${apiPath}?q=${q}&region=${r}`)
        if (resp.ok) {
          const data = await resp.json()
          const products = (data.products ?? data).map((p, i) => ({
            ...p,
            id: p.id ?? `${src}_${i}`,
            source: p.source ?? src,
          }))
          setSourceProducts(prev => ({ ...prev, [src]: products }))
        }
      } catch {
        // источник недоступен
      } finally {
        setLoadedSources(prev => [...prev, src])
      }
    }

    const controllers = []
    fetchSource('wildberries',   '/api/search/wildberries',   SOURCE_DELAYS.wildberries)
    fetchSource('ozon',          '/api/search/ozon',          SOURCE_DELAYS.ozon)
    fetchSource('yandex_market', '/api/search/yandex_market', SOURCE_DELAYS.yandex_market)
    fetchSource('runet',         '/api/search/runet',         SOURCE_DELAYS.runet)

    // таймауты-гарантии: если API висит — всё равно показываем секцию
    const fallbackTimers = SOURCE_ORDER.map(src =>
      setTimeout(() => setLoadedSources(prev => prev.includes(src) ? prev : [...prev, src]),
        SOURCE_DELAYS[src] + 55000)
    )

    return () => fallbackTimers.forEach(clearTimeout)
  }, [query, region])

  const allProducts = useMemo(() => {
    return SOURCE_ORDER
      .filter(src => loadedSources.includes(src))
      .flatMap(src => sourceProducts[src] ?? [])
      .filter(p => {
        if (priceFrom && p.price < priceFrom) return false
        if (priceTo   && p.price > priceTo)   return false
        return true
      })
  }, [loadedSources, sourceProducts, priceFrom, priceTo])

  const allLoaded = loadedSources.length === SOURCE_ORDER.length

  const [nmck, setNmck] = useState(null)

  useEffect(() => {
    if (!allLoaded || allProducts.length === 0) {
      setNmck(null)
      return
    }

    const prices = allProducts.map(p => p.price).filter(p => p > 0)
    if (prices.length === 0) {
      setNmck(null)
      return
    }

    let cancelled = false
    fetch('/api/nmck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prices,
        product_count: allProducts.length,
        source_count: new Set(allProducts.map(p => p.source)).size,
      }),
    })
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (cancelled || !data || data.status === 'no_data') return
        setNmck({
          total: data.product_count ?? allProducts.length,
          sources: data.source_count ?? 1,
          median: data.nmck != null ? Math.round(data.nmck) : null,
          min: Math.round(data.price_range_min ?? Math.min(...prices)),
          max: Math.round(data.price_range_max ?? Math.max(...prices)),
          outliers: data.outliers ?? 0,
          cv: data.max_deviation_pct ?? 0,
          cvOk: data.cv_ok === true,
          status: data.status,
          message: data.message,
          canCalculate: data.can_calculate_nmck === true,
        })
      })
      .catch(() => { if (!cancelled) setNmck(null) })

    return () => { cancelled = true }
  }, [allLoaded, allProducts])

  const showNmck = allLoaded && nmck?.canCalculate && nmck.median != null
  const showNmckWarning = allLoaded && nmck && !nmck.canCalculate && nmck.message

  return (
    <div style={{ minHeight: '100vh', background: '#F1F5F9' }}>

      {/* Шапка */}
      <header style={{
        background: '#0B1628',
        position: 'sticky', top: 0, zIndex: 40,
        borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto', padding: '0 24px',
          height: '60px', display: 'flex', alignItems: 'center', gap: '16px',
        }}>
          <button
            onClick={() => navigate('/')}
            aria-label="Назад"
            style={{
              fontFamily: 'inherit',
              width: '36px', height: '36px', borderRadius: '10px',
              border: '1px solid rgba(255,255,255,0.1)',
              background: 'rgba(255,255,255,0.05)',
              color: 'rgba(255,255,255,0.7)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              cursor: 'pointer', transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
          >
            <ArrowLeft size={18} strokeWidth={2} />
          </button>

          <div style={{ flex: 1, minWidth: 0 }}>
            <p style={{ color: '#FFFFFF', fontWeight: 700, fontSize: '15px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{query}</p>
            <p style={{ color: 'rgba(255,255,255,0.35)', fontSize: '12px', marginTop: '1px' }}>{region}</p>
          </div>

          {/* Dot-индикаторы источников */}
          <div style={{ display: 'flex', gap: '20px', flexShrink: 0 }}>
            {SOURCE_ORDER.map(src => {
              const m = SOURCE_META[src]
              const loaded = loadedSources.includes(src)
              return (
                <div key={src} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <div style={{
                    width: '7px', height: '7px', borderRadius: '50%',
                    background: loaded ? m.dot : 'rgba(255,255,255,0.15)',
                    transition: 'background 0.4s',
                    boxShadow: loaded ? `0 0 8px ${m.dot}80` : 'none',
                  }} />
                  <span style={{
                    fontSize: '12px', fontWeight: 600,
                    color: loaded ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.2)',
                    transition: 'color 0.4s',
                  }}>
                    {m.title}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </header>

      {correction && (
        <div style={{
          background: '#EFF6FF',
          borderBottom: '1px solid #BFDBFE',
          padding: '10px 24px',
          display: 'flex', alignItems: 'center', gap: '10px',
          fontSize: '13px', color: '#1E40AF',
        }}>
          <span style={{ opacity: 0.6 }}>✦</span>
          <span>
            Исправлено:{' '}
            <span style={{ fontWeight: 700, textDecoration: 'line-through', opacity: 0.55 }}>
              «{correction.original}»
            </span>
            {' → '}
            <span style={{ fontWeight: 700 }}>«{correction.corrected}»</span>
          </span>
        </div>
      )}

      <main style={{ maxWidth: '1400px', margin: '0 auto', padding: '32px 24px' }}>

        {SOURCE_ORDER.map(src => {
          const m        = SOURCE_META[src]
          const loaded   = loadedSources.includes(src)
          const products = allProducts.filter(p => p.source === src)

          return (
            <section key={src} style={{ marginBottom: '44px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px', paddingLeft: '24px' }}>
                <div style={{
                  width: '10px', height: '10px', borderRadius: '50%',
                  background: loaded ? m.dot : '#CBD5E1',
                  boxShadow: loaded ? `0 0 10px ${m.dot}60` : 'none',
                  transition: 'all 0.4s',
                }} />
                <h2 style={{
                  fontSize: '18px', fontWeight: 800, letterSpacing: '-0.01em',
                  color: loaded ? m.color : '#94A3B8',
                  transition: 'color 0.4s',
                }}>
                  {m.title}
                </h2>
                {loaded && products.length > 0 && (
                  <span style={{
                    padding: '3px 12px', borderRadius: '100px',
                    background: m.light, color: m.color,
                    fontSize: '12px', fontWeight: 700,
                  }}>
                    {products.length} {products.length === 1 ? 'товар' : products.length < 5 ? 'товара' : 'товаров'}
                  </span>
                )}
                {loaded && products.length === 0 && (
                  <span style={{ fontSize: '12px', color: '#94A3B8' }}>совпадений не найдено</span>
                )}
                {!loaded && (
                  <span style={{ fontSize: '12px', color: '#94A3B8', fontStyle: 'italic' }}>загружается…</span>
                )}
              </div>

              {!loaded ? (
                <div style={{ display: 'flex', gap: `${CARD_GAP}px`, padding: '4px 24px', overflow: 'hidden' }}>
                  {[...Array(4)].map((_, i) => (
                    <div key={i} style={{ minWidth: `${CARD_WIDTH}px`, flexShrink: 0 }}>
                      <SkeletonCard />
                    </div>
                  ))}
                </div>
              ) : products.length > 0 ? (
                <Carousel
                  products={products}
                  onDetails={(i) => setModalIndex(allProducts.findIndex(p => p.id === products[i].id))}
                />
              ) : null}
            </section>
          )
        })}

        {showNmckWarning && (
          <div
            style={{
              margin: '8px 0 24px',
              background: '#FFFBEB',
              border: '1px solid #FDE68A',
              borderRadius: '12px',
              padding: '16px 24px',
              fontSize: '14px',
              color: '#92400E',
              lineHeight: 1.5,
            }}
          >
            <strong>НМЦК не рассчитана.</strong> {nmck.message}
          </div>
        )}

        {showNmck && (
          <div style={{
            margin: '8px 0 44px',
            background: '#FFFFFF',
            borderRadius: '16px',
            border: '1px solid #E2E8F0',
            padding: '24px 32px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
            gap: '24px',
          }}>
            {[
              { label: 'Найдено товаров', value: `${nmck.total}`, sub: `из ${nmck.sources} источников` },
              { label: 'Медиана', value: `${nmck.median.toLocaleString('ru-RU')} ₽`, sub: 'рекомендованная НМЦК', accent: true },
              { label: 'Диапазон цен', value: `${nmck.min.toLocaleString('ru-RU')} — ${nmck.max.toLocaleString('ru-RU')} ₽`, sub: 'мин — макс' },
              { label: 'Отброшено выбросов', value: `${nmck.outliers}`, sub: 'по 44-ФЗ п.3.20' },
              { label: 'Отклонение от медианы', value: `${nmck.cv}%`, sub: nmck.cvOk ? '✓ в пределах 33%' : '⚠ разброс > 33%', warn: !nmck.cvOk },
              { label: 'Регион', value: region, sub: 'цены актуальны для региона' },
              ...(deliveryDays !== null ? [{
                label: 'Срок поставки',
                value: `${deliveryDays} дн.`,
                sub: deliveryDays >= 7 ? '✓ достаточно для закупки' : '⚠ менее недели — риск',
                warn: deliveryDays < 7,
              }] : []),
            ].map(({ label, value, sub, accent, warn }) => (
              <div key={label}>
                <p style={{ fontSize: '11px', fontWeight: 600, color: '#94A3B8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '6px' }}>{label}</p>
                <p style={{ fontSize: accent ? '22px' : '18px', fontWeight: 800, color: accent ? '#1D6ECA' : warn ? '#DC2626' : '#0F172A', lineHeight: 1.1 }}>{value}</p>
                <p style={{ fontSize: '12px', color: '#64748B', marginTop: '4px' }}>{sub}</p>
              </div>
            ))}
          </div>
        )}

        {!allLoaded && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', padding: '16px', color: '#94A3B8', fontSize: '14px' }}>
            <div style={{
              width: '16px', height: '16px', borderRadius: '50%',
              border: '2px solid #CBD5E1', borderTopColor: '#1D6ECA',
              animation: 'spin 0.8s linear infinite',
            }} />
            Ищем ещё источники...
            <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
          </div>
        )}

        {allLoaded && allProducts.length === 0 && (
          <div style={{
            display: 'flex', flexDirection: 'column', alignItems: 'center',
            justifyContent: 'center', padding: '80px 24px', textAlign: 'center',
          }}>
            <div style={{ fontSize: '48px', marginBottom: '20px', opacity: 0.25 }}>🔍</div>
            <p style={{ fontSize: '20px', fontWeight: 700, color: '#0F172A', marginBottom: '8px' }}>
              По запросу «{query}» ничего не найдено
            </p>
            <p style={{ fontSize: '14px', color: '#64748B', marginBottom: '28px', maxWidth: '360px', lineHeight: 1.6 }}>
              Попробуйте изменить формулировку — например, использовать более общее название товара или исправить опечатку.
            </p>
            <button
              onClick={() => navigate(`/?q=${encodeURIComponent(query)}`)}
              style={{
                padding: '12px 28px', borderRadius: '12px',
                background: '#1D6ECA', color: '#FFFFFF',
                fontSize: '14px', fontWeight: 700,
                border: 'none', cursor: 'pointer',
                transition: 'background 0.15s',
                fontFamily: 'inherit',
              }}
              onMouseEnter={e => e.currentTarget.style.background = '#1558A8'}
              onMouseLeave={e => e.currentTarget.style.background = '#1D6ECA'}
            >
              Уточнить запрос
            </button>
          </div>
        )}
      </main>

      {modalIndex !== null && (
        <ProductModal
          product={allProducts[modalIndex]}
          allProducts={allProducts}
          currentIndex={modalIndex}
          onClose={() => setModalIndex(null)}
          onNavigate={setModalIndex}
        />
      )}
    </div>
  )
}
