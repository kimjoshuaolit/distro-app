import './Placeholder.css'

export default function Placeholder() {
  return (
    <main className="shell">
      <section className="camera" aria-labelledby="brand">
        <div className="camera__band">
          <span className="camera__flash" aria-hidden="true" />
          <span className="camera__model">FunSaver · 2026</span>
          <span className="camera__counter" aria-label="25 photos, 5 clips">
            25 · 5
          </span>
        </div>

        <div className="camera__viewfinder">
          <span className="camera__vf-label">Viewfinder</span>
          <span className="camera__stamp" aria-hidden="true">
            &apos;26 09 19
          </span>
        </div>

        <div className="camera__controls">
          <span className="camera__shutter" aria-hidden="true" />
        </div>

        <h1 id="brand" className="camera__brand">
          Dispo Retro Cam
        </h1>
        <p className="camera__tagline">Shoot the wedding like a disposable camera.</p>
        <p className="camera__note">Loading the film — the camera opens here soon.</p>
      </section>
    </main>
  )
}
