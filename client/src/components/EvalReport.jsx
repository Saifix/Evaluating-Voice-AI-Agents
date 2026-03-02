import { useState, useEffect, useRef } from 'react'
import Icon from './Icon'

function scoreClass(s) {
  if (s >= 8) return 'high'
  if (s >= 6) return 'mid'
  return 'low'
}

export default function EvalReport() {
  const [results, setResults] = useState(null)
  const [running, setRunning] = useState(false)
  const [error, setError]     = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    fetch('/api/eval/results')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d?.criteria) setResults(d) })
      .catch(() => {})
  }, [])

  useEffect(() => () => clearInterval(pollRef.current), [])

  const handleRun = async () => {
    setError(null)
    setRunning(true)
    try {
      const res = await fetch('/api/eval/run', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || `HTTP ${res.status}`)
      }
      pollRef.current = setInterval(async () => {
        try {
          const r = await fetch('/api/eval/results')
          if (r.ok) {
            const d = await r.json()
            if (d?.criteria) {
              setResults(d)
              setRunning(false)
              clearInterval(pollRef.current)
            }
          }
        } catch { /* keep polling */ }
      }, 2000)
    } catch (e) {
      setError(e.message)
      setRunning(false)
    }
  }

  const overall = results?.overallScore ?? 0
  const sc = scoreClass

  return (
    <div>
      {/* Header row */}
      <div className="eval-header-row">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <p className="eval-subtitle">
            8 criteria evaluated by GPT-4.1 against the latest simulation transcript.
          </p>
          {results && (
            <span className="eval-engine-badge">
              <Icon name={results.engine === 'promptfoo' ? 'zap' : 'cpu'} size="xs" />
              {results.engine === 'promptfoo' ? 'promptfoo CLI' : 'OpenAI Direct'}
            </span>
          )}
        </div>
        <button className="btn btn-primary" onClick={handleRun} disabled={running}>
          {running
            ? <><span className="btn-spinner" /> Evaluating</>
            : <><Icon name="evaluation" size="sm" /> Run Evaluation</>}
        </button>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 20 }}>{error}</div>}

      {/* Running state */}
      {running && !results && (
        <div className="eval-running">
          <div className="eval-running-spinner" />
          <div className="eval-running-title">Running evaluation</div>
          <div className="eval-running-desc">
            Checking transcript against 8 helpdesk quality criteria via GPT-4.1.
            This may take 2060 seconds.
          </div>
          <div className="eval-criteria-pending">
            {['Professional Greeting','Issue Description','Site and Location',
              'Contact Details','Priority Assessment','Details Confirmation',
              'Job Reference','Overall Quality'].map(n => (
              <div key={n} className="criteria-pending-item">
                <span className="criteria-pending-dot" />
                {n}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {!running && !results && !error && (
        <div className="eval-empty">
          <div className="eval-empty-icon">
            <Icon name="clipboard-list" size="xl" />
          </div>
          <div className="eval-empty-title">No evaluation results yet</div>
          <div className="eval-empty-desc">
            Complete a simulation call on the Simulation page, then click
            "Run Evaluation" above.
          </div>
        </div>
      )}

      {/* Results */}
      {results && (
        <>
          {/* Overall score card */}
          <div className="eval-score-card">
            <div className="eval-score-ring">
              <div className={`eval-score-number ${sc(overall)}`}>
                {overall.toFixed(1)}
              </div>
              <div className="eval-score-denom">/ 10</div>
            </div>
            <div className="eval-score-meta">
              <div className="eval-score-headline">
                {overall >= 8
                  ? 'Excellent call quality'
                  : overall >= 6
                  ? 'Good call quality'
                  : 'Needs improvement'}
              </div>
              <div className="eval-pass-row">
                <span className="pass-chip pass">
                  <Icon name="check" size="xs" />
                  {results.passCount} passed
                </span>
                <span className="pass-chip fail">
                  <Icon name="x" size="xs" />
                  {results.totalCount - results.passCount} failed
                </span>
                <span className="pass-chip neutral">
                  Pass threshold  7 / 10
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text2)', marginTop: 4 }}>
                {results.passCount}/{results.totalCount} criteria passed
              </div>
            </div>
          </div>

          {/* Criteria cards */}
          <div className="eval-criteria-grid">
            {results.criteria.map((c, i) => (
              <div
                key={i}
                className={`criteria-card ${c.pass ? 'pass-border' : 'fail-border'}`}
              >
                <div className="criteria-top">
                  <div className="criteria-name">{c.name}</div>
                  <div className={`criteria-score-badge ${sc(c.score)}`}>
                    {c.score}<span style={{ fontSize: '0.65em', opacity: 0.7 }}>/10</span>
                  </div>
                </div>
                <div className="score-bar-track">
                  <div
                    className={`score-bar-fill ${sc(c.score)}`}
                    style={{ width: `${c.score * 10}%` }}
                  />
                </div>
                <div className={`criteria-pass-tag ${c.pass ? 'pass' : 'fail'}`}>
                  <Icon name={c.pass ? 'check' : 'x'} size="xs" />
                  {c.pass ? 'Pass' : 'Fail'}
                </div>
                {c.reasoning && (
                  <div className="criteria-reasoning">{c.reasoning}</div>
                )}
              </div>
            ))}
          </div>

          {results.timestamp && (
            <div className="eval-timestamp">
              Evaluated {new Date(results.timestamp).toLocaleString()} {' '}
              {results.engine === 'promptfoo' ? 'promptfoo CLI' : 'OpenAI Direct'}
            </div>
          )}
        </>
      )}
    </div>
  )
}