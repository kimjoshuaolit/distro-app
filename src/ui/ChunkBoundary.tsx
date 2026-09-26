import { Component, type ReactNode } from 'react'

/**
 * Catches a lazy screen whose chunk failed to load (offline, or a redeploy
 * replaced the chunk's hashed filename) so the app shows a way out instead
 * of a blank page.
 */
export default class ChunkBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  render() {
    if (!this.state.failed) return this.props.children
    return (
      <main className="app-loading" role="alert">
        <p>This page didn’t load — check your connection.</p>
        <button type="button" onClick={() => window.location.reload()}>
          Reload
        </button>
      </main>
    )
  }
}
