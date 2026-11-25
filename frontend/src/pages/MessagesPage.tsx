// Messages for guests (/guest/messages) and hosts (/host/messages), same page (U1a):
// thread list on the left, the selected conversation on the right (?thread=t_001 in the URL).
// No WebSocket (C4a): the list is checked every 15 s, an open conversation every 5 s.
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import { Link, useSearchParams } from 'react-router'
import { errorMessage } from '../api/client'
import {
  announceMessagesChanged,
  getThread,
  listMessages,
  MESSAGES_CHANGED_EVENT,
  sendMessage,
  threadsByUser,
} from '../api/messaging'
import { newIdempotencyKey } from '../api/bookings'
import ErrorBanner from '../components/ErrorBanner'
import { useCurrentUser } from '../context/useCurrentUser'
import { formatDateTime } from '../dates'
import { MESSAGE_TEXT_MAX, type DeliveryStatus, type Message, type ThreadSummary } from '../types/message'

type Role = 'guest' | 'host'

const LIST_EVERY_MS = 15_000
const CONVERSATION_EVERY_MS = 5_000

function MessagesPage({ role }: { role: Role }) {
  const { guestId, hostId } = useCurrentUser()
  const userId = role === 'guest' ? guestId : hostId
  return <Messages key={userId} userId={userId} role={role} />
}

// "Maya Ortiz" for a guest's thread, "Alex Chen" for a host's.
const otherName = (t: ThreadSummary, role: Role) => (role === 'guest' ? t.host_name : t.guest_name)

