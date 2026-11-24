import { Outlet } from 'react-router'
import AssistantLauncher from './ai/AssistantLauncher'
import Header from './Header'

// Wraps every page: the header on top, then the current page (<Outlet />) below it.
// The AI assistant launcher lives here (not in a page) so its current request
// survives moving between pages. It hides itself on host and AI pages.
function AppLayout() {
  return (
    <>
      <Header />
      <main className="mx-auto max-w-7xl px-6 py-8">
        <Outlet />
      </main>
      <AssistantLauncher />
    </>
  )
}

export default AppLayout
