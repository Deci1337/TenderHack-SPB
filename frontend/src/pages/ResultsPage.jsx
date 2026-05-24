// Figma screen 53:117 — pixel-perfect
// Root: 1440×3078, bg #FFFFFF
// Content (Frame 64): x=80, y=131, w=1280
// Frame 46: column, gap=20px, w=1280
// Section header (Frame 53): row, center, gap=25px, padding=10px 0, 1280×80
//   name text: Open Sans SemiBold 600 40px #1A1A1A, lineHeight=52px
//   count text: Open Sans SemiBold 600 25px #264B82
// Card (Frame 64 component): column, center, gap=14px, padding=30px 30px 23px, 297×465, bg=#E7EEF7
//   image: 265×265, bg=#FFFFFF
//   Frame 68: column, gap=-4px, pb=10px, h=78
//     Frame 65: row, center, padding=6px, 266×45
//       price: Open Sans Regular 400 29px #1A1A1A, letterSpacing=3%
//       badge: 35×32 transparent
//     Frame 67: column, center, gap=20px, 266×37
//       name: Open Sans Regular 400 20px #575757, 254×33
//   Frame 69 (btn): column, center, padding=10px, 266×41, bg=#FFFFFF
//     "Подробнее": Open Sans SemiBold 600 25px #264B82, 144×37

import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, useNavigate } from 'react-router-dom'
import ProductCard from '../components/ProductCard'
import ProductModal from '../components/ProductModal'
import SkeletonCard from '../components/SkeletonCard'

// Figma node I56:143;56:137 — search icon 24×24
function IconSearch24() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}>
      <circle cx="11" cy="11" r="8" stroke="#264B82" strokeWidth="2"/>
      <path d="M17 17L21 21" stroke="#264B82" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}
// Figma node I63:1428;63:646 — location icon 24×24
function IconLocation24() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}>
      <path d="M4.03702 4.6879C3.99755 4.59682 3.98638 4.49597 4.00496 4.39846C4.02354 4.30094 4.07101 4.21127 4.1412 4.14108C4.21139 4.07088 4.30107 4.02342 4.39858 4.00484C4.49609 3.98626 4.59694 3.99743 4.68802 4.0369L20.688 10.5369C20.7853 10.5765 20.8676 10.6458 20.9233 10.7349C20.979 10.824 21.0052 10.9283 20.9983 11.0331C20.9913 11.138 20.9515 11.2379 20.8845 11.3188C20.8175 11.3997 20.7267 11.4575 20.625 11.4839L14.501 13.0639C14.155 13.1529 13.8391 13.3329 13.5863 13.5852C13.3334 13.8376 13.1527 14.1531 13.063 14.4989L11.484 20.6249C11.4576 20.7266 11.3999 20.8174 11.319 20.8844C11.238 20.9514 11.1381 20.9912 11.0333 20.9981C10.9284 21.0051 10.8241 20.9789 10.735 20.9232C10.6459 20.8675 10.5767 20.7852 10.537 20.6879L4.03702 4.6879Z" stroke="#264B82" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}
// Figma node I78:691;70:669 — price icon 24×24
function IconPrice24() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" style={{flexShrink:0}}>
      <path d="M10 26.25H12.5V21.25H20V18.75H12.5V16.25H18.75C22.2 16.25 25 13.45 25 10C25 6.55 22.2 3.75 18.75 3.75H11.25C10.5625 3.75 10 4.3125 10 5V13.75H5V16.25H10V18.75H5V21.25H10V26.25ZM12.5 6.25H18.75C20.8125 6.25 22.5 7.9375 22.5 10C22.5 12.0625 20.8125 13.75 18.75 13.75H12.5V6.25Z" fill="#264B82" transform="scale(0.8) translate(0,0)"/>
    </svg>
  )
}

const REGIONS = ['Москва', 'Казань', 'Санкт-Петербург', 'Екатеринбург', 'Новосибирск', 'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону']

const SOURCE_ORDER = ['wildberries', 'ozon', 'yandex_market', 'runet']
const SOURCE_META = {
  wildberries:   { title: 'Wildberries' },
  ozon:          { title: 'Ozon' },
  yandex_market: { title: 'Яндекс Маркет' },
  runet:         { title: 'Другие источники' },
}
const SOURCE_DELAYS = { wildberries: 800, ozon: 2200, yandex_market: 3800, runet: 5000 }

// card x positions: 0, 328, 655, 983 → gap = 328-297 = 31px
const CARD_W = 297
const CARD_GAP = 31

