import React from 'react';

/** Lightweight branded chrome inspired by the GAYZE gradient rule.
 *  It is decorative only and never captures pointer events.
 */
export const BrandChrome: React.FC = () => (
  <>
    <div className="g-brand-topline" aria-hidden="true" />
    <div className="g-brand-corner g-brand-corner--left" aria-hidden="true" />
    <div className="g-brand-corner g-brand-corner--right" aria-hidden="true" />
  </>
);
