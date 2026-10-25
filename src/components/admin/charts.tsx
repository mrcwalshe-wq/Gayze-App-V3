import React from 'react';

/** Small, dependency-free SVG charts for the owner console and the printable report.
 *  Colours come from CSS variables so the same charts work on screen and in print. */

const nf = (n: number) => n.toLocaleString();

export const Columns: React.FC<{ data: { label: string; n: number }[]; ariaLabel: string; tickEvery?: number; height?: number; highlightMax?: boolean }> = ({ data, ariaLabel, tickEvery = 1, height = 120, highlightMax = true }) => {
  const max = Math.max(1, ...data.map((d) => d.n));
  const w = 100 / Math.max(1, data.length);
  const top = data.reduce((best, d, i) => (d.n > data[best].n ? i : best), 0);
  return (
    <figure className="gc">
      <svg viewBox={`0 0 100 ${height / 4 + 8}`} preserveAspectRatio="none" role="img" aria-label={ariaLabel} className="gc__svg" style={{ height }}>
        {data.map((d, i) => {
          const h = (d.n / max) * (height / 4);
          return (
            <rect key={i} x={i * w + w * 0.14} width={w * 0.72} y={height / 4 - h} height={Math.max(h, d.n > 0 ? 0.6 : 0)} rx="0.8"
              className={highlightMax && i === top && d.n > 0 ? 'gc__bar gc__bar--hi' : 'gc__bar'}>
              <title>{`${d.label}: ${nf(d.n)}`}</title>
            </rect>
          );
        })}
        <line x1="0" x2="100" y1={height / 4 + 0.2} y2={height / 4 + 0.2} className="gc__axis" />
      </svg>
      <div className="gc__ticks" aria-hidden="true">
        {data.map((d, i) => <span key={i} style={{ width: `${w}%` }}>{i % tickEvery === 0 ? d.label : ''}</span>)}
      </div>
    </figure>
  );
};

export const Trend: React.FC<{ data: { label: string; n: number }[]; ariaLabel: string; height?: number }> = ({ data, ariaLabel, height = 120 }) => {
  if (data.length < 2) return <p className="ga-note">Not enough days to chart yet.</p>;
  const max = Math.max(1, ...data.map((d) => d.n));
  const H = height / 4;
  const pts = data.map((d, i) => [(i / (data.length - 1)) * 100, H - (d.n / max) * (H - 2) - 1] as const);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(2)} ${y.toFixed(2)}`).join(' ');
  const area = `${line} L100 ${H} L0 ${H} Z`;
  const total = data.reduce((a, d) => a + d.n, 0);
  return (
    <figure className="gc">
      <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" role="img" aria-label={`${ariaLabel}. Total ${nf(total)}, peak ${nf(max)}.`} className="gc__svg" style={{ height }}>
        <path d={area} className="gc__area" />
        <path d={line} className="gc__line" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="gc__range"><span>{data[0].label}</span><span>peak {nf(max)}</span><span>{data[data.length - 1].label}</span></div>
    </figure>
  );
};

export const HBars: React.FC<{ data: { label: string; n: number }[]; total?: number; emptyText?: string; unit?: string }> = ({ data, total, emptyText = 'No data in this period yet.', unit }) => {
  if (!data.length) return <p className="ga-note">{emptyText}</p>;
  const max = Math.max(1, ...data.map((d) => d.n));
  const sum = total ?? data.reduce((a, d) => a + d.n, 0);
  return (
    <ul className="gh">
      {data.map((d) => (
        <li key={d.label}>
          <span className="gh__label">{d.label}</span>
          <span className="gh__track" aria-hidden="true"><i style={{ width: `${Math.max(2, (d.n / max) * 100)}%` }} /></span>
          <span className="gh__n">{nf(d.n)}{unit ?? ''}{sum > 0 ? <small> · {Math.round((d.n / sum) * 100)}%</small> : null}</span>
        </li>
      ))}
    </ul>
  );
};

export const Funnel: React.FC<{ steps: { step: string; n: number }[] }> = ({ steps }) => {
  const top = Math.max(1, steps[0]?.n ?? 1);
  return (
    <ol className="gf">
      {steps.map((s, i) => {
        const prev = i === 0 ? null : steps[i - 1].n;
        const kept = prev && prev > 0 ? Math.round((s.n / prev) * 100) : null;
        return (
          <li key={s.step}>
            <div className="gf__bar" style={{ width: `${Math.max(6, (s.n / top) * 100)}%` }}><b>{nf(s.n)}</b></div>
            <span className="gf__label">{s.step}{kept !== null && <small> · {kept}% of previous</small>}</span>
          </li>
        );
      })}
    </ol>
  );
};

export const Delta: React.FC<{ part: number; whole: number; label: string }> = ({ part, whole, label }) => {
  const pct = whole > 0 ? Math.round((part / whole) * 100) : 0;
  return (
    <div className="gd" role="img" aria-label={`${label}: ${pct}% (${nf(part)} of ${nf(whole)})`}>
      <div className="gd__ring" style={{ ['--p' as string]: `${pct}` }}><b>{pct}%</b></div>
      <span>{label}<small>{nf(part)} of {nf(whole)}</small></span>
    </div>
  );
};
