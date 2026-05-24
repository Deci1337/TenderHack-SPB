// Figma screen 82:1299 (79:701) — pixel-perfect
// Root: 1440×900, bg #FEFEFF, column, alignItems center, padding 38px 80px
// Search section (80:1166): column, gap 24px, padding 32px, height 311
//   shadow: 0px 4px 24px 0px rgba(38,75,130,1), radius 20px
// Title: Bold 700 40px #264B82
// Frame 107 (T6RJB2): column, gap 24px, 1143×135
//   Frame 102 (SE6WC3): column, alignSelf stretch, gap 12px
//     Frame 98 (1BKR3V): row, center, fill, padding 8px, gap 12px, bg #E7EEF7
//       Icon 30×30, input SemiBold 600 24px #264B82
//     Frame 101 (7LTOK6): row, center, fill, padding 8px 0px, gap 12px
//       Frame 100 (W74ZK9): row, center, fill, padding 10px, gap 16px, border 1px #264B82, radius 12
//         Icon 30×30, text SemiBold 600 24px #264B82
//       Frame 101 (W74ZK9): row, center, fill, padding 10px, gap 16px, border 1px #264B82, radius 12
//         Icon 30×30, "Цена от" SemiBold 600 24px #264B82
//         Frame 103 (YK1LO8): column center+stretch, gap 10px, padding 0 29px, 100×34, border 1px #264B82, radius 12
//           "900" Regular 400 24px #1A1A1A
//         "до" SemiBold 600 24px #264B82
//         Frame 104: same as 103
// Frame 125 (KIQ4AB): column, center, 1144, hug
//   "Источники:" SemiBold 600 32px #264B82, 189×35
//   Frame 105 (P6UPXS): row, center, gap 24px, padding 32px 0px, 1144×112
//     Chip wrapper (UAV4D4/S9P9XD): column, center+stretch, gap 8px, padding 22px 5px, 268/266×99
//       Frame 109 (3C9WOT): column, center, fill, gap 10px, padding 30px 10px, h64, radius 12
//         text (7YOIDW): SemiBold 600 24px, width 183, selected:#FFF / unselected:#264B82

import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchSuggestions } from '../api/suggest'

// Figma node I82:1300;80:1147 — search icon 30×30, fill_FNKPM0 (transparent stroke #264B82)
function IconSearch() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" style={{flexShrink:0}}>
      <circle cx="13.75" cy="13.75" r="10" stroke="#264B82" strokeWidth="2"/>
      <path d="M21.25 21.25L26.25 26.25" stroke="#264B82" strokeWidth="2" strokeLinecap="round"/>
    </svg>
  )
}

// Figma node I82:1300;80:1153 — location icon 30×30
function IconLocation() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" style={{flexShrink:0}}>
      <path d="M5.04625 5.85987C4.99691 5.74602 4.98295 5.61996 5.00617 5.49807C5.02939 5.37618 5.08873 5.26409 5.17647 5.17635C5.26421 5.0886 5.3763 5.02927 5.49819 5.00605C5.62008 4.98283 5.74614 4.99679 5.86 5.04612L25.86 13.1711C25.9816 13.2207 26.0845 13.3073 26.1541 13.4186C26.2237 13.5299 26.2565 13.6604 26.2478 13.7914C26.2391 13.9224 26.1893 14.0474 26.1056 14.1485C26.0218 14.2497 25.9083 14.3219 25.7812 14.3549L18.1262 16.3299C17.6937 16.4411 17.2989 16.6661 16.9828 16.9815C16.6667 17.297 16.4408 17.6913 16.3287 18.1236L14.355 25.7811C14.322 25.9082 14.2498 26.0217 14.1487 26.1055C14.0475 26.1892 13.9226 26.239 13.7915 26.2477C13.6605 26.2564 13.5301 26.2236 13.4187 26.154C13.3074 26.0844 13.2208 25.9815 13.1712 25.8599L5.04625 5.85987Z" stroke="#264B82" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

// Figma node I82:1300;80:1157 — price icon 30×30
function IconPrice() {
  return (
    <svg width="30" height="30" viewBox="0 0 30 30" fill="none" style={{flexShrink:0}}>
      <path d="M10 26.25H12.5V21.25H20V18.75H12.5V16.25H18.75C22.2 16.25 25 13.45 25 10C25 6.55 22.2 3.75 18.75 3.75H11.25C10.5625 3.75 10 4.3125 10 5V13.75H5V16.25H10V18.75H5V21.25H10V26.25ZM12.5 6.25H18.75C20.8125 6.25 22.5 7.9375 22.5 10C22.5 12.0625 20.8125 13.75 18.75 13.75H12.5V6.25Z" fill="#264B82"/>
    </svg>
  )
}

