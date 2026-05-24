import { useEffect } from 'react'

export default function ProductModal({ product, allProducts, currentIndex, onClose, onNavigate }) {
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft'  && currentIndex > 0) onNavigate(currentIndex - 1)
      if (e.key === 'ArrowRight' && currentIndex < allProducts.length - 1) onNavigate(currentIndex + 1)
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIndex, allProducts.length, onClose, onNavigate])

  const hasPrev = currentIndex > 0
  const hasNext = currentIndex < allProducts.length - 1

  const chars = product.characteristics || {}
  const hasChars = Object.keys(chars).length > 0

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 50,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontFamily: "'Open Sans', sans-serif",
      }}
    >
      {/* Overlay */}
      <div
        style={{
          position: 'absolute', inset: 0,
          background: 'rgba(38,75,130,0.14)',
          backdropFilter: 'blur(5px)',
        }}
        onClick={onClose}
      />

      {/* Карточка */}
      <div style={{
        position: 'relative',
        background: '#FFFFFF',
        borderRadius: '12px',
        boxShadow: '0px 10px 70px 0px #264B82',
        width: '1173px',
        maxWidth: 'calc(100vw - 40px)',
        maxHeight: 'calc(100vh - 40px)',
        display: 'flex',
        flexDirection: 'row',
        gap: '60px',
        padding: '40px 40px 80px',
        alignItems: 'center',
        overflow: 'hidden',
      }}>

        {/* Кнопка закрыть */}
        <button
          onClick={onClose}
          style={{
            position: 'absolute', top: '16px', right: '16px', zIndex: 10,
            width: '36px', height: '36px', borderRadius: '50%',
            background: '#E7EEF7', border: '1px solid #D4DBE6',
            color: '#264B82',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer',
            fontFamily: 'inherit',
          }}
          aria-label="Закрыть"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M18 6L6 18M6 6L18 18" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"/>
          </svg>
        </button>

        {/* Левая колонка */}
        <div style={{
          display: 'flex', flexDirection: 'column', gap: '58px',
          alignItems: 'flex-start', flexShrink: 0,
        }}>
          {/* Изображение */}
          <div style={{
            width: '413px', height: '438px',
            background: '#C9D1DF', borderRadius: '8px',
            overflow: 'hidden', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <img
              src={product.image_url}
              alt={product.name}
              style={{ width: '100%', height: '100%', objectFit: 'contain', padding: '12px' }}
              onError={e => { e.target.style.display = 'none' }}
            />
          </div>

          {/* Цена */}
          <div style={{
            width: '413px', height: '100px',
            border: '1px solid #264B82',
            borderRadius: '12px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '10px',
            flexShrink: 0,
            background: '#FFFFFF',
          }}>
            <span style={{
              fontSize: '40px', fontWeight: 600, color: '#264B82',
              whiteSpace: 'nowrap', lineHeight: 'normal',
            }}>
              {product.price ? product.price.toLocaleString('ru-RU') + ' р.' : '—'}
            </span>
          </div>
        </div>

        {/* Правая колонка */}
        <div style={{
          width: '606px', flex: 1,
          display: 'flex', flexDirection: 'column',
          alignItems: 'flex-start',
          overflow: 'hidden',
          flexShrink: 0,
          minHeight: 0,
        }}>
          {/* Название */}
          <div style={{
            width: '100%', padding: '4px 0',
            display: 'flex', flexDirection: 'column',
            justifyContent: 'center', overflow: 'hidden',
            flexShrink: 0,
          }}>
            <p style={{
              fontSize: '40px', fontWeight: 700, color: '#1A1A1A',
              lineHeight: 'normal', whiteSpace: 'nowrap',
              overflow: 'hidden', textOverflow: 'ellipsis',
              margin: 0,
            }}>
              {product.name}
            </p>
          </div>

          {/* Контент */}
          <div style={{
            display: 'flex', flexDirection: 'column', gap: '20px',
            width: '100%', flex: 1,
            alignItems: 'flex-start',
          }}>
            {/* Описание (источник) */}
            <div style={{
              width: '100%', padding: '4px 0',
              display: 'flex', flexDirection: 'column',
              justifyContent: 'center', overflow: 'hidden',
              flexShrink: 0,
            }}>
              <p style={{
                fontSize: '24px', fontWeight: 600, color: '#1A1A1A',
                lineHeight: 'normal', whiteSpace: 'nowrap',
                overflow: 'hidden', textOverflow: 'ellipsis',
                margin: 0,
              }}>
                {product.source === 'wildberries' && 'Wildberries'}
                {product.source === 'ozon' && 'Ozon'}
                {product.source === 'yandex_market' && 'Яндекс Маркет'}
                {product.source === 'runet' && 'Рунет'}
                {!['wildberries','ozon','yandex_market','runet'].includes(product.source) && product.source}
              </p>
            </div>

            <div style={{
              display: 'flex', flexDirection: 'column', gap: '50px',
              width: '100%', flexShrink: 0,
            }}>
              {/* Блок характеристик */}
              <div style={{
                border: '1px solid rgba(38,75,130,0.7)',
                borderRadius: '12px',
                height: '310px',
                width: '100%',
                display: 'flex', flexDirection: 'column', gap: '10px',
                padding: '10px 20px',
                overflow: 'hidden',
                boxSizing: 'border-box',
              }}>
                {/* Заголовок */}
                <div style={{
                  borderBottom: '3px solid rgba(38,75,130,0.42)',
                  padding: '10px 0',
                  width: '100%', flexShrink: 0,
                  display: 'flex', flexDirection: 'column',
                  justifyContent: 'center', overflow: 'hidden',
                }}>
                  <p style={{
                    fontSize: '32px', fontWeight: 600, color: '#1A1A1A',
                    lineHeight: 'normal', margin: 0, whiteSpace: 'nowrap',
                  }}>
                    Характеристики
                  </p>
                </div>
                {/* Список */}
                <div style={{ overflowY: 'auto', flex: 1 }}>
                  {hasChars ? (
                    Object.entries(chars).map(([key, val]) => (
                      <div
                        key={key}
                        style={{
                          display: 'flex', justifyContent: 'space-between',
                          padding: '4px 0',
                          fontSize: '18px', fontWeight: 400, color: '#1A1A1A',
                          lineHeight: 'normal',
                        }}
                      >
                        <span style={{ color: '#575757' }}>{key}</span>
                        <span style={{ fontWeight: 600, marginLeft: '12px', textAlign: 'right' }}>{val}</span>
                      </div>
                    ))
                  ) : (
                    <p style={{ fontSize: '18px', color: '#1A1A1A', margin: 0, fontWeight: 400 }}>
                      Характеристики не указаны
                    </p>
                  )}
                </div>
              </div>

              {/* Кнопка перейти */}
              <a
                href={product.source_url}
                target="_blank"
                rel="noreferrer"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  width: '606px', height: '100px',
                  background: '#264B82',
                  borderRadius: '12px',
                  textDecoration: 'none',
                  flexShrink: 0,
                  padding: '10px',
                  boxSizing: 'border-box',
                }}
              >
                <span style={{
                  fontSize: '40px', fontWeight: 700, color: '#FFFFFF',
                  whiteSpace: 'nowrap', lineHeight: 'normal',
                }}>
                  Перейти к товару
                </span>
              </a>
            </div>
          </div>
        </div>

        {/* Навигация prev/next */}
        {(hasPrev || hasNext) && (
          <div style={{
            position: 'absolute',
            bottom: '16px',
            left: '50%', transform: 'translateX(-50%)',
            display: 'flex', alignItems: 'center', gap: '24px',
            zIndex: 10,
          }}>
            <button
              onClick={() => hasPrev && onNavigate(currentIndex - 1)}
              disabled={!hasPrev}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '16px', fontWeight: 600, color: hasPrev ? '#264B82' : '#C9D1DF',
                background: 'white', border: '1px solid ' + (hasPrev ? '#264B82' : '#C9D1DF'),
                borderRadius: '8px', padding: '8px 16px',
                cursor: hasPrev ? 'pointer' : 'default', fontFamily: 'inherit',
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M15 18L9 12L15 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              Назад
            </button>
            <span style={{ fontSize: '14px', color: '#264B82', fontWeight: 600, background: '#E7EEF7', border: '1px solid #264B82', borderRadius: '8px', padding: '6px 12px' }}>
              {currentIndex + 1} / {allProducts.length}
            </span>
            <button
              onClick={() => hasNext && onNavigate(currentIndex + 1)}
              disabled={!hasNext}
              style={{
                display: 'flex', alignItems: 'center', gap: '4px',
                fontSize: '16px', fontWeight: 600, color: hasNext ? '#264B82' : '#C9D1DF',
                background: 'white', border: '1px solid ' + (hasNext ? '#264B82' : '#C9D1DF'),
                borderRadius: '8px', padding: '8px 16px',
                cursor: hasNext ? 'pointer' : 'default', fontFamily: 'inherit',
              }}
            >
              Вперёд
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none">
                <path d="M9 18L15 12L9 6" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
