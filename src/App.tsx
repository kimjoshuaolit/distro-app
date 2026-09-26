import { Routes, Route } from 'react-router-dom'
import Placeholder from './screens/Placeholder.tsx'
import Join from './screens/Join.tsx'
import Camera from './screens/Camera.tsx'
import Roll from './screens/Roll.tsx'
import Reveal from './screens/Reveal.tsx'
import Operator from './screens/Operator.tsx'

// My Roll is bundled eagerly on purpose: it must open offline (there's no
// service worker to precache a lazy chunk), and a failed chunk fetch would
// blank the whole app. It only adds a few KB.

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder />} />
      <Route path="/j/:eventToken" element={<Join />} />
      <Route path="/c/:eventToken" element={<Camera />} />
      <Route path="/r/:eventToken" element={<Roll />} />
      {/* The couple's reveal (Epic 2): magic-link sign-in, event-scoped by RLS.
          The shelf and each guest's roll share one Reveal (same gate, one
          collection load); the child routes only select what it shows. */}
      <Route path="/reveal/:eventId" element={<Reveal />}>
        <Route index element={null} />
        <Route path="roll/:guestId" element={null} />
      </Route>
      {/* Kim's operator console (Epic 3): magic-link sign-in; the database
          decides who the operator is. Child routes only select the view. */}
      <Route path="/operator" element={<Operator />}>
        <Route index element={null} />
        <Route path="events/new" element={null} />
        <Route path="events/:eventId" element={null} />
      </Route>
      {/* Catch-all: unknown deep links fall back to the shell instead of a blank page. */}
      <Route path="*" element={<Placeholder />} />
    </Routes>
  )
}
