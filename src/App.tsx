import { Routes, Route } from 'react-router-dom'
import Placeholder from './screens/Placeholder.tsx'
import Join from './screens/Join.tsx'
import Camera from './screens/Camera.tsx'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder />} />
      <Route path="/j/:eventToken" element={<Join />} />
      <Route path="/c/:eventToken" element={<Camera />} />
      {/* Catch-all: unknown deep links fall back to the shell instead of a blank page. */}
      <Route path="*" element={<Placeholder />} />
    </Routes>
  )
}
