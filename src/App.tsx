import { Routes, Route } from 'react-router-dom'
import Placeholder from './screens/Placeholder.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder />} />
      {/* Catch-all: unknown deep links fall back to the shell instead of a blank page. */}
      <Route path="*" element={<Placeholder />} />
    </Routes>
  )
}
