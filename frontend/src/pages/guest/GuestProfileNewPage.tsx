// Create a new guest profile (P3a). On success, "Viewing as" switches to the new guest.
import { Link, useNavigate } from 'react-router'
import { createGuest } from '../../api/users'
import GuestProfileForm from '../../components/GuestProfileForm'
import { useCurrentUser } from '../../context/useCurrentUser'

function GuestProfileNewPage() {
  const navigate = useNavigate()
  const { setGuestId, refreshUsers } = useCurrentUser()

  return (
    <section className="max-w-3xl space-y-6">
      <Link to="/guest/profile" className="text-sm font-semibold text-fg-muted hover:text-fg">
        ← My profile
      </Link>
      <h1 className="font-display text-4xl font-bold">New guest profile</h1>
      <GuestProfileForm
        submitLabel="Create profile"
        onCancel={() => navigate('/guest/profile')}
        onSubmit={async (fields) => {
          const created = await createGuest(fields)
          setGuestId(created.guest_id) // act as the new guest from now on
          refreshUsers() // so the new guest appears in "Viewing as"
          navigate('/guest/profile', { state: { notice: `Welcome, ${created.first_name}! Your profile was created (${created.guest_id}).` } })
        }}
      />
    </section>
  )
}

export default GuestProfileNewPage
