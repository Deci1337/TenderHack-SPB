import { useState, useRef, useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Search, MapPin, ArrowRight, SlidersHorizontal } from 'lucide-react'
import { fetchSuggestions } from '../api/suggest'

const REGIONS = [
  'Москва', 'Санкт-Петербург', 'Новосибирск', 'Екатеринбург',
  'Казань', 'Нижний Новгород', 'Челябинск', 'Самара', 'Омск', 'Ростов-на-Дону',
]

const EXAMPLES = [
  'Шина летняя 205/55 R16',
  'Принтер лазерный А4',
  'Куртка мужская зимняя',
]

const SOURCES = [
  { name: 'Wildberries', color: '#7C3AED' },
  { name: 'Ozon',        color: '#2563EB' },
  { name: 'Яндекс Маркет', color: '#D97706' },
  { name: 'Рунет',       color: '#059669' },
]

export default function SearchPage() {
  const [searchParams] = useSearchParams()
  const [query, setQuery]         = useState(searchParams.get('q') || '')
  const [region, setRegion]       = useState('Москва')
  const [priceFrom, setPriceFrom] = useState('')
  const [priceTo, setPriceTo]     = useState('')
  const [dateTo, setDateTo]       = useState('')
  const [hints, setHints]         = useState([])
  const [showHints, setShowHints] = useState(false)
  const inputRef  = useRef(null)
  const navigate  = useNavigate()

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      fetchSuggestions(query, 5).then(results => {
        if (!cancelled) setHints(results)
      })
    }, 400) // debounce — не дергаем Qwen на каждый символ
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [query])

  const go = (q = query) => {
    if (!q.trim()) return
    const params = new URLSearchParams({ q, region })
    if (priceFrom) params.set('priceFrom', priceFrom)
    if (priceTo)   params.set('priceTo', priceTo)
    if (dateTo)    params.set('dateTo', dateTo)
    navigate(`/results?${params.toString()}`)
  }

  const pick = (hint) => { setQuery(hint); setShowHints(false); go(hint) }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>

      {/* ─── Hero (тёмный верх) ─── */}
      <div style={{
        background: 'linear-gradient(160deg, #0B1628 0%, #162850 100%)',
        padding: '64px 24px 80px',
        textAlign: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Декоративные кольца */}
        <div style={{
          position: 'absolute', top: '-60px', right: '-60px',
          width: '300px', height: '300px', borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.04)',
        }} />
        <div style={{
          position: 'absolute', top: '-30px', right: '-30px',
          width: '200px', height: '200px', borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.06)',
        }} />
        <div style={{
          position: 'absolute', bottom: '-80px', left: '-40px',
          width: '250px', height: '250px', borderRadius: '50%',
          border: '1px solid rgba(255,255,255,0.04)',
        }} />

        {/* Бейдж */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '8px',
          background: 'rgba(29,110,202,0.25)',
          border: '1px solid rgba(59,130,246,0.3)',
          borderRadius: '100px', padding: '6px 16px',
          marginBottom: '28px',
        }}>
          <div style={{ width: '6px', height: '6px', borderRadius: '50%', background: '#3B82F6' }} />
          <span style={{ color: '#93C5FD', fontSize: '13px', fontWeight: 600, letterSpacing: '0.05em' }}>
            ПОРТАЛ ПОСТАВЩИКОВ · НМЦК
          </span>
        </div>

        <h1 style={{
          fontSize: 'clamp(2.5rem, 6vw, 4rem)',
          fontWeight: 800,
          color: '#FFFFFF',
          letterSpacing: '-0.03em',
          lineHeight: 1.05,
          marginBottom: '16px',
        }}>
          Price<span style={{ color: '#3B82F6' }}>Hunter</span>
        </h1>

        <p style={{
          fontSize: '1.125rem',
          color: 'rgba(255,255,255,0.55)',
          maxWidth: '480px',
          margin: '0 auto 40px',
          lineHeight: 1.6,
        }}>
          Сравните цены с&nbsp;4&nbsp;источников за&nbsp;30&nbsp;секунд
          и&nbsp;обоснуйте НМЦК по&nbsp;44-ФЗ
        </p>

        {/* Источники */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '24px', flexWrap: 'wrap' }}>
          {SOURCES.map(s => (
            <div key={s.name} style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
              <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: s.color }} />
              <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: '13px', fontWeight: 500 }}>{s.name}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ─── Карточка поиска (перекрывает hero снизу) ─── */}
      <div style={{
        maxWidth: '680px', width: '100%', margin: '-40px auto 0',
        padding: '0 16px',
        position: 'relative', zIndex: 10,
      }}>
        <div style={{
          background: '#FFFFFF',
          borderRadius: '20px',
          boxShadow: '0 20px 60px rgba(11,22,40,0.18), 0 4px 16px rgba(11,22,40,0.08)',
          padding: '28px',
        }}>

          {/* Регион */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '8px',
            marginBottom: '14px',
            padding: '10px 14px',
            background: '#F8FAFC',
            borderRadius: '10px',
            border: '1px solid #E2E8F0',
          }}>
            <MapPin size={15} color="#1D6ECA" strokeWidth={2.5} />
            <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500 }}>Регион:</span>
            <select
              value={region}
              onChange={e => setRegion(e.target.value)}
              style={{
                border: 'none', background: 'transparent',
                fontSize: '13px', fontWeight: 700, color: '#0F172A',
                cursor: 'pointer', outline: 'none',
              }}
            >
              {REGIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>

          {/* Фильтр: цена */}
          <div style={{ marginBottom: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', padding: '10px 14px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #E2E8F0' }}>
              <SlidersHorizontal size={14} color="#1D6ECA" strokeWidth={2.5} />
              <input
                type="number"
                placeholder="от ₽"
                value={priceFrom}
                onChange={e => setPriceFrom(e.target.value)}
                style={{ border: 'none', background: 'transparent', width: '80px', fontSize: '13px', fontFamily: 'inherit', color: '#0F172A', outline: 'none' }}
              />
              <span style={{ color: '#CBD5E1', fontSize: '12px' }}>—</span>
              <input
                type="number"
                placeholder="до ₽"
                value={priceTo}
                onChange={e => setPriceTo(e.target.value)}
                style={{ border: 'none', background: 'transparent', width: '80px', fontSize: '13px', fontFamily: 'inherit', color: '#0F172A', outline: 'none' }}
              />
            </div>
          </div>

          {/* Срок поставки — до выбранной даты */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 14px', background: '#F8FAFC', borderRadius: '10px', border: '1px solid #E2E8F0', marginBottom: '14px' }}>
            <span style={{ fontSize: '13px', color: '#64748B', fontWeight: 500, whiteSpace: 'nowrap' }}>Поставка до:</span>
            <input
              type="date"
              value={dateTo}
              min={new Date().toISOString().slice(0, 10)}
              onChange={e => setDateTo(e.target.value)}
              style={{ border: 'none', background: 'transparent', fontSize: '13px', fontFamily: 'inherit', color: '#0F172A', outline: 'none', cursor: 'pointer' }}
            />
          </div>

          {/* Поле поиска */}
          <div style={{ position: 'relative' }}>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onFocus={() => setShowHints(true)}
              onBlur={() => setTimeout(() => setShowHints(false), 150)}
              onKeyDown={e => e.key === 'Enter' && go()}
              placeholder="Например: принтер лазерный А4"
              style={{
                width: '100%',
                padding: '16px 20px',
                fontSize: '16px',
                fontFamily: 'inherit',
                color: '#0F172A',
                background: '#F8FAFC',
                border: '2px solid #E2E8F0',
                borderRadius: '12px',
                outline: 'none',
                transition: 'border-color 0.15s',
              }}
              onFocusCapture={e => e.target.style.borderColor = '#1D6ECA'}
              onBlurCapture={e => e.target.style.borderColor = '#E2E8F0'}
            />

            {/* Подсказки */}
            {showHints && hints.length > 0 && (
              <ul style={{
                position: 'absolute', top: 'calc(100% + 8px)', left: 0, right: 0,
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '14px',
                boxShadow: '0 12px 40px rgba(11,22,40,0.12)',
                zIndex: 50, overflow: 'hidden', listStyle: 'none',
              }}>
                {hints.map((group, gi) => (
                  <li key={group.category}>
                    <div style={{
                      padding: '7px 18px 4px',
                      fontSize: '10px', fontWeight: 700, letterSpacing: '0.07em',
                      color: '#94A3B8', textTransform: 'uppercase',
                      background: gi > 0 ? '#F8FAFC' : '#FFFFFF',
                      borderTop: gi > 0 ? '1px solid #F1F5F9' : 'none',
                    }}>
                      {group.category}
                    </div>
                    {group.items.map((item, ii) => (
                      <div
                        key={ii}
                        onMouseDown={() => pick(item)}
                        style={{
                          display: 'flex', alignItems: 'center', gap: '12px',
                          padding: '10px 18px',
                          cursor: 'pointer',
                          fontSize: '14px', color: '#334155',
                          borderBottom: ii < group.items.length - 1 ? '1px solid #F8FAFC' : 'none',
                          transition: 'background 0.1s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = '#F0F9FF'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <Search size={13} color="#CBD5E1" strokeWidth={2} />
                        {item}
                      </div>
                    ))}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Кнопка */}
          <button
            onClick={() => go()}
            style={{
              marginTop: '12px',
              width: '100%',
              padding: '16px',
              background: 'linear-gradient(135deg, #1D6ECA 0%, #2563EB 100%)',
              color: '#FFFFFF',
              fontSize: '16px',
              fontWeight: 700,
              fontFamily: 'inherit',
              border: 'none',
              borderRadius: '12px',
              cursor: 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px',
              boxShadow: '0 8px 24px rgba(29,110,202,0.35)',
              transition: 'transform 0.1s, box-shadow 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(29,110,202,0.45)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 8px 24px rgba(29,110,202,0.35)' }}
            onMouseDown={e => e.currentTarget.style.transform = 'translateY(0)'}
          >
            <Search size={18} strokeWidth={2.5} />
            Найти цены
            <ArrowRight size={18} strokeWidth={2.5} />
          </button>
        </div>
      </div>


    </div>
  )
}
