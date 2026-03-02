/**
 * ControlBar  Start / Stop + sim-count selector + multi-sim progress bar.
 *
 * Props:
 *   phase           'idle' | 'running' | 'done'
 *   statusText       string shown below the actions
 *   onStart(count)   called when Start is pressed (receives simCount)
 *   onStop()         called when Stop is pressed
 *   simCount         number (1-5), controlled from App
 *   onSimCountChange(n)  update simCount in parent
 *   simProgress      { completed, total } | null
 */
import Icon from './Icon'

export default function ControlBar({
  phase,
  statusText,
  onStart,
  onStop,
  simCount = 1,
  onSimCountChange,
  simProgress,
}) {
  const running = phase === 'running'
  const pct = simProgress && simProgress.total > 1
    ? Math.round((simProgress.completed / simProgress.total) * 100)
    : null

  return (
    <div className="control-bar">
      <div className="control-bar-actions">
        {running ? (
          <button className="btn btn-danger" onClick={onStop}>
            <Icon name="stop" size="sm" /> Stop
          </button>
        ) : (
          <>
            <button className="btn btn-success" onClick={() => onStart(simCount)} disabled={running}>
              <Icon name="play" size="sm" />
              {simCount > 1 ? `Start ${simCount} Simulations` : 'Start Simulation'}
            </button>

            <div className="sim-count-control">
              <label className="sim-count-label">Runs</label>
              <input
                type="number"
                className="field-input field-input--tiny"
                min={1}
                max={20}
                value={simCount}
                onChange={e => onSimCountChange && onSimCountChange(
                  Math.min(20, Math.max(1, parseInt(e.target.value) || 1))
                )}
              />
            </div>
          </>
        )}

        {running && <span className="spinner" aria-label="Running" />}
      </div>

      {/* Multi-sim progress bar (only shown when running >1 sims) */}
      {running && pct !== null && (
        <div className="sim-progress-bar-wrap">
          <div className="sim-progress-track">
            <div className="sim-progress-fill" style={{ width: `${pct}%` }} />
          </div>
          <span className="sim-progress-label">
            {simProgress.completed} / {simProgress.total} complete
          </span>
        </div>
      )}

      <span className="status-text">{statusText}</span>
    </div>
  )
}