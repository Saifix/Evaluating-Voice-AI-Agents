import { useState, useEffect, useRef, useCallback } from 'react'
import Icon from './Icon'

function scoreClass(s) {
  if (s >= 8) return 'high'
  if (s >= 6) return 'mid'
  return 'low'
}

function buildQ(session, run) {
  const parts = []
  if (session) parts.push(`session=${session}`)
  if (run)     parts.push(`run=${run}`)
  return parts.length ? '?' + parts.join('&') : ''
}

export default function EvalReport() {
  // Session state
  const [sessions, setSessions]           = useState([])
  const [selectedSession, setSelectedSession] = useState(null)
  const selectedSessionRef = useRef(null)
  useEffect(() => { selectedSessionRef.current = selectedSession }, [selectedSession])

  // Run state
  const [runs, setRuns]               = useState([])
  const [selectedRun, setSelectedRun] = useState(null)
  const selectedRunRef = useRef(null)
  useEffect(() => { selectedRunRef.current = selectedRun }, [selectedRun])

  // Eval state
  const [results, setResults]         = useState(null)
  const [runningRuns, setRunningRuns] = useState(new Set())
  const [error, setError]             = useState(null)

  const pollTimers = useRef({})

  const isRunning  = (runNum) => runningRuns.has(runNum ?? 0)
  const anyRunning = runningRuns.size > 0
  const markRunning = (key) => setRunningRuns(prev => new Set([...prev, key]))
  const markDone    = (key) => setRunningRuns(prev => { const n = new Set(prev); n.delete(key); return n })

  const refreshSessions = useCallback(() => {
    fetch('/api/sessions')
      .then(r => r.ok ? r.json() : { sessions: [] })
      .then(d => {
        const list = d.sessions || []
        setSessions(list)
        if (list.length > 0 && selectedSessionRef.current === null) {
          setSelectedSession(list[0].id)
        }
      })
      .catch(() => {})
  }, [])

  const refreshRuns = useCallback((sessionId) => {
    const q = sessionId ? `?session=${sessionId}` : ''
    fetch(`/api/runs${q}`)
      .then(r => r.ok ? r.json() : { runs: [] })
      .then(d => {
        const list = d.runs || []
        setRuns(list)
        if (list.length > 1 && selectedRunRef.current === null) setSelectedRun(1)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    refreshSessions()
    return () => Object.values(pollTimers.current).forEach(clearInterval)
  }, [refreshSessions])

  useEffect(() => {
    setRuns([])
    setSelectedRun(null)
    setResults(null)
    setError(null)
    if (selectedSession === null) return
    refreshRuns(selectedSession)
    fetch(`/api/eval/results?session=${selectedSession}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.criteria) setResults(d) })
      .catch(() => {})
  }, [selectedSession, refreshRuns])

  useEffect(() => {
    const q = buildQ(selectedSession, selectedRun)
    setResults(null)
    fetch(`/api/eval/results${q}`)
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.criteria) setResults(d) })
      .catch(() => {})
  }, [selectedRun]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleRun = async (runNumOverride) => {
    const sess      = selectedSessionRef.current
    const targetRun = runNumOverride !== undefined ? runNumOverride : selectedRunRef.current
    const key       = targetRun ?? 0
    const q         = buildQ(sess, targetRun)

    setError(null)
    markRunning(key)

    try {
      const res = await fetch(`/api/eval/run${q}`, { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }

      clearInterval(pollTimers.current[key])
      pollTimers.current[key] = setInterval(async () => {
        try {
          const r = await fetch(`/api/eval/results${q}`)
          if (r.ok) {
            const d = await r.json()
            if (d?.criteria) {
              if (key === (selectedRunRef.current ?? 0)) setResults(d)
              clearInterval(pollTimers.current[key])
              delete pollTimers.current[key]
              markDone(key)
            }
          }
        } catch { /* keep polling */ }
      }, 2000)
    } catch (e) {
      setError(e.message)
      markDone(key)
    }
  }

  const handleRunAll = () => {
    setError(null)
    runs.filter(r => r.transcript).forEach(r => handleRun(r.num))
  }

  const overall       = results?.overallScore ?? 0
  const sc            = scoreClass
  const criteriaCount = results?.totalCount ?? 8
  const evalableRuns  = runs.filter(r => r.transcript).length

  return (
    <div>

      {/* Session selector */}
      <div className="session-selector-row">
        <span className="session-selector-label">
          <Icon name="activity" size="xs" />
          Session:
        </span>
        {sessions.length === 0 ? (
          <span className="session-empty-hint">No sessions yet  run a simulation first.</span>
        ) : (
          <div className="session-tabs">
            {sessions.map(s => (
              <button
                key={s.id}
                className={`session-tab${selectedSession === s.id ? ' active' : ''}`}
                onClick={() => setSelectedSession(s.id)}
                title={`${s.label}  ${s.runCount} run${s.runCount !== 1 ? 's' : ''}  ${s.createdAt ? new Date(s.createdAt).toLocaleString() : ''}`}
              >
                {s.label}
                <span className="session-tab-count">{s.runCount}r</span>
              </button>
            ))}
          </div>
        )}
        <button
          className="btn btn-secondary btn--xs"
          onClick={refreshSessions}
          title="Refresh session list"
        >
          <Icon name="activity" size="xs" />
        </button>
      </div>

      {/* Header row */}
      <div className="eval-header-row">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p className="eval-subtitle">
            {criteriaCount} {criteriaCount === 1 ? 'criterion' : 'criteria'} evaluated by GPT-4.1
            against the simulation transcript.
          </p>
          {results && (
            <span className="eval-engine-badge">
              <Icon name={results.engine === 'promptfoo' ? 'zap' : 'cpu'} size="xs" />
              {results.engine === 'promptfoo' ? 'promptfoo CLI' : 'OpenAI Direct'}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {evalableRuns > 1 && (
            <button
              className="btn btn-secondary"
              onClick={handleRunAll}
              disabled={anyRunning}
              title="Evaluate all runs in this session simultaneously"
            >
              {anyRunning
                ? <><span className="btn-spinner" /> Evaluating {runningRuns.size}/{evalableRuns}</>
                : <><Icon name="zap" size="sm" /> Evaluate All</>}
            </button>
          )}
          <button
            className="btn btn-primary"
            onClick={() => handleRun()}
            disabled={isRunning(selectedRun) || sessions.length === 0}
          >
            {isRunning(selectedRun)
              ? <><span className="btn-spinner" /> Evaluating</>
              : <><Icon name="evaluation" size="sm" /> Run Evaluation</>}
          </button>
        </div>
      </div>

      {/* Run selector */}
      {runs.length > 1 && (
        <div className="run-selector">
          <span className="run-selector-label">Run:</span>
          <div className="run-selector-tabs">
            {runs.map(r => (
              <button
                key={r.num}
                className={`run-tab${selectedRun === r.num ? ' active' : ''}${isRunning(r.num) ? ' run-tab--evaluating' : ''}`}
                onClick={() => setSelectedRun(r.num)}
                disabled={!r.transcript}
                title={r.transcript ? `Run ${r.num}` : `Run ${r.num} (no transcript)`}
              >
                {isRunning(r.num) && <span className="run-tab-spinner" />}
                Run {r.num}
              </button>
            ))}
            <button
              className={`run-tab${selectedRun === null ? ' active' : ''}`}
              onClick={() => setSelectedRun(null)}
            >
              Latest
            </button>
          </div>
          <button
            className="btn btn-secondary btn--sm"
            onClick={() => refreshRuns(selectedSession)}
            title="Refresh run list"
          >
            <Icon name="activity" size="xs" />
          </button>
        </div>
      )}

      {error && <div className="error-banner" style={{ marginBottom: 20 }}>{error}</div>}

      {isRunning(selectedRun) && !results && (
        <div className="eval-running">
          <div className="eval-running-spinner" />
          <div className="eval-running-title">Running evaluation</div>
          <div className="eval-running-desc">
            Checking transcript against quality criteria via GPT-4.1.
            This may take 20 to 60 seconds.
          </div>
        </div>
      )}

      {!isRunning(selectedRun) && !results && !error && sessions.length > 0 && (
        <div className="eval-empty">
          <div className="eval-empty-icon">
            <Icon name="clipboard-list" size="xl" />
          </div>
          <div className="eval-empty-title">No evaluation results yet</div>
          <div className="eval-empty-desc">
            Complete a simulation call on the Simulation page, then click
            Run Evaluation above.
          </div>
        </div>
      )}

      {results && (
        <>
          <div className="eval-score-card">
            <div className="eval-score-ring">
              <div className={`eval-score-number ${sc(overall)}`}>{overall.toFixed(1)}</div>
              <div className="eval-score-denom">/ 10</div>
            </div>
            <div className="eval-score-meta">
              <div className="eval-score-headline">
                {overall >= 8 ? 'Excellent call quality'
                  : overall >= 6 ? 'Good call quality'
                  : 'Needs improvement'}
              </div>
              <div className="eval-pass-row">
                <span className="pass-chip pass">
                  <Icon name="check" size="xs" />{results.passCount} passed
                </span>
                <span className="pass-chip fail">
                  <Icon name="x" size="xs" />{results.totalCount - results.passCount} failed
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginTop: 4 }}>
                {results.passCount}/{results.totalCount} criteria passed
              </div>
            </div>
          </div>

          <div className="eval-criteria-grid">
            {results.criteria.map((c, i) => (
              <div key={i} className={`criteria-card ${c.pass ? 'pass-border' : 'fail-border'}`}>
                <div className="criteria-top">
                  <div className="criteria-name">{c.name}</div>
                  <div className={`criteria-score-badge ${sc(c.score)}`}>
                    {c.score}<span style={{ fontSize: '0.65em', opacity: 0.7 }}>/10</span>
                  </div>
                </div>
                <div className="score-bar-track">
                  <div className={`score-bar-fill ${sc(c.score)}`} style={{ width: `${c.score * 10}%` }} />
                </div>
                <div className={`criteria-pass-tag ${c.pass ? 'pass' : 'fail'}`}>
                  <Icon name={c.pass ? 'check' : 'x'} size="xs" />
                  {c.pass ? 'Pass' : 'Fail'}
                </div>
                {c.reasoning && <div className="criteria-reasoning">{c.reasoning}</div>}
              </div>
            ))}
          </div>

          {results.timestamp && (
            <div className="eval-timestamp">
              Evaluated {new Date(results.timestamp).toLocaleString()}
              {selectedSession ? `  Session ${selectedSession}` : ''}
              {selectedRun ? `  Run ${selectedRun}` : ''}
              {results.engine === 'promptfoo' ? ' via promptfoo CLI' : ' via OpenAI Direct'}
            </div>
          )}
        </>
      )}

    </div>
  )
}
