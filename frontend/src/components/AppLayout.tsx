import { Outlet } from 'react-router'
import Header from './Header'

// Wraps every page: the header on top, then the current page (<Outlet />) below it.
function AppLayout() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-6xl px-6 py-8">
        <Outlet />
      </main>
    </>
  )
}

export default AppLayout
