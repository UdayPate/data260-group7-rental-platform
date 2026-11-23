// Shows an API error to the user in plain words, with optional Retry / Dismiss buttons.
import type { ReactNode } from 'react'

type Props = {
  message: string
  onRetry?: () => void
  onDismiss?: () => void
  children?: ReactNode // optional extra line under the message, e.g. a link
}

const buttonClass =
  'rounded-full border border-status-error-border px-4 py-1 text-sm font-semibold text-status-error hover:bg-surface-2'

function ErrorBanner({ message, onRetry, onDismiss, children }: Props) {
  return (
    // role="alert" makes screen readers announce the message as soon as it appears
    <div role="alert" className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-2xl border border-status-error-border bg-surface px-4 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-status-error">{message}</p>
        {children}
      </div>
      {onRetry && (
        <button type="button" onClick={onRetry} className={buttonClass}>
          Retry
        </button>
      )}
      {onDismiss && (
        <button type="button" onClick={onDismiss} className={buttonClass}>
          Dismiss
        </button>
      )}
    </div>
  )
}

export default ErrorBanner
