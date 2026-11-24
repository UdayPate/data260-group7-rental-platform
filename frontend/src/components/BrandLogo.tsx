// The brand name as a logo: Fraunces, with every "&" in terracotta (CLAUDE.md).
// The name itself comes from src/brand.ts.
import { Fragment } from 'react'
import { BRAND } from '../brand'

function BrandLogo({ className = '' }: { className?: string }) {
  const parts = BRAND.name.split('&') // "Cedar & Rye" -> ["Cedar ", " Rye"]
  return (
    <span className={`font-display font-extrabold whitespace-nowrap ${className}`}>
      {parts.map((part, i) => (
        <Fragment key={i}>
          {i > 0 && <span className="text-primary">&amp;</span>}
          {part}
        </Fragment>
      ))}
    </span>
  )
}

export default BrandLogo
