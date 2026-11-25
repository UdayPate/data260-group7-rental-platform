// The "Mock data" badge in the header. Clicking it opens a small menu with the demo switch
// "Booking worker: running / paused" (team decision B3a): pausing it is the mock version of
// stopping the Kafka booking consumer for the spec 13.2 demo. Shared by all windows.
import { useState } from 'react'
import { errorMessage } from '../api/client'
import { getBookingWorker, setBookingWorkerPaused, type BookingWorkerState } from '../api/mockControls'
import { apiBaseUrls } from '../config'

function MockMenu() {
  const [open, setOpen] = useState(false)
  const [worker, setWorker] = useState<BookingWorkerState | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The switch only exists while the Booking Service itself is mocked.
  const bookingsMocked = apiBaseUrls.bookings === ''

  async function toggleMenu() {
    const next = !open
    setOpen(next)
    if (!next || !bookingsMocked) return
    setError(null)
    try {
      setWorker(await getBookingWorker())
    } catch (err) {
      setError(errorMessage(err))
    }
  }

  async function setPaused(paused: boolean) {
    setBusy(true)
    setError(null)
    try {
      setWorker(await setBookingWorkerPaused(paused))
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggleMenu}
        aria-expanded={open}
        data-mock-menu-button
        className={`rounded-full border px-3 py-0.5 font-condensed text-xs font-bold tracking-[0.08em] whitespace-nowrap uppercase ${
          worker?.paused ? 'border-status-error text-status-error' : 'border-status-pending text-status-pending'
        }`}
      >
        Mock data{worker?.paused ? ' · worker paused' : ''}
      </button>
      {open && (
        <div data-mock-menu className="absolute right-0 z-20 mt-2 w-72 space-y-3 rounded-2xl border border-line-strong bg-surface-2 p-4 text-sm shadow-lg">
          <p className="text-fg-soft">Every service is answered by mock data in this browser.</p>
          {!bookingsMocked && <p className="text-fg-muted">The Booking Service is real, so its worker is controlled on the server.</p>}
          {bookingsMocked && worker && (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Booking worker (Kafka consumer)</p>
              <p data-worker-status className={worker.paused ? 'text-status-error' : 'text-status-ok'}>
                {worker.paused ? 'Paused' : 'Running'} · {worker.processing} request{worker.processing === 1 ? '' : 's'} processing
              </p>
              <button
                type="button"
                disabled={busy}
                onClick={() => setPaused(!worker.paused)}
                className="rounded-full border border-line-strong px-4 py-1.5 font-semibold text-fg hover:bg-surface disabled:opacity-60"
              >
                {worker.paused ? 'Resume the worker' : 'Pause the worker'}
              </button>
              <p className="text-xs text-fg-muted">
                Paused: new booking requests wait as “processing”. Resume: they are processed in order, each once (spec 13.2).
              </p>
            </div>
          )}
          {error && <p className="text-status-error">{error}</p>}
        </div>
      )}
    </div>
  )
}

export default MockMenu
