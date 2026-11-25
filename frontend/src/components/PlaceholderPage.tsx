// Temporary stand-in for a page that isn't built yet. It lists what the spec
// requires on that page, so we can see the whole app's shape before building it.
type Props = {
  title: string
  specItems: string[]
}

function PlaceholderPage({ title, specItems }: Props) {
  return (
    <section>
      <h1 className="cornice font-display text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-fg-muted">Not built yet. This page will have:</p>
      <ul className="mt-3 list-disc space-y-1 pl-6 text-fg-soft">
        {specItems.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </section>
  )
}

export default PlaceholderPage
