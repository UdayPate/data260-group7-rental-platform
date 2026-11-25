// Unread-message count next to "Messages" in the header (team decision C4a).
// Checks every 30 s, and right away when a page announces that messages changed.
// If a check fails it shows "!" with the error message (errors are never swallowed).
import { useEffect, useState } from 'react'
import { errorMessage } from '../api/client'
import { MESSAGES_CHANGED_EVENT, threadsByUser } from '../api/messaging'

const CHECK_EVERY_MS = 30_000

// The header gives this key={userId}, so a different user starts fresh.
function UnreadBadge({ userId }: { userId: string }) {
  const [count, setCount] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let ignore = false
    const check = () =>
      threadsByUser({ user_id: userId })
        .then((r) => {
          if (ignore) return
          setCount(r.items.reduce((sum, t) => sum + t.unread_count, 0))
          setError(null)
        })
        .catch((err: unknown) => {
          if (!ignore) setError(errorMessage(err))
        })
    check()
    const timer = setInterval(check, CHECK_EVERY_MS)
    window.addEventListener(MESSAGES_CHANGED_EVENT, check)
    return () => {
      ignore = true
      clearInterval(timer)
      window.removeEventListener(MESSAGES_CHANGED_EVENT, check)
    }
  }, [userId])

  if (error) {
    const text = `Couldn’t check messages: ${error}`
    return (
      <span title={text} aria-label={text} className="ml-1.5 rounded-full border border-status-error-border px-1.5 text-xs font-bold text-status-error">
        !
      </span>
    )
  }
  if (count === 0) return null
  return (
    <span data-unread-badge aria-label={`${count} unread`} className="ml-1.5 rounded-full bg-gold px-1.5 py-0.5 text-xs font-bold text-bg">
      {count}
    </span>
  )
}

export default UnreadBadge
