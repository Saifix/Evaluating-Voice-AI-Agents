/**
 * ControlBar  Start / Stop + sim-count selector + multi-sim progress bar.
 *
 * Props:
 *   phase                    'idle' | 'running' | 'done'
 *   statusText               string shown below the actions
 *   onStart(count, ids)      called when Start is pressed (receives simCount + scenarioIds[])
 *   onStop()                 called when Stop is pressed
 *   simCount                 number (1-20), controlled from App
 *   onSimCountChange(n)      update simCount in parent
 *   simProgress              { completed, total } | null
 *   scenarios                array of { id, name } scenario objects
 *   scenarioAssignments      string[] — scenario id per run-slot ('' = base config)
 *   onScenarioChange(i, id)  called when user changes a slot's scenario
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
  scenarios = [],
  scenarioAssignments = [],
  onScenarioChange,
}) {
  const running = phase === 'running'
  const pct = simProgress && simProgress.total > 1
    ? Math.round((simProgress.completed / simProgress.total) * 100)
    : null

  const showScenarios = !running && simCount > 1 && scenarios.length > 0

  return (
    <div className="control-bar">
      <div className="control-bar-actions">
        {running ? (
          <button className="btn btn-danger" onClick={onStop}>
            <Icon name="stop" size="sm" /> Stop
          </button>
        ) : (
          <>
            <button className="btn btn-success" onClick={() => onStart(simCount, scenarioAssignments)} disabled={running}>
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

      {/* Per-run scenario assignment (shown when >1 run and scenarios exist) */}
      {showScenarios && (
        <div className="scenario-assign-wrap">
          <div className="scenario-assign-heading">Scenario per Run</div>
          <div className="scenario-assign-grid">
            {Array.from({ length: simCount }, (_, i) => (
              <div key={i} className="scenario-assign-row">
                <span className="scenario-run-label">Run {i + 1}</span>
                <select
                  className="field-select field-select--compact"
                  value={scenarioAssignments[i] || ''}
                  onChange={e => onScenarioChange && onScenarioChange(i, e.target.value)}
                >
                  <option value="">Base config</option>
                  {scenarios.map(s => (
                    <option key={s.id} value={s.id}>{s.name || s.id}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

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