// A reservation status as a colored outline pill: processing (muted), pending (gold),
// approved (green), declined / cancelled / not booked (red), completed (muted).
import type { ReservationStatus } from '../types/reservation'

const STYLES: Record<ReservationStatus, string> = {
  processing: 'border-line-strong text-fg-soft',
  pending: 'border-status-pending text-status-pending',
  approved: 'border-status-ok text-status-ok',
  declined: 'border-status-error-border text-status-error',
  cancelled: 'border-status-error-border text-status-error',
  completed: 'border-line-strong text-fg-muted',
  failed: 'border-status-error-border text-status-error',
}

// What the pill says. "failed" reads as "Not booked" to a guest (B4a).
const LABELS: Record<ReservationStatus, string> = {
  processing: 'processing',
  pending: 'pending',
  approved: 'approved',
  declined: 'declined',
  cancelled: 'cancelled',
  completed: 'completed',
  failed: 'not booked',
}

function StatusBadge({ status }: { status: ReservationStatus }) {
  return (
    <span
      data-status={status}
      className={`inline-block rounded-full border px-3 py-0.5 font-condensed text-sm font-bold tracking-[0.08em] uppercase ${STYLES[status]}`}
    >
      {LABELS[status]}
    </span>
  )
}

export default StatusBadge
