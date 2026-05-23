export default function SkeletonCard() {
  return (
    <div style={{
      background: '#FFFFFF', borderRadius: '14px',
      border: '1.5px solid #F1F5F9', overflow: 'hidden',
    }}>
      <div style={{
        aspectRatio: '1/1',
        background: 'linear-gradient(90deg, #F1F5F9 25%, #E2E8F0 50%, #F1F5F9 75%)',
        backgroundSize: '200% 100%',
        animation: 'shimmer 1.4s infinite',
      }} />
      <div style={{ padding: '14px', minHeight: '110px' }}>
        <div style={{ height: '12px', background: '#F1F5F9', borderRadius: '4px', marginBottom: '8px' }} />
        <div style={{ height: '12px', background: '#F1F5F9', borderRadius: '4px', width: '70%', marginBottom: '16px' }} />
        <div style={{ height: '20px', background: '#F1F5F9', borderRadius: '4px', width: '50%' }} />
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
