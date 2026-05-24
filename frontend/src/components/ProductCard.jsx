// Figma: компонент 70:263 "Frame 64"
// layout_A4VUNX: column, center, gap 14px, padding 30px 30px 23px, 297×465, fill #E7EEF7

const SOURCE_LABEL = {
  wildberries:   'Wildberries',
  ozon:          'Ozon',
  yandex_market: 'Яндекс Маркет',
  runet:         'Рунет',
}

export default function ProductCard({ product, onDetails }) {
  const label = SOURCE_LABEL[product.source] || product.source || ''

  return (
    // layout_A4VUNX: column, center, gap 14px, padding 30px 30px 23px, 297×465, fill #E7EEF7
    <div
      onClick={onDetails}
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '14px',
        padding: '30px 30px 23px',
        width: '297px',
        height: '465px',
        background: '#E7EEF7',
        boxSizing: 'border-box',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {/* Rectangle 1: layout_YDBYUY — 265×265, fill #FFFFFF */}
      <div style={{
        width: '265px',
        height: '265px',
        background: '#FFFFFF',
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
        <img
          src={product.image_url}
          alt={product.name}
          loading="lazy"
          style={{ width: '100%', height: '100%', objectFit: 'contain' }}
          onError={e => { e.target.src = 'https://placehold.co/265x265/FFFFFF/264B82?text=Фото' }}
        />
      </div>

      {/* Frame 68: layout_86OH0W — column, gap -4px, padding 0 0 10px, height 78 */}
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '-4px',
        paddingBottom: '10px',
        height: '78px',
        width: '100%',
        flexShrink: 0,
      }}>
        {/* Frame 65: layout_5PE8TE — row, center, padding 6px, 266×45 */}
        <div style={{
          display: 'flex',
          flexDirection: 'row',
          alignItems: 'center',
          padding: '6px',
          width: '266px',
          height: '45px',
          boxSizing: 'border-box',
          flexShrink: 0,
        }}>
          {/* price: style_EPM1Y3 — Open Sans Regular 400 29px, letterSpacing 3%, #1A1A1A */}
          <span style={{
            fontFamily: "'Open Sans', sans-serif",
            fontWeight: 400,
            fontSize: '29px',
            letterSpacing: '3%',
            color: '#1A1A1A',
            flex: 1,
          }}>
            {product.price ? product.price.toLocaleString('ru-RU') + ' р.' : '—'}
          </span>
          {/* Frame badge: layout_T16B5J — 35×32, transparent */}
          <div style={{ width: '35px', height: '32px', flexShrink: 0 }} />
        </div>

        {/* Frame 67: layout_PXUXIC — column, center, gap 20px, 266×37 */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '20px',
          width: '266px',
          height: '37px',
          flexShrink: 0,
          overflow: 'hidden',
        }}>
          {/* product title: style_56AEN2 — Open Sans Regular 400 20px #575757, 254×33 */}
          <span style={{
            fontFamily: "'Open Sans', sans-serif",
            fontWeight: 400,
            fontSize: '20px',
            color: '#575757',
            width: '254px',
            height: '33px',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
            textOverflow: 'ellipsis',
            display: 'block',
          }}>
            {product.name}
          </span>
        </div>
      </div>

      {/* Frame 69 "Подробнее": layout_AWSKUQ — column, center, padding 10px, 266×41, fill #FFFFFF */}
      <a
        href={product.source_url}
        target="_blank"
        rel="noreferrer"
        onClick={e => e.stopPropagation()}
        style={{
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: '10px',
          width: '266px',
          height: '41px',
          background: '#FFFFFF',
          boxSizing: 'border-box',
          textDecoration: 'none',
          flexShrink: 0,
        }}
      >
        {/* "Подробнее": style_CR11GD — SemiBold 600 25px #264B82, 144×37 */}
        <span style={{
          fontFamily: "'Open Sans', sans-serif",
          fontWeight: 600,
          fontSize: '25px',
          color: '#264B82',
          width: '144px',
          height: '37px',
          textAlign: 'center',
          lineHeight: '37px',
          whiteSpace: 'nowrap',
        }}>
          Подробнее
        </span>
      </a>
    </div>
  )
}