const REGIONS = ['Москва', 'Казань', 'Санкт-Петербург', 'Екатеринбург', 'Новосибирск', 'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону']

const CHIPS = [
  { label: 'Яндекс Маркет', w: 268 },
  { label: 'Wildberries',   w: 266 },
  { label: 'Ozon',          w: 266 },
  { label: 'Другое',        w: 268 },
]

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const [query, setQuery]       = useState(searchParams.get('q') || '')
  const [region, setRegion]     = useState('Москва')
  const [showRegion, setShowRegion] = useState(false)
  const [priceFrom, setPriceFrom] = useState('')
  const [priceTo, setPriceTo]     = useState('')
  // Figma: Яндекс Маркет и Ozon выбраны (fill #264B82), Wildberries — нет (fill #E7EEF7)
  const [sources, setSources] = useState(['Яндекс Маркет', 'Ozon', 'Другое'])
  const [hints, setHints]     = useState([])
  const [showHints, setShowHints] = useState(false)
  const regionRef = useRef(null)
  const navigate  = useNavigate()

  useEffect(() => {
    let cancel = false
    if (query.trim()) fetchSuggestions(query, 7).then(r => { if (!cancel) setHints(r) })
    else setHints([])
    return () => { cancel = true }
  }, [query])

  useEffect(() => {
    const h = e => { if (regionRef.current && !regionRef.current.contains(e.target)) setShowRegion(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  const go = (q = query) => {
    if (!q.trim()) return
    const p = new URLSearchParams({ q, region })
    if (priceFrom) p.set('priceFrom', priceFrom)
    if (priceTo)   p.set('priceTo', priceTo)
    navigate(`/results?${p}`)
  }

  const toggleSrc = s => setSources(prev => prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s])

  // layout_NZBFLS: column, alignItems center, padding 38px 80px, 1440×900, bg #FEFEFF
  return (
    <div style={{
      minHeight: '100vh',
      background: '#FEFEFF',
      fontFamily: "'Open Sans', sans-serif",
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      padding: '38px 80px',
      boxSizing: 'border-box',
    }}>

      {/* Search section (80:1166 instance):
          layout_XRXXP7: column, gap 24px, padding 32px, height 311, hug horizontal
          effect_RLE9OJ: box-shadow 0px 4px 24px 0px rgba(38,75,130,1)
          borderRadius: 20px */}
      <div style={{
        width: '100%',
        maxWidth: '1280px',
        borderRadius: '20px',
        boxShadow: '0px 4px 24px 0px rgba(38, 75, 130, 1)',
        padding: '32px',
        display: 'flex',
        flexDirection: 'column',
        gap: '24px',
        boxSizing: 'border-box',
      }}>

        {/* style_E1A8Z1: Bold 700 40px, fill_XAPH4O = #264B82 */}
        <span style={{
          fontFamily: "'Open Sans', sans-serif",
          fontWeight: 700,
          fontSize: '40px',
          color: '#264B82',
          lineHeight: '1.3',
          display: 'block',
        }}>
          Найдите нужные товары в открытых источниках
        </span>

        {/* Frame 107 (layout_T6RJB2): column, gap 24px, 1143×135 */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          width: '100%',
        }}>

          {/* Frame 102 (layout_SE6WC3): column, alignSelf stretch, gap 12px */}
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '12px',
            width: '100%',
          }}>

            {/* Frame 98 (layout_1BKR3V): row, center, fill, padding 8px, gap 12px, fill #E7EEF7 */}
            <div style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '12px',
              padding: '8px',
              background: '#E7EEF7',
              width: '100%',
              boxSizing: 'border-box',
              position: 'relative',
            }}>
              {/* layout_5R17N4: 30×30 */}
              <IconSearch />

              {/* style_18LWOF: SemiBold 600 24px, fill_XAPH4O = #264B82 */}
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                onFocus={() => setShowHints(true)}
                onBlur={() => setTimeout(() => setShowHints(false), 150)}
                onKeyDown={e => e.key === 'Enter' && go()}
                placeholder="Поиск"
                style={{
                  flex: 1,
                  border: 'none',
                  background: 'transparent',
                  fontFamily: "'Open Sans', sans-serif",
                  fontWeight: 600,
                  fontSize: '24px',
                  color: '#264B82',
                  outline: 'none',
                  minWidth: 0,
                }}
              />

              {/* Кнопка поиска — Enter иконка справа в поле */}
              <button
                onClick={() => go()}
                style={{
                  background: '#264B82',
                  border: 'none',
                  borderRadius: '8px',
                  padding: '6px 20px',
                  color: '#FFFFFF',
                  fontFamily: "'Open Sans', sans-serif",
                  fontWeight: 600,
                  fontSize: '20px',
                  cursor: 'pointer',
                  flexShrink: 0,
                  height: '40px',
                  display: 'flex',
                  alignItems: 'center',
                }}
                onMouseEnter={e => e.currentTarget.style.opacity='0.85'}
                onMouseLeave={e => e.currentTarget.style.opacity='1'}
              >
                Найти
              </button>

              {/* Autocomplete dropdown */}
              {showHints && hints.length > 0 && (
                <ul style={{
                  position: 'absolute', top: 'calc(100% + 4px)', left: 0, right: 0,
                  background: '#FFFFFF',
                  border: '1px solid #D4DBE6',
                  borderRadius: '12px',
                  boxShadow: '10px 10px 5.3px 0px rgba(0,0,0,0.25)',
                  zIndex: 100, overflow: 'hidden', listStyle: 'none', margin: 0, padding: 0,
                }}>
                  {hints.map((group, gi) => (
                    <li key={group.category}>
                      {gi > 0 && <div style={{height:'1px',background:'#D4DBE6'}}/>}
                      {group.items.map((item, ii) => (
                        <div
                          key={ii}
                          onMouseDown={() => { setQuery(item); setShowHints(false); go(item) }}
                          style={{
                            padding: '10px 20px',
                            fontFamily: "'Open Sans', sans-serif",
                            fontWeight: 400, fontSize: '20px', color: '#264B82',
                            cursor: 'pointer',
                            borderBottom: ii < group.items.length-1 ? '1px solid #D4DBE6' : 'none',
                          }}
                          onMouseEnter={e => e.currentTarget.style.background='#E7EEF7'}
                          onMouseLeave={e => e.currentTarget.style.background='transparent'}
                        >
                          {item}
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Frame 101 (layout_7LTOK6): row, center, fill, padding 8px 0px, gap 12px */}
            <div style={{
              display: 'flex',
              flexDirection: 'row',
              alignItems: 'center',
              gap: '12px',
              padding: '8px 0px',
              width: '100%',
              boxSizing: 'border-box',
            }}>

              {/* Frame 100 (layout_W74ZK9): row, center, fill, padding 10px, gap 16px
                  strokes fill_XAPH4O = #264B82, 1px, radius 12px */}
              <div ref={regionRef} style={{position:'relative', flex:1}}>
                <div
                  onClick={() => setShowRegion(v => !v)}
                  style={{
                    display: 'flex',
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: '16px',
                    padding: '10px',
                    border: '1px solid #264B82',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                    width: '100%',
                  }}
                  onMouseEnter={e => e.currentTarget.style.background='rgba(38,75,130,0.05)'}
                  onMouseLeave={e => e.currentTarget.style.background='transparent'}
                >
                  <IconLocation />
                  <span style={{
                    fontFamily: "'Open Sans', sans-serif",
                    fontWeight: 600, fontSize: '24px', color: '#264B82', flex: 1,
                  }}>
                    {region || 'Введите регион'}
                  </span>
                </div>
                {showRegion && (
                  <div style={{
                    position: 'absolute', top: 'calc(100% + 4px)', left: 0,
                    minWidth: '100%',
                    background: '#FFFFFF',
                    borderRadius: '12px',
                    border: '1px solid #D4DBE6',
                    boxShadow: '10px 10px 5.3px 0px rgba(0,0,0,0.25)',
                    zIndex: 100, overflow: 'hidden',
                  }}>
                    {REGIONS.map((r, i) => (
                      <div
                        key={r}
                        onMouseDown={() => { setRegion(r); setShowRegion(false) }}
                        style={{
                          padding: '10px 20px',
                          fontFamily: "'Open Sans', sans-serif",
                          fontWeight: 400, fontSize: '20px', color: '#264B82',
                          cursor: 'pointer',
                          borderBottom: i < REGIONS.length-1 ? '1px solid #D4DBE6' : 'none',
                          background: r===region ? '#E7EEF7' : '#FFFFFF',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background='#E7EEF7'}
                        onMouseLeave={e => e.currentTarget.style.background=r===region?'#E7EEF7':'#FFFFFF'}
                      >
                        {r}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Frame 101/price (layout_W74ZK9): row, center, fill, padding 10px, gap 16px
                  strokes #264B82 1px, radius 12px */}
              <div style={{
                display: 'flex',
                flexDirection: 'row',
                alignItems: 'center',
                gap: '16px',
                padding: '10px',
                border: '1px solid #264B82',
                borderRadius: '12px',
                flex: 1,
                boxSizing: 'border-box',
              }}>
                <IconPrice />
                {/* "Цена от": style_18LWOF SemiBold 600 24px #264B82 */}
                <span style={{
                  fontFamily: "'Open Sans', sans-serif",
                  fontWeight: 600, fontSize: '24px', color: '#264B82',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  Цена от
                </span>
                {/* Frame 103 (layout_YK1LO8): column center+stretch, padding 0 29px, 100×34, border #264B82 1px, radius 12 */}
                <input
                  type="number"
                  value={priceFrom}
                  onChange={e => setPriceFrom(e.target.value)}
                  placeholder="900"
                  style={{
                    width: '100px', height: '34px',
                    padding: '0 29px',
                    borderRadius: '12px',
                    border: '1px solid #264B82',
                    background: 'transparent',
                    fontFamily: "'Open Sans', sans-serif",
                    fontWeight: 400, fontSize: '24px', color: '#1A1A1A',
                    outline: 'none',
                    boxSizing: 'border-box',
                    flexShrink: 0,
                    textAlign: 'center',
                  }}
                />
                {/* "до": style_18LWOF */}
                <span style={{
                  fontFamily: "'Open Sans', sans-serif",
                  fontWeight: 600, fontSize: '24px', color: '#264B82',
                  whiteSpace: 'nowrap', flexShrink: 0,
                }}>
                  до
                </span>
                {/* Frame 104 (layout_YK1LO8) */}
                <input
                  type="number"
                  value={priceTo}
                  onChange={e => setPriceTo(e.target.value)}
                  placeholder="10000"
                  style={{
                    width: '100px', height: '34px',
                    padding: '0 29px',
                    borderRadius: '12px',
                    border: '1px solid #264B82',
                    background: 'transparent',
                    fontFamily: "'Open Sans', sans-serif",
                    fontWeight: 400, fontSize: '24px', color: '#1A1A1A',
                    outline: 'none',
                    boxSizing: 'border-box',
                    flexShrink: 0,
                    textAlign: 'center',
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Frame 125 (layout_KIQ4AB): column, center, width 1144, hug */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          width: '100%',
        }}>
          {/* "Источники:" style_HCR1NS: SemiBold 600 32px #264B82, 189×35 */}
          <span style={{
            fontFamily: "'Open Sans', sans-serif",
            fontWeight: 600, fontSize: '32px', color: '#264B82',
            display: 'block',
            width: '189px',
            height: '35px',
            lineHeight: '35px',
            flexShrink: 0,
          }}>
            Источники:
          </span>

          {/* Frame 105 (layout_P6UPXS): row, center, gap 24px, padding 32px 0px, height 112 */}
          <div style={{
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'center',
            gap: '24px',
            padding: '32px 0px',
            height: '112px',
            boxSizing: 'border-box',
          }}>
            {CHIPS.map(({ label, w }) => {
              const active = sources.includes(label)
              return (
                /* Chip wrapper (UAV4D4 for 268w, S9P9XD for 266w):
                   column, center+stretch, gap 8px, padding 22px 5px, h99, radius 12 */
                <div
                  key={label}
                  onClick={() => toggleSrc(label)}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'center',
                    alignItems: 'stretch',
                    gap: '8px',
                    padding: '22px 5px',
                    width: `${w}px`,
                    height: '99px',
                    boxSizing: 'border-box',
                    borderRadius: '12px',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                >
                  {/* Frame 109 (layout_3C9WOT): column, center, fill, gap 10px, padding 10px 30px, h64, radius 12
                      selected: fill #264B82 / unselected: fill #E7EEF7 + stroke #264B82 1px */}
                  <div
                    style={{
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: '10px',
                      padding: '10px 30px',
                      height: '64px',
                      borderRadius: '12px',
                      boxSizing: 'border-box',
                      background: active ? '#264B82' : '#E7EEF7',
                      border: active ? 'none' : '1px solid #264B82',
                      transition: 'background 0.15s, border-color 0.15s',
                    }}
                    onMouseEnter={e => {
                      if (!active) e.currentTarget.style.background = 'rgba(38,75,130,0.15)'
                    }}
                    onMouseLeave={e => {
                      if (!active) e.currentTarget.style.background = '#E7EEF7'
                    }}
                    onMouseDown={e => {
                      e.currentTarget.style.opacity = '0.8'
                    }}
                    onMouseUp={e => {
                      e.currentTarget.style.opacity = '1'
                    }}
                  >
                    {/* layout_7YOIDW: width 183, style_18LWOF SemiBold 600 24px
                        selected: fill #FFFFFF / unselected: fill #264B82 */}
                    <span style={{
                      fontFamily: "'Open Sans', sans-serif",
                      fontWeight: 600, fontSize: '24px',
                      color: active ? '#FFFFFF' : '#264B82',
                      width: '183px',
                      textAlign: 'center',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}>
                      {label}
                    </span>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
