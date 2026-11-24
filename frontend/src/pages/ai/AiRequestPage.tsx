// AI Assistant request box (/ai): describe the stay in plain words (U4a), optionally
// turn on the demo failure modes, then watch the debate on /ai/tasks/:taskId.
import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { createAiRequest } from '../../api/ai'
import { BRAND } from '../../brand'
import { errorMessage } from '../../api/client'
import ErrorBanner from '../../components/ErrorBanner'
import { useCurrentUser } from '../../context/useCurrentUser'

// The spec's demo request (section 11).
const EXAMPLE =
  'I need a two-night stay in San Jose for two people, under $250 per night, with parking and a kitchen, rating ≥ 4.5'

function AiRequestPage() {
  const navigate = useNavigate()
  const { guestId } = useCurrentUser()
  const [text, setText] = useState('')
  const [delayRisk, setDelayRisk] = useState(false)
  const [invalidOutput, setInvalidOutput] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    setSending(true)
    setError(null)
    try {
      const created = await createAiRequest({
        guest_id: guestId,
        request_text: text.trim(),
        demo: { delay_risk_agent: delayRisk, invalid_agent_output: invalidOutput },
      })
      navigate(`/ai/tasks/${created.task_id}`)
    } catch (err) {
      setError(errorMessage(err))
      setSending(false)
    }
  }

  return (
    <section className="max-w-3xl space-y-6">
      <div className="space-y-2">
        <h1 className="font-display text-4xl font-bold">AI Assistant</h1>
        <p className="text-fg-soft">
          Describe your trip in your own words. {BRAND.name}’s agents each rank the stays, argue about them in the open, and you
          approve, edit or reject what they recommend. Nothing is booked without you.
        </p>
      </div>

      <form onSubmit={submit} className="space-y-4 rounded-2xl border border-line bg-surface p-5">
        <label className="block space-y-1">
          <span className="font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">What are you looking for?</span>
          <textarea
            required
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={4}
            maxLength={500}
            placeholder="e.g. 2 nights in San Jose for 2, under $250, parking, kitchen, rating ≥ 4.5"
            className="w-full rounded-2xl border border-line bg-surface-2 px-4 py-3 text-fg placeholder:text-fg-muted focus:border-mustard focus:outline-none"
          />
        </label>
        <button type="button" onClick={() => setText(EXAMPLE)} className="text-sm font-semibold text-primary hover:underline">
          Use the example request
        </button>

        <fieldset className="space-y-2 rounded-xl border border-line p-3">
          <legend className="px-1 font-condensed text-xs font-bold tracking-[0.08em] text-fg-muted uppercase">Demo failure modes</legend>
          <label className="flex items-center gap-2 text-sm text-fg-soft">
            <input type="checkbox" checked={delayRisk} onChange={(e) => setDelayRisk(e.target.checked)} className="h-4 w-4 accent-primary" />
            Delay Risk agent (timeout)
          </label>
          <label className="flex items-center gap-2 text-sm text-fg-soft">
            <input type="checkbox" checked={invalidOutput} onChange={(e) => setInvalidOutput(e.target.checked)} className="h-4 w-4 accent-primary" />
            Return one invalid agent output
          </label>
        </fieldset>

        {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

        <button
          type="submit"
          disabled={sending || text.trim() === ''}
          className="rounded-full bg-primary px-6 py-2.5 font-semibold text-on-primary hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {sending ? 'Starting the debate…' : 'Ask the agents'}
        </button>
      </form>
    </section>
  )
}

export default AiRequestPage
