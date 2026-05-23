export default function SkeletonCard() {
  return (
    <div style={{
      background: '#FFFFFF', borderRadius: '12px',
      border: '1.5px solid #F1F5F9', overflow: 'hidden',
    }}>
      <div style={{
        aspectRatio: '1/1',
        background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s infinite',
      }} />
      <div style={{ padding: '8px' }}>
        <div style={{ height: '9px', background: '#F1F5F9', borderRadius: '4px', marginBottom: '5px' }} />
        <div style={{ height: '9px', background: '#F1F5F9', borderRadius: '4px', width: '70%', marginBottom: '10px' }} />
        <div style={{ height: '14px', background: '#F1F5F9', borderRadius: '4px', width: '50%' }} />
      </div>
      <style>{`
        @keyframes shimmer {
          0%   { background-position: 200% 0 }
          100% { background-position: -200% 0 }
        }
      `}</style>
    </div>
  )
}
