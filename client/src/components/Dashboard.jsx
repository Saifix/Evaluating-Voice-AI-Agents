import Icon from './Icon'

export default function Dashboard({ onNavigate, stats }) {
  const { lastRun, evalScore, passRate } = stats || {}

  const scoreColor = evalScore == null
    ? 'blue'
    : evalScore >= 8 ? 'green' : evalScore >= 6 ? 'amber' : 'red'

  return (
    <div>

      {/* Stat cards */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Last Simulation</div>
          <div className="stat-value blue">
            {lastRun ? lastRun.turns : ''}
          </div>
          <div className="stat-sub">
            {lastRun ? `${lastRun.turns} transcript turns` : 'No simulation yet'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Eval Score</div>
          <div className={`stat-value ${scoreColor}`}>
            {evalScore != null ? evalScore.toFixed(1) : ''}
          </div>
          <div className="stat-sub">
            {evalScore != null ? 'out of 10.0' : 'No evaluation run'}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Criteria Pass Rate</div>
          <div className={`stat-value ${passRate >= 80 ? 'green' : passRate >= 50 ? 'amber' : 'blue'}`}>
            {passRate != null ? `${passRate}%` : ''}
          </div>
          <div className="stat-sub">
            {passRate != null ? 'criteria passed (7/10)' : 'Run an evaluation'}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="section-label">Quick Actions</div>
      <div className="quick-actions-grid">
        <div className="action-card">
          <div className="action-card-icon">
            <Icon name="simulation" size="lg" />
          </div>
          <div className="action-card-title">Run Simulation</div>
          <div className="action-card-desc">
            Start a live call between the AI helpdesk agent (Nova) and the
            simulated customer (Sage). The conversation is recorded and a
            full transcript is saved.
          </div>
          <button className="btn btn-primary" onClick={() => onNavigate('simulation')}>
            <Icon name="play" size="sm" />
            Start Simulation
          </button>
        </div>

        <div className="action-card">
          <div className="action-card-icon">
            <Icon name="evaluation" size="lg" />
          </div>
          <div className="action-card-title">Evaluate Transcript</div>
          <div className="action-card-desc">
            Run the promptfoo-based QA suite against the latest transcript.
            Each call is scored across 8 helpdesk quality criteria using
            GPT-4.1 as the evaluator.
          </div>
          <button className="btn btn-ghost" onClick={() => onNavigate('evaluation')}>
            Open Evaluation
          </button>
        </div>
      </div>

      {/* Agent status */}
      <div className="section-label">Agent Configuration</div>
      <div className="agent-status-grid">
        <div className="agent-status-card">
          <div className="agent-dot agent-dot--blue" />
          <div>
            <div className="agent-status-name">Nova  Helpdesk Agent</div>
            <div className="agent-status-role">GPT-4o Realtime API  Voice interaction</div>
          </div>
        </div>
        <div className="agent-status-card">
          <div className="agent-dot agent-dot--green" />
          <div>
            <div className="agent-status-name">Sage  Simulated Caller</div>
            <div className="agent-status-role">GPT-4.1 + Whisper-1 + TTS-1</div>
          </div>
        </div>
      </div>

      {/* Eval criteria overview */}
      <div className="section-label" style={{ marginTop: 28 }}>Evaluation Criteria</div>
      <div className="criteria-overview-grid">
        {[
          { icon: 'user-check',      name: 'Professional Greeting', desc: 'Intro and offer to help' },
          { icon: 'wrench',          name: 'Issue Description',      desc: 'Capture full issue detail' },
          { icon: 'map-pin',         name: 'Site and Location',      desc: 'Site name and address' },
          { icon: 'phone',           name: 'Contact Details',        desc: 'Caller name and number' },
          { icon: 'alert-triangle',  name: 'Priority Assessment',    desc: 'Emergency / High / Medium / Low' },
          { icon: 'clipboard-check', name: 'Details Confirmation',   desc: 'Read back before closing' },
          { icon: 'file-text',       name: 'Job Reference',          desc: 'Reference number provided' },
          { icon: 'award',           name: 'Overall Quality',        desc: 'Professionalism and empathy' },
        ].map(c => (
          <div key={c.name} className="criteria-overview-card">
            <span className="criteria-overview-icon">
              <Icon name={c.icon} size="md" />
            </span>
            <div>
              <div className="criteria-overview-name">{c.name}</div>
              <div className="criteria-overview-desc">{c.desc}</div>
            </div>
          </div>
        ))}
      </div>

    </div>
  )
}