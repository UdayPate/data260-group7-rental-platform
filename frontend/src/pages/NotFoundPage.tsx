import { Link } from 'react-router'

function NotFoundPage() {
  return (
    <section>
      <h1 className="cornice font-display text-3xl font-bold">Page not found</h1>
      <p className="mt-2 text-fg-muted">There is no page at this address.</p>
      <Link to="/" className="mt-4 inline-block text-primary hover:underline">
        Back to search
      </Link>
    </section>
  )
}

export default NotFoundPage
