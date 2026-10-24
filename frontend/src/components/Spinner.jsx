// 3D cube loading spinner. Use <Spinner /> inline, or <Spinner label="Loading…" />
// for a centered block, or <Spinner overlay /> to cover a container/card.
export default function Spinner({ label, overlay = false, size }) {
  const cube = (
    <div className="spinner" style={size ? { width: size, height: size } : undefined}>
      <div /><div /><div /><div /><div /><div />
    </div>
  );
  if (overlay) {
    return (
      <div className="spinner-overlay">
        {cube}
        {label && <div className="spinner-label">{label}</div>}
      </div>
    );
  }
  return (
    <div className="spinner-block">
      {cube}
      {label && <div className="spinner-label">{label}</div>}
    </div>
  );
}
