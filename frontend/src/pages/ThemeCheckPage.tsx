// Developer-only page (at /theme-check) to eyeball the Cedar & Rye theme tokens.
// Not part of the spec: delete this file and its route once the theme is settled.

// Token names from the @theme block in index.css.
const colorTokens = [
  'bg', 'surface', 'surface-2', 'line', 'line-strong',
  'fg', 'fg-soft', 'fg-muted',
  'cream', 'cream-ink', 'cream-ink-soft', 'cream-border', 'white',
  'primary', 'on-primary', 'mustard', 'mustard-border', 'verdict', 'teal',
  'pill', 'pill-border',
  'status-ok', 'status-pending', 'status-error', 'status-error-border',
  'agent-matcher', 'agent-risk', 'agent-fairness', 'agent-chair', 'agent-parser', 'agent-explanation',
  'chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5', 'chart-6',
]

function ThemeCheckPage() {
  return (
    <section className="space-y-10">
      <h1 className="font-display text-5xl font-extrabold">
        Cedar <span className="text-primary">&amp;</span> Rye
      </h1>

      <div>
        <h2 className="mb-3 font-condensed text-xl font-bold tracking-[0.08em] uppercase">Colors</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {colorTokens.map((name) => (
            <div key={name} className="rounded-2xl border border-line bg-surface p-2">
              {/* Reads the token's CSS variable, so this shows exactly what the theme defines. */}
              <div className="h-12 rounded-xl border border-line" style={{ backgroundColor: `var(--color-${name})` }} />
              <p className="mt-2 font-mono text-xs text-fg-muted">{name}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3">
        <h2 className="font-condensed text-xl font-bold tracking-[0.08em] uppercase">Fonts</h2>
        <p className="font-display text-3xl font-bold">Fraunces: The Debate</p>
        <p className="font-condensed text-2xl font-bold tracking-[0.06em] uppercase">Barlow Condensed: 28 stays near San Jose · $212</p>
        <p>Barlow: body and UI text for everything else on the page.</p>
        <p className="font-mono">DM Mono: trace_id 7f3a9c21-4b8e · 2026-11-23 14:05:09</p>
      </div>

      <div className="space-y-3 rounded-2xl bg-cream p-4 text-cream-ink">
        <p className="font-semibold">Cream strip with cream-ink text</p>
        <p className="text-cream-ink-soft">Secondary text on cream</p>
        <div className="flex gap-2">
          <span className="rounded-full border border-mustard-border bg-mustard px-3 py-1 text-sm font-semibold">Active chip</span>
          <span className="rounded-full border border-cream-border bg-white px-3 py-1 text-sm">Inactive chip</span>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button type="button" className="rounded-full bg-primary px-5 py-2 font-semibold text-on-primary">Primary button</button>
        <button type="button" className="rounded-full border border-line-strong px-5 py-2 font-semibold text-fg">Secondary button</button>
        <span className="rounded-full border border-pill-border bg-pill px-3 py-1 font-condensed text-lg font-bold">$212 / night</span>
        <span className="text-status-ok">Approved</span>
        <span className="text-status-pending">Pending</span>
        <span className="text-status-error">Declined</span>
      </div>
    </section>
  )
}

export default ThemeCheckPage
