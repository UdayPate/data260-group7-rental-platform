// "Message host" / "Message guest": opens (or reuses) the conversation, then goes to it.
// One thread per guest + host + listing, so pressing it twice lands in the same thread.
import { useState } from 'react'
import { useNavigate } from 'react-router'
import { errorMessage } from '../api/client'
import { openThread } from '../api/messaging'
import type { OpenThreadRequest } from '../types/message'

type Props = {
  label: string
  request: OpenThreadRequest
  inbox: '/guest/messages' | '/host/messages' // where the conversation opens
  className?: string
}

function MessageButton({ label, request, inbox, className = '' }: Props) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function open() {
    setBusy(true)
    setError(null)
    try {
      const thread = await openThread(request)
      navigate(`${inbox}?thread=${thread.thread_id}`)
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <span className="inline-flex flex-col gap-1">
      <button
        type="button"
        onClick={open}
        disabled={busy}
        className={`rounded-full border border-line-strong px-4 py-1.5 text-sm font-semibold hover:bg-surface-2 disabled:opacity-60 ${className}`}
      >
        {busy ? 'Opening…' : label}
      </button>
      {error && (
        <span role="alert" className="text-sm text-status-error">
          {error}
        </span>
      )}
    </span>
  )
}

export default MessageButton
