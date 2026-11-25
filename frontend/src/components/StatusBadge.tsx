// A reservation status as a colored outline pill: pending (gold), approved (green),
// declined / cancelled (red), completed (muted).
import type { ReservationStatus } from '../types/reservation'

const STYLES: Record<ReservationStatus, string> = {
  pending: 'border-status-pending text-status-pending',
  approved: 'border-status-ok text-status-ok',
  declined: 'border-status-error-border text-status-error',
  cancelled: 'border-status-error-border text-status-error',
  completed: 'border-line-strong text-fg-muted',
}

function StatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <span
      className={`inline-block rounded-full border px-3 py-0.5 font-condensed text-sm font-bold tracking-[0.08em] uppercase ${STYLES[status]}`}
    >
      {status}
    </span>
  )
}

export default StatusBadge
