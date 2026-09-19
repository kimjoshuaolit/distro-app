import { photoLevel } from './counterLevel.ts'
import './Counter.css'

/** Remaining-shots counter for the camera status bar: `NN · N` (photos · clips). */
export default function Counter({ photos, clips }: { photos: number; clips: number }) {
  const { level, label } = photoLevel(photos)
  return (
    <div className="counter" aria-label={`${photos} photos and ${clips} clips remaining`}>
      <span className={`counter__pair counter__pair--${level}`}>
        <span className="counter__num">{photos}</span>
        <span className="counter__label">{label}</span>
      </span>
      <span className="counter__dot" aria-hidden="true">
        ·
      </span>
      <span className="counter__pair">
        <span className="counter__num">{clips}</span>
        <span className="counter__label">clips</span>
      </span>
    </div>
  )
}
