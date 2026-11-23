import { Link } from 'react-router'

function NotFoundPage() {
  return (
    <section>
      <h1 className="font-condensed text-3xl font-bold tracking-[0.06em] uppercase">Page not found</h1>
      <p className="mt-2 text-fg-muted">There is no page at this address.</p>
      <Link to="/" className="mt-4 inline-block text-primary hover:underline">
        Back to search
      </Link>
    </section>
  )
}

export default NotFoundPage
