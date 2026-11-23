// Shows an API error to the user in plain words, with optional Retry / Dismiss buttons.
type Props = {
  message: string
  onRetry?: () => void
  onDismiss?: () => void
}

const buttonClass =
  'rounded-full border border-status-error-border px-4 py-1 text-sm font-semibold text-status-error hover:bg-surface-2'

function ErrorBanner({ message, onRetry, onDismiss }: Props) {
  return (
    // role="alert" makes screen readers announce the message as soon as it appears
    <div role="alert" className="flex items-center gap-4 rounded-2xl border border-status-error-border bg-surface px-4 py-3">
      <p className="flex-1 text-status-error">{message}</p>
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
