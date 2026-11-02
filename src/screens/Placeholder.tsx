import './Placeholder.css'

export default function Placeholder() {
  return (
    <main className="shell">
      <section className="landing" aria-labelledby="brand">
        <div className="landing__band">
          <span className="landing__flash" aria-hidden="true" />
          <span className="landing__model">FunSaver · 2026</span>
          <span className="landing__counter" aria-label="25 photos, 5 clips">
            25 · 5
          </span>
        </div>

        <div className="landing__viewfinder">
          <span className="landing__vf-label">Viewfinder</span>
          <span className="landing__stamp" aria-hidden="true">
            &apos;26 09 19
          </span>
        </div>

        <div className="landing__controls">
          <span className="landing__shutter" aria-hidden="true" />
        </div>

        <h1 id="brand" className="landing__brand">
          Dispo Retro Cam
        </h1>
        <p className="landing__tagline">Shoot the wedding like a disposable camera.</p>
        <p className="landing__note">Loading the film — the camera opens here soon.</p>
      </section>
    </main>
  )
}