function plural(n) {
  if (n % 100 >= 11 && n % 100 <= 14) return 'товаров'
  const r = n % 10
  if (r === 1) return 'товар'
  if (r >= 2 && r <= 4) return 'товара'
  return 'товаров'
}

function Carousel({ products, onDetails }) {
  const ref = useRef(null)
  const [canL, setCanL] = useState(false)
  const [canR, setCanR] = useState(false)

  const check = () => {
    const el = ref.current
    if (!el) return
    setCanL(el.scrollLeft > 2)
    setCanR(el.scrollLeft + el.clientWidth < el.scrollWidth - 2)
  }

  useEffect(() => {
    const el = ref.current
    if (!el) return
    check()
    el.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    return () => { el.removeEventListener('scroll', check); window.removeEventListener('resize', check) }
  }, [products])

  const scroll = d => ref.current?.scrollBy({ left: d * (CARD_W + CARD_GAP) * 3, behavior: 'smooth' })

  const arrowStyle = (side) => ({
    position: 'absolute', [side]: '-20px', top: '50%', transform: 'translateY(-50%)',
    zIndex: 10, width: '36px', height: '36px', borderRadius: '50%',
    background: '#FFFFFF', border: '1px solid #D4DBE6',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: 'pointer', fontFamily: 'inherit', flexShrink: 0,
    boxShadow: '0 2px 8px rgba(0,0,0,0.1)',
  })

  return (
    <div style={{ position: 'relative' }}>
      {canL && (
        <button onClick={() => scroll(-1)} style={arrowStyle('left')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M15 18L9 12L15 6" stroke="#264B82" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
      <div ref={ref} style={{
        display: 'flex', gap: `${CARD_GAP}px`,
        overflowX: 'auto', scrollbarWidth: 'none', msOverflowStyle: 'none',
      }}>
        <style>{`.scroll-hide::-webkit-scrollbar{display:none}`}</style>
        {products.map((p, i) => (
          <ProductCard key={p.id} product={p} onDetails={() => onDetails(i)} />
        ))}
      </div>
      {canR && (
        <button onClick={() => scroll(1)} style={arrowStyle('right')}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
            <path d="M9 18L15 12L9 6" stroke="#264B82" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      )}
    </div>
  )
}

export default function ResultsPage() {
  const [searchParams] = useSearchParams()
  const navigate = useNavigate()
  const query    = searchParams.get('q') || ''
  const region   = searchParams.get('region') || 'Москва'
  const priceFrom = parseFloat(searchParams.get('priceFrom')) || null
  const priceTo   = parseFloat(searchParams.get('priceTo')) || null

  // Search bar state (for re-search)
  const [searchQuery, setSearchQuery] = useState(query)
  const [searchRegion, setSearchRegion] = useState(region)
  const [searchPriceFrom, setSearchPriceFrom] = useState(searchParams.get('priceFrom') || '')
  const [searchPriceTo, setSearchPriceTo] = useState(searchParams.get('priceTo') || '')
  const [showRegion, setShowRegion] = useState(false)
  const regionRef = useRef(null)

  const [loaded, setLoaded]   = useState([])
  const [srcData, setSrcData] = useState({})
  const [modal, setModal]     = useState(null)
  const [correction, setCorr] = useState(null)

  useEffect(() => {
    const h = e => { if (regionRef.current && !regionRef.current.contains(e.target)) setShowRegion(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const goSearch = (q = searchQuery) => {
    if (!q.trim()) return
    const p = new URLSearchParams({ q, region: searchRegion })
    if (searchPriceFrom) p.set('priceFrom', searchPriceFrom)
    if (searchPriceTo)   p.set('priceTo', searchPriceTo)
    navigate(`/results?${p}`)
  }

  useEffect(() => {
    fetch(`/api/correct?q=${encodeURIComponent(query)}`)
      .then(r => r.json()).then(d => { if (d.changed) setCorr(d) }).catch(() => {})
  }, [query])

  useEffect(() => {
    setLoaded([]); setSrcData({})
    const q = encodeURIComponent(query)
    const r = encodeURIComponent(region)
    const fetch_ = async (src, path, delay) => {
      await new Promise(res => setTimeout(res, delay))
      try {
        const res = await fetch(`${path}?q=${q}&region=${r}`)
        if (res.ok) {
          const data = await res.json()
          const products = (data.products ?? data).map((p, i) => ({
            ...p, id: p.id ?? `${src}_${i}`, source: p.source ?? src,
          }))
          setSrcData(prev => ({ ...prev, [src]: products }))
        }
      } catch {}
      finally { setLoaded(prev => [...prev, src]) }
    }
    fetch_('wildberries',   '/api/search/wildberries',   SOURCE_DELAYS.wildberries)
    fetch_('ozon',          '/api/search/ozon',          SOURCE_DELAYS.ozon)
    fetch_('yandex_market', '/api/search/yandex_market', SOURCE_DELAYS.yandex_market)
    fetch_('runet',         '/api/search/runet',         SOURCE_DELAYS.runet)
    const timers = SOURCE_ORDER.map(src =>
      setTimeout(() => setLoaded(prev => prev.includes(src) ? prev : [...prev, src]), SOURCE_DELAYS[src] + 55000))
    return () => timers.forEach(clearTimeout)
  }, [query, region])

  const allProducts = useMemo(() => {
    return SOURCE_ORDER
      .filter(src => loaded.includes(src))
      .flatMap(src => srcData[src] ?? [])
      .filter(p => {
        if (priceFrom && p.price < priceFrom) return false
        if (priceTo && p.price > priceTo) return false
        return true
      })
  }, [loaded, srcData, priceFrom, priceTo])

  const allLoaded = loaded.length === SOURCE_ORDER.length

  return (
    // Root: bg #FFFFFF, font Open Sans
    <div style={{ minHeight: '100vh', background: '#FFFFFF', fontFamily: "'Open Sans', sans-serif" }}>

      {/* Figma: image 2 (63:1287) — 255×84 at x=0,y=0, IMAGE fill (header logo) */}
      <div style={{ position: 'relative', width: '100%', background: '#FFFFFF' }}>
        <img
          src="/header-logo.png"
          alt=""
          style={{ width: '255px', height: '84px', objectFit: 'fill', display: 'block' }}
        />
        {/* Back button overlay */}
        <button
          onClick={() => navigate('/')}
          style={{
            position: 'absolute', top: '50%', right: '80px', transform: 'translateY(-50%)',
            background: 'none', border: 'none', cursor: 'pointer',
            fontFamily: "'Open Sans', sans-serif",
            fontWeight: 400, fontSize: '20px', color: '#264B82',
            display: 'flex', alignItems: 'center', gap: '8px',
          }}
          onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
          onMouseLeave={e => e.currentTarget.style.opacity = '1'}
        >
          ← Назад
        </button>
      </div>

      {/* Figma Frame 64: x=80, y=131, w=1280 */}
      <div style={{ width: '1280px', margin: '0 auto', paddingTop: '47px' }}>

        {/* Figma Frame 46: column, gap=20px, w=1280 */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '20px', width: '1280px' }}>

          {/* Figma: Поиск товара (layout_ZQK83G): row, center, fill, padding 10px 20px, gap 10px, fill #E7EEF7 */}
          <div style={{
            display: 'flex', flexDirection: 'row', alignItems: 'center',
            gap: '10px', padding: '10px 20px',
            background: '#E7EEF7',
            width: '100%', boxSizing: 'border-box',
            position: 'relative',
          }}>
            <IconSearch24 />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && goSearch()}
              placeholder="Поиск товара"
              style={{
                flex: 1, border: 'none', background: 'transparent',
                fontFamily: "'Open Sans', sans-serif",
                fontWeight: 400, fontSize: '20px', color: '#264B82',
                lineHeight: '24px',
                outline: 'none', minWidth: 0,
              }}
            />
            <button
              onClick={() => goSearch()}
              style={{
                background: '#264B82', border: 'none', borderRadius: '8px',
                padding: '6px 20px', color: '#FFFFFF',
                fontFamily: "'Open Sans', sans-serif",
                fontWeight: 600, fontSize: '18px',
                cursor: 'pointer', flexShrink: 0,
                height: '36px', display: 'flex', alignItems: 'center',
              }}
              onMouseEnter={e => e.currentTarget.style.opacity='0.85'}
              onMouseLeave={e => e.currentTarget.style.opacity='1'}
            >
              Найти
            </button>
          </div>

          {/* Figma: correction banner */}
          {correction && (
            <div style={{
              fontFamily: "'Open Sans', sans-serif",
              fontWeight: 400, fontSize: '16px', color: '#000000',
            }}>
              *Исправлено с «{correction.original}» на «{correction.corrected}»
            </div>
          )}

          {/* Figma: Frame 45 (layout_3E6JPL): row, center, fill, gap 20px, radius 10px — регион + цена */}
          <div style={{
            display: 'flex', flexDirection: 'row', alignItems: 'center',
            gap: '20px', width: '100%', boxSizing: 'border-box',
          }}>
            {/* Выбор региона (layout_X2YRVL): row, center, fill, padding 10px 20px, h 45, fill #E7EEF7 */}
            <div ref={regionRef} style={{ position: 'relative', flex: 1 }}>
              <div
                onClick={() => setShowRegion(v => !v)}
                style={{
                  display: 'flex', flexDirection: 'row', alignItems: 'center',
                  gap: '10px', padding: '10px 20px',
                  background: '#E7EEF7', height: '45px', boxSizing: 'border-box',
                  cursor: 'pointer', width: '100%',
                }}
                onMouseEnter={e => e.currentTarget.style.background='#D4DBE6'}
                onMouseLeave={e => e.currentTarget.style.background='#E7EEF7'}
              >
                <IconLocation24 />
                <span style={{
                  fontFamily: "'Open Sans', sans-serif",
                  fontWeight: 400, fontSize: '20px', color: '#264B82',
                  lineHeight: '24px', flex: 1,
                }}>
                  {searchRegion}
                </span>
              </div>
              {showRegion && (
                <div style={{
                  position: 'absolute', top: 'calc(100% + 2px)', left: 0,
                  minWidth: '100%', background: '#FFFFFF',
                  border: '1px solid #D4DBE6', borderRadius: '8px',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
                  zIndex: 100, overflow: 'hidden',
                }}>
                  {REGIONS.map((r, i) => (
                    <div
                      key={r}
                      onMouseDown={() => { setSearchRegion(r); setShowRegion(false) }}
                      style={{
                        padding: '8px 20px',
                        fontFamily: "'Open Sans', sans-serif",
                        fontWeight: 400, fontSize: '18px', color: '#264B82',
                        cursor: 'pointer',
                        borderBottom: i < REGIONS.length-1 ? '1px solid #D4DBE6' : 'none',
                        background: r===searchRegion ? '#E7EEF7' : '#FFFFFF',
                      }}
                      onMouseEnter={e => e.currentTarget.style.background='#E7EEF7'}
                      onMouseLeave={e => e.currentTarget.style.background=r===searchRegion?'#E7EEF7':'#FFFFFF'}
                    >
                      {r}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Цена (layout_YGA6H5): row, center, padding 10px 20px, 414×45, fill #E7EEF7 */}
            <div style={{
              display: 'flex', flexDirection: 'row', alignItems: 'center',
              gap: '10px', padding: '10px 20px',
              background: '#E7EEF7',
              width: '414px', height: '45px', boxSizing: 'border-box',
              flexShrink: 0,
            }}>
              <IconPrice24 />
              <span style={{
                fontFamily: "'Open Sans', sans-serif",
                fontWeight: 400, fontSize: '20px', color: '#264B82',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>Цена от</span>
              <input
                type="number"
                value={searchPriceFrom}
                onChange={e => setSearchPriceFrom(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && goSearch()}
                placeholder="от"
                style={{
                  width: '70px', height: '25px',
                  border: '1px solid #264B82', borderRadius: '6px',
                  background: 'transparent', padding: '0 8px',
                  fontFamily: "'Open Sans', sans-serif",
                  fontWeight: 400, fontSize: '18px', color: '#1A1A1A',
                  outline: 'none', boxSizing: 'border-box', flexShrink: 0,
                }}
              />
              <span style={{
                fontFamily: "'Open Sans', sans-serif",
                fontWeight: 400, fontSize: '20px', color: '#264B82',
                whiteSpace: 'nowrap', flexShrink: 0,
              }}>до</span>
              <input
                type="number"
                value={searchPriceTo}
                onChange={e => setSearchPriceTo(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && goSearch()}
                placeholder="до"
                style={{
                  width: '70px', height: '25px',
                  border: '1px solid #264B82', borderRadius: '6px',
                  background: 'transparent', padding: '0 8px',
                  fontFamily: "'Open Sans', sans-serif",
                  fontWeight: 400, fontSize: '18px', color: '#1A1A1A',
                  outline: 'none', boxSizing: 'border-box', flexShrink: 0,
                }}
              />
            </div>
          </div>

          {SOURCE_ORDER.map(src => {
            const m        = SOURCE_META[src]
            const isLoaded = loaded.includes(src)
            const products = allProducts.filter(p => p.source === src)
            const count    = products.length

            return (
              <div key={src}>
                {/* Figma Frame 53 (header): row, center, gap=25px, padding=10px 0, 1280×80 */}
                <div style={{
                  display: 'flex', flexDirection: 'row',
                  alignItems: 'center', gap: '25px',
                  padding: '10px 0px',
                  width: '1280px', height: '80px',
                  boxSizing: 'border-box',
                }}>
                  {/* Source name: Open Sans SemiBold 600 40px #1A1A1A, lineHeight=52px */}
                  <span style={{
                    fontFamily: "'Open Sans', sans-serif",
                    fontWeight: 600, fontSize: '40px',
                    lineHeight: '52px', color: '#1A1A1A',
                    opacity: isLoaded ? 1 : 0.35,
                    transition: 'opacity 0.4s',
                    display: 'block',
                  }}>
                    {m.title}
                  </span>

                  {/* Count badge (Frame 60): 232×60, text SemiBold 600 25px #264B82 */}
                  {isLoaded && count > 0 && (
                    <div style={{ width: '232px', height: '60px', display: 'flex', alignItems: 'center' }}>
                      <span style={{
                        fontFamily: "'Open Sans', sans-serif",
                        fontWeight: 600, fontSize: '25px', color: '#264B82',
                        lineHeight: '34px', display: 'block',
                      }}>
                        {count} {plural(count)}
                      </span>
                    </div>
                  )}
                  {!isLoaded && (
                    <span style={{
                      fontFamily: "'Open Sans', sans-serif",
                      fontWeight: 400, fontSize: '20px', color: '#575757',
                    }}>
                      загружается…
                    </span>
                  )}
                  {isLoaded && count === 0 && (
                    <span style={{
                      fontFamily: "'Open Sans', sans-serif",
                      fontWeight: 400, fontSize: '20px', color: '#575757',
                    }}>
                      нет результатов
                    </span>
                  )}
                </div>

                {/* Cards row — y=103 offset from section start in Figma */}
                <div style={{ marginTop: '0' }}>
                  {!isLoaded ? (
                    <div style={{ display: 'flex', gap: `${CARD_GAP}px` }}>
                      {[...Array(4)].map((_, i) => <SkeletonCard key={i} />)}
                    </div>
                  ) : count > 0 ? (
                    <Carousel
                      products={products}
                      onDetails={i => setModal(allProducts.findIndex(p => p.id === products[i].id))}
                    />
                  ) : null}
                </div>
              </div>
            )
          })}

          {/* Rectangle 2 — divider: 1440×80, transparent (just spacing) */}
          {!allLoaded && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: '10px',
              fontFamily: "'Open Sans', sans-serif",
              fontWeight: 400, fontSize: '20px', color: '#575757',
              padding: '20px 0',
            }}>
              <span style={{
                display: 'inline-block', width: '16px', height: '16px', borderRadius: '50%',
                border: '2px solid #D4DBE6', borderTopColor: '#264B82',
                animation: 'spin 0.8s linear infinite', flexShrink: 0,
              }} />
              Ищём ещё источники…
            </div>
          )}

          {allLoaded && allProducts.length === 0 && (
            <div style={{ padding: '80px 0', textAlign: 'left' }}>
              <span style={{
                fontFamily: "'Open Sans', sans-serif",
                fontWeight: 600, fontSize: '40px', lineHeight: '52px', color: '#1A1A1A',
                display: 'block', marginBottom: '20px',
              }}>
                По запросу «{query}» ничего не найдено
              </span>
              <button
                onClick={() => navigate(`/?q=${encodeURIComponent(query)}`)}
                style={{
                  padding: '10px',
                  width: '266px', height: '41px',
                  background: '#FFFFFF',
                  border: 'none', cursor: 'pointer',
                  fontFamily: "'Open Sans', sans-serif",
                  fontWeight: 600, fontSize: '25px', color: '#264B82',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity = '0.7'}
                onMouseLeave={e => e.currentTarget.style.opacity = '1'}
              >
                Уточнить запрос
              </button>
            </div>
          )}
        </div>
      </div>

      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>

      {modal !== null && (
        <ProductModal
          product={allProducts[modal]}
          allProducts={allProducts}
          currentIndex={modal}
          onClose={() => setModal(null)}
          onNavigate={setModal}
        />
      )}
    </div>
  )
}
