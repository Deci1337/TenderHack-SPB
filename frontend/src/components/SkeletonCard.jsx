// Figma: 297×465, padding 30px 30px 23px, gap 14px, bg #E7EEF7
const sh = {
  background: 'linear-gradient(90deg,#D4DBE6 25%,#C9D1DF 50%,#D4DBE6 75%)',
  backgroundSize: '400% 100%',
  animation: 'sk 1.4s ease-in-out infinite',
}

export default function SkeletonCard() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      gap: '14px', padding: '30px 30px 23px',
      width: '297px', height: '465px',
      background: '#E7EEF7', boxSizing: 'border-box', flexShrink: 0,
    }}>
      {/* image 265×265 */}
      <div style={{ ...sh, width: '265px', height: '265px', flexShrink: 0 }} />
      {/* price + title 266×78 */}
      <div style={{ width: '266px', height: '78px', flexShrink: 0, display:'flex', flexDirection:'column', gap:'8px', paddingBottom:'10px', boxSizing:'border-box' }}>
        <div style={{ ...sh, width: '140px', height: '29px' }} />
        <div style={{ ...sh, width: '220px', height: '20px' }} />
      </div>
      {/* button 266×41 */}
      <div style={{ ...sh, width: '266px', height: '41px', flexShrink: 0 }} />
      <style>{`@keyframes sk{0%{background-position:100% 0}100%{background-position:-100% 0}}`}</style>
    </div>
  )
}
