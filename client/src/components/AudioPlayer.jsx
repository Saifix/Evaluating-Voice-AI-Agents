/**
 * AudioPlayer — appears once the conversation.wav is ready.
 *
 * Props:
 *   ready  boolean — true after "done" event received
 */
import Icon from './Icon'

export default function AudioPlayer({ ready }) {
  if (!ready) {
    return (
      <div className="audio-player">
        <div className="audio-player-title">Call Recording</div>
        <p className="audio-placeholder">
          Recording will appear here when the simulation ends.
        </p>
      </div>
    )
  }

  const src = `/api/audio?t=${Date.now()}`

  return (
    <div className="audio-player">
      <div className="audio-player-title">Call Recording</div>
      {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
      <audio controls src={src} autoPlay={false} />
      <a className="download-link" href={src} download="conversation.wav">
        <Icon name="download" size="sm" />
        Download conversation.wav
      </a>
    </div>
  )
}
