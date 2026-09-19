import { Routes, Route } from 'react-router-dom'
import Placeholder from './screens/Placeholder.tsx'
import Join from './screens/Join.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder />} />
      <Route path="/j/:eventToken" element={<Join />} />
      {/* Catch-all: unknown deep links fall back to the shell instead of a blank page. */}
      <Route path="*" element={<Placeholder />} />
    </Routes>
  )
}