function Messages({ userId, role }: { userId: string; role: Role }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('thread')

  const [threads, setThreads] = useState<ThreadSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  // Load the list now, every 15 s, and whenever a conversation reports a change.
  useEffect(() => {
    let ignore = false
    const load = () =>
      threadsByUser({ user_id: userId })
        .then((r) => {
          if (ignore) return
          setThreads(r.items)
          setError(null)
          setLoading(false)
        })
        .catch((err: unknown) => {
          if (ignore) return
          setError(errorMessage(err))
          setLoading(false)
        })
    load()
    const timer = setInterval(load, LIST_EVERY_MS)
    window.addEventListener(MESSAGES_CHANGED_EVENT, load)
    return () => {
      ignore = true
      clearInterval(timer)
      window.removeEventListener(MESSAGES_CHANGED_EVENT, load)
    }
  }, [userId, attempt])

  return (
    <section className="space-y-4">
      <h1 className="cornice font-display text-4xl font-bold">Messages</h1>
      {error && (
        <ErrorBanner
          message={error}
          onRetry={() => {
            setError(null)
            setAttempt((n) => n + 1)
          }}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[340px_1fr]">
        {/* ---------- Thread list ---------- */}
        <nav aria-label="Conversations" className="space-y-2">
          {loading && <p className="text-fg-muted">Loading conversations…</p>}
          {!loading && threads.length === 0 && !error && (
            <div className="rounded-2xl border border-line bg-surface p-4 text-sm text-fg-soft">
              No conversations yet.{' '}
              {role === 'guest' ? 'Use “Message host” on a listing or a reservation.' : 'Use “Message guest” on a reservation.'}
            </div>
          )}
          {threads.map((t) => {
            const active = t.thread_id === selectedId
            const unread = t.unread_count > 0
            return (
              <button
                key={t.thread_id}
                type="button"
                data-thread={t.thread_id}
                onClick={() => setSearchParams({ thread: t.thread_id })}
                aria-current={active ? 'true' : undefined}
                className={`block w-full rounded-2xl border p-3 text-left ${
                  active ? 'border-gold bg-surface-2' : 'border-line bg-surface hover:bg-surface-2'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={unread ? 'font-bold text-fg' : 'font-semibold text-fg-soft'}>{otherName(t, role)}</span>
                  {unread && (
                    <span data-thread-unread className="rounded-full bg-gold px-1.5 py-0.5 text-xs font-bold text-bg">
                      {t.unread_count}
                    </span>
                  )}
                </div>
                <p className="truncate text-xs text-fg-muted">{t.property_title}</p>
                {t.last_message && (
                  <p className={`truncate text-sm ${unread ? 'text-fg' : 'text-fg-muted'}`}>
                    {t.last_message.sender_id === userId ? 'You: ' : ''}
                    {t.last_message.text}
                  </p>
                )}
              </button>
            )
          })}
        </nav>

        {/* ---------- Conversation ---------- */}
        {selectedId ? (
          <Conversation key={selectedId} threadId={selectedId} userId={userId} role={role} />
        ) : (
          <div className="flex min-h-64 items-center justify-center rounded-2xl border border-dashed border-line p-6 text-fg-muted">
            Pick a conversation.
          </div>
        )}
      </div>
    </section>
  )
}

// ---------- One conversation ----------

const STATUS_TEXT: Record<DeliveryStatus, string> = { sent: 'Sent', delivered: 'Delivered', read: 'Read' }

function Conversation({ threadId, userId, role }: { threadId: string; userId: string; role: Role }) {
  const [thread, setThread] = useState<ThreadSummary | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState<string | null>(null)
  // The key of a failed send, reused if the same text is sent again (no double messages).
  const [lastAttempt, setLastAttempt] = useState<{ text: string; key: string } | null>(null)

  const seenIds = useRef(new Set<string>()) // message ids already shown, to spot new ones
  const bottomRef = useRef<HTMLDivElement>(null)

  // Load the thread once, and its messages now and every 5 s. Listing them marks our
  // incoming messages "read" on the server (C3a), so new ones tell the badge to update.
  useEffect(() => {
    let ignore = false
    const loadMessages = () =>
      listMessages({ thread_id: threadId, user_id: userId })
        .then((r) => {
          if (ignore) return
          const fresh = r.items.filter((m) => !seenIds.current.has(m.message_id))
          r.items.forEach((m) => seenIds.current.add(m.message_id))
          setMessages(r.items)
          setError(null)
          setLoading(false)
          if (fresh.some((m) => m.receiver_id === userId)) announceMessagesChanged()
        })
        .catch((err: unknown) => {
          if (ignore) return
          setError(errorMessage(err))
          setLoading(false)
        })
    getThread({ thread_id: threadId, user_id: userId })
      .then((t) => {
        if (!ignore) setThread(t)
      })
      .catch((err: unknown) => {
        if (!ignore) setError(errorMessage(err))
      })
    loadMessages()
    const timer = setInterval(loadMessages, CONVERSATION_EVERY_MS)
    return () => {
      ignore = true
      clearInterval(timer)
    }
  }, [threadId, userId, attempt])

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'nearest' })
  }, [messages.length])

  async function send(event?: FormEvent) {
    event?.preventDefault()
    const text = draft.trim()
    if (text === '') return
    const key = lastAttempt?.text === text ? lastAttempt.key : newIdempotencyKey()
    setLastAttempt({ text, key })
    setSending(true)
    setSendError(null)
    try {
      const sent = await sendMessage({ thread_id: threadId, sender_id: userId, message_text: text, idempotency_key: key })
      seenIds.current.add(sent.message_id)
      setMessages((prev) => (prev.some((m) => m.message_id === sent.message_id) ? prev : [...prev, sent]))
      setDraft('')
      setLastAttempt(null)
      announceMessagesChanged() // the thread list shows the new last message
    } catch (err) {
      setSendError(errorMessage(err))
    } finally {
      setSending(false)
    }
  }

  // Enter sends; Shift+Enter makes a new line.
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      send()
    }
  }

  if (error && !thread) {
    return (
      <ErrorBanner
        message={error}
        onRetry={() => {
          setError(null)
          setLoading(true)
          setAttempt((n) => n + 1)
        }}
      />
    )
  }

  return (
    <article data-conversation={threadId} className="flex flex-col rounded-2xl border border-line bg-surface">
      {/* Header: who, which listing, which reservation */}
      <header className="border-b border-line p-4">
        {thread ? (
          <>
            <p className="font-condensed text-xl font-bold">{otherName(thread, role)}</p>
            <p className="text-sm text-fg-muted">
              About{' '}
              <Link to={`/properties/${thread.property_id}`} className="text-fg-soft hover:underline">
                {thread.property_title}
              </Link>
              {thread.reservation_id && (
                <>
                  {' · '}
                  <Link
                    to={role === 'guest' ? `/guest/trips/${thread.reservation_id}` : '/host/reservations'}
                    className="font-mono text-fg-soft hover:underline"
                  >
                    {thread.reservation_id}
                  </Link>
                </>
              )}
            </p>
          </>
        ) : (
          <p className="text-fg-muted">Loading…</p>
        )}
      </header>

      {/* Messages */}
      <div className="max-h-[55vh] min-h-64 space-y-3 overflow-y-auto p-4" aria-live="polite">
        {loading && <p className="text-fg-muted">Loading messages…</p>}
        {!loading && messages.length === 0 && <p className="text-fg-muted">No messages yet. Say hello!</p>}
        {messages.map((m) => {
          const mine = m.sender_id === userId
          return (
            <div key={m.message_id} data-message={m.message_id} className={`flex flex-col ${mine ? 'items-end' : 'items-start'}`}>
              <p
                className={`max-w-[75%] rounded-2xl px-4 py-2 whitespace-pre-wrap ${
                  mine ? 'border border-primary/40 bg-primary/15 text-fg' : 'bg-surface-2 text-fg'
                }`}
              >
                {m.message_text}
              </p>
              <p className="mt-0.5 text-xs text-fg-muted">
                {formatDateTime(m.timestamp)}
                {mine && <span data-delivery={m.delivery_status}> · {STATUS_TEXT[m.delivery_status]}</span>}
              </p>
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>
      {error && thread && <div className="px-4"><ErrorBanner message={error} /></div>}

      {/* Send box */}
      <form onSubmit={send} className="space-y-2 border-t border-line p-4">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          rows={2}
          maxLength={MESSAGE_TEXT_MAX}
          aria-label="Write a message"
          placeholder="Write a message… (Enter to send, Shift+Enter for a new line)"
          className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-2 text-fg placeholder:text-fg-muted focus:border-gold focus:outline-none"
        />
        {sendError && <ErrorBanner message={sendError} onDismiss={() => setSendError(null)} />}
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={sending || draft.trim() === ''}
            className="rounded-full bg-primary px-5 py-2 font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending ? 'Sending…' : 'Send'}
          </button>
        </div>
      </form>
    </article>
  )
}

export default MessagesPage
