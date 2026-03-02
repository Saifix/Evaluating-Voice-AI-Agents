/**
 * ControlBar — Start / Stop button + live status indicator.
 *
 * Props:
 *   phase      'idle' | 'running' | 'done'
 *   statusText  string shown next to the button
 *   onStart()  called when Start is pressed
 *   onStop()   called when Stop is pressed
 */
import Icon from './Icon'

export default function ControlBar({ phase, statusText, onStart, onStop }) {
  const running = phase === 'running'

  return (
    <div className="control-bar">
      {running ? (
        <button className="btn btn-danger" onClick={onStop}>
          <Icon name="stop" size="sm" /> Stop
        </button>
      ) : (
        <button className="btn btn-success" onClick={onStart} disabled={running}>
          <Icon name="play" size="sm" /> Start Simulation
        </button>
      )}
      {running && <span className="spinner" aria-label="Running" />}
      <span className="status-text">{statusText}</span>
    </div>
  )
}
