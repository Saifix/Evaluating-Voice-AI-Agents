import { useState, useEffect } from 'react'
import Icon from './Icon'

const ICON_CYCLE = [
  'user-check', 'wrench', 'map-pin', 'phone',
  'alert-triangle', 'clipboard-check', 'file-text', 'award',
  'zap', 'activity', 'cpu', 'clipboard-list',
]

export default function Dashboard({ onNavigate, stats }) {
  const { lastRun, evalScore, passRate } = stats || {}
  const [criteria, setCriteria] = useState([])

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (Array.isArray(d?.criteria)) setCriteria(d.criteria) })
      .catch(() => {})
  }, [])

  const scoreColor = evalScore == null
    ? 'blue'
    : evalScore >= 8 ? 'green' : evalScore >= 6 ? 'amber' : 'red'

  return (
    <div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Last Simulation</div>
          <div className="stat-value blue">{lastRun ? lastRun.turns : ''}</div>
          <div className="stat-sub">{lastRun ? `${lastRun.turns} transcript turns` : 'No simulation yet'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Eval Score</div>
          <div className={`stat-value ${scoreColor}`}>{evalScore != null ? evalScore.toFixed(1) : ''}</div>
          <div className="stat-sub">{evalScore != null ? 'out of 10.0' : 'No evaluation run'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Criteria Pass Rate</div>
          <div className={`stat-value ${passRate >= 80 ? 'green' : passRate >= 50 ? 'amber' : 'blue'}`}>
            {passRate != null ? `${passRate}%` : ''}
          </div>
          <div className="stat-sub">{passRate != null ? 'criteria passed (7/10)' : 'Run an evaluation'}</div>
        </div>
      </div>

      <div className="section-label">Quick Actions</div>
      <div className="quick-actions-grid">
        <div className="action-card">
          <div className="action-card-icon"><Icon name="simulation" size="lg" /></div>
          <div className="action-card-title">Run Simulation</div>
          <div className="action-card-desc">
            Start a live call between the AI helpdesk agent (Nova) and the simulated
            customer (Sage). The conversation is recorded and a full transcript is saved.
          </div>
          <button className="btn btn-primary" onClick={() => onNavigate('simulation')}>
            <Icon name="play" size="sm" /> Start Simulation
          </button>
        </div>
        <div className="action-card">
          <div className="action-card-icon"><Icon name="evaluation" size="lg" /></div>
          <div className="action-card-title">Evaluate Transcript</div>
          <div className="action-card-desc">
            Run the QA suite against the latest transcript. Each call is scored across
            {criteria.length > 0 ? ` ${criteria.length}` : ''} quality
            {criteria.length === 1 ? ' criterion' : ' criteria'} using GPT-4.1 as the evaluator.
          </div>
          <button className="btn btn-ghost" onClick={() => onNavigate('evaluation')}>
            Open Evaluation
          </button>
        </div>
      </div>

      <div className="section-label">Agent Configuration</div>
      <div className="agent-status-grid">
        <div className="agent-status-card">
          <div className="agent-dot agent-dot--blue" />
          <div>
            <div className="agent-status-name">Nova Helpdesk Agent</div>
            <div className="agent-status-role">GPT-4o Realtime API Voice interaction</div>
          </div>
        </div>
        <div className="agent-status-card">
          <div className="agent-dot agent-dot--green" />
          <div>
            <div className="agent-status-name">Sage Simulated Caller</div>
            <div className="agent-status-role">GPT-4.1 + Whisper-1 + TTS-1</div>
          </div>
        </div>
      </div>

      {criteria.length > 0 && (
        <>
          <div className="section-label" style={{ marginTop: 28 }}>
            Evaluation Criteria
            <span className="criteria-count-badge">{criteria.length}</span>
          </div>
          <div className="criteria-overview-grid">
            {criteria.map((c, i) => (
              <div key={c.id || i} className="criteria-overview-card">
                <span className="criteria-overview-icon">
                  <Icon name={ICON_CYCLE[i % ICON_CYCLE.length]} size="md" />
                </span>
                <div>
                  <div className="criteria-overview-name">{c.name || `Criterion ${i + 1}`}</div>
                  <div className="criteria-overview-desc">
                    {c.description
                      ? c.description.split(' ').slice(0, 8).join(' ') + (c.description.split(' ').length > 8 ? '...' : '')
                      : `Pass mark: ${c.passMark ?? 7}/10`}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

    </div>
  )
}