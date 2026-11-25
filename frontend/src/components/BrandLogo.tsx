// The brand logo: the gold arch mark, then the name in capitals ("XENIA") in Cinzel.
// The name itself comes from src/brand.ts.
import { BRAND } from '../brand'
import { ArchMark } from './icons'

function BrandLogo({ className = '' }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 font-display font-bold tracking-[0.12em] whitespace-nowrap uppercase ${className}`}>
      <ArchMark className="h-[0.9em] w-[0.9em] text-gold" />
      {BRAND.name}
    </span>
  )
}

export default BrandLogo
