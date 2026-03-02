import { useState, useEffect, useRef, useCallback } from 'react'
import Icon            from './components/Icon'
import ControlBar      from './components/ControlBar'
import TranscriptPanel from './components/TranscriptPanel'
import AudioPlayer     from './components/AudioPlayer'
import SettingsPanel   from './components/SettingsPanel'
import EvalReport      from './components/EvalReport'
import Dashboard       from './components/Dashboard'
import ApiTester       from './components/ApiTester'
import NovaTools       from './components/NovaTools'

const NAV = [
  { id: 'dashboard',  icon: 'dashboard',  label: 'Dashboard'  },
  { id: 'simulation', icon: 'simulation', label: 'Simulation' },
  { id: 'evaluation', icon: 'evaluation', label: 'Evaluation' },
  { id: 'api-tester', icon: 'activity',   label: 'API Tester' },
  { id: 'nova-tools', icon: 'settings',   label: 'Nova Tools' },
  { id: 'settings',   icon: 'settings',   label: 'Settings'   },
]

const PAGE_META = {
  dashboard:  { title: 'Dashboard',          sub: 'Overview of your voice bot evaluation platform' },
  simulation: { title: 'Simulation',         sub: 'Run a live call between the AI agent (Nova) and the simulated caller (Sage)' },
  evaluation: { title: 'Quality Evaluation', sub: 'Promptfoo-based assessment across 8 helpdesk call criteria' },
  'api-tester': { title: 'API Tester',       sub: 'Test HTTP endpoints — inspect status, latency, response size and keys' },
  'nova-tools':  { title: 'Nova Tools',        sub: 'Define function-calling tools that Nova can invoke during live calls' },
  settings:   { title: 'Settings',           sub: 'Configure agents, models, voices and conversation parameters' },
}

function getInitialTheme() {
  try {
    const stored = localStorage.getItem('theme')
    if (stored === 'light' || stored === 'dark') return stored
  } catch { /* ignore */ }
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export default function App() {
  const [page, setPage]             = useState('dashboard')
  const [phase, setPhase]           = useState('idle')
  const [statusText, setStatusText] = useState('Ready')
  const [transcriptsPerRun, setTranscriptsPerRun] = useState({})
  const [audioReady, setAudioReady] = useState(false)
  const [error, setError]           = useState(null)
  const [lastRunTurns, setLastRunTurns] = useState(null)
  const [evalScore, setEvalScore]   = useState(null)
  const [evalPassRate, setEvalPassRate] = useState(null)
  const [theme, setTheme]           = useState(getInitialTheme)
  const [simCount, setSimCount]     = useState(1)
  const [simTotal, setSimTotal]     = useState(1)
  const [simCompleted, setSimCompleted] = useState(0)
  const [currentSession, setCurrentSession] = useState(null)
  const esRef        = useRef(null)
  const transcriptRef = useRef({})

  // Apply theme attribute to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  // Keep ref in sync for SSE callback
  useEffect(() => { transcriptRef.current = transcriptsPerRun }, [transcriptsPerRun])

  const connectSSE = useCallback(() => {
    if (esRef.current) esRef.current.close()
    const es = new EventSource('/api/events')
    esRef.current = es

    es.onmessage = ({ data }) => {
      let ev
      try { ev = JSON.parse(data) } catch { return }

      switch (ev.type) {
        case 'connected':
          if (ev.running) setPhase('running')
          break
        case 'started':
          setPhase('running'); setTranscriptsPerRun({}); setAudioReady(false)
          setSimTotal(ev.total || 1); setSimCompleted(0)
          setError(null)
          if (ev.sessionId) setCurrentSession(ev.sessionId)
          setStatusText(ev.total > 1 ? `Starting ${ev.total} simulations…` : 'Simulation started')
          break
        case 'sim_progress':
          setSimCompleted(ev.completed)
          setStatusText(`${ev.completed} / ${ev.total} simulations complete`)
          break
        case 'status':
          setStatusText(ev.text)
          break
        case 'transcript': {
          const rn = ev.runNum || 1
          setTranscriptsPerRun(prev => ({
            ...prev,
            [rn]: [...(prev[rn] || []), { turn: ev.turn, speaker: ev.speaker, text: ev.text }],
          }))
          break
        }
        case 'done':
          setPhase('done'); setAudioReady(true)
          setStatusText(
            (ev.total || 1) > 1
              ? `${ev.total} simulations complete — recordings ready.`
              : 'Simulation complete — recording ready.'
          )
          setSimCompleted(ev.total || 1)
          setLastRunTurns(Object.values(transcriptRef.current).reduce((sum, arr) => sum + arr.length, 0))
          break
        case 'stopped':
          setPhase('idle'); setStatusText('Stopped.')
          break
        case 'error':
          setError(ev.message); setStatusText('Error  check console.')
          break
      }
    }
    es.onerror = () => setStatusText('Connection lost  is the server running?')
  }, [])

  useEffect(() => {
    connectSSE()
    fetch('/api/eval/results')
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (d?.criteria) {
          setEvalScore(d.overallScore)
          setEvalPassRate(Math.round((d.passCount / d.totalCount) * 100))
        }
      })
      .catch(() => {})
    return () => esRef.current?.close()
  }, [connectSSE])

  const handleStart = async (count = 1) => {
    setError(null); setTranscriptsPerRun({}); setAudioReady(false)
    const res = await fetch('/api/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count }),
    })
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setError(body.error || 'Failed to start')
    }
  }

  const handleStop = async () => { await fetch('/api/stop', { method: 'POST' }) }

  const { title, sub } = PAGE_META[page]

  return (
    <div className="app-shell">

      {/* Sidebar */}
      <aside className="sidebar">
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">
            <Icon name="activity" size="lg" />
          </div>
          <div>
            <div className="sidebar-logo-name">Voice Eval</div>
            <div className="sidebar-logo-sub">AI Call Evaluation</div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <span className="nav-section-label">Platform</span>
          {NAV.map(item => (
            <button
              key={item.id}
              className={`nav-item${page === item.id ? ' active' : ''}`}
              onClick={() => setPage(item.id)}
            >
              <span className="nav-item-icon">
                <Icon name={item.icon} size="sm" />
              </span>
              {item.label}
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-footer-brand">
            AI Voice Evaluation
            <span className="sidebar-footer-ver">v2.0  GPT-4o Realtime</span>
          </div>
          <button
            className="theme-toggle"
            onClick={toggleTheme}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
          >
            <Icon name={theme === 'dark' ? 'sun' : 'moon'} size="sm" />
            {theme === 'dark' ? 'Light mode' : 'Dark mode'}
          </button>
        </div>
      </aside>

      {/* Main content */}
      <div className="main-content">
        <div className="page-header">
          <div>
            <div className="page-title">{title}</div>
            <div className="page-subtitle">{sub}</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {currentSession && (
              <span className="session-badge">Session {currentSession}</span>
            )}
            {page === 'simulation' && phase === 'done' && (
              <button className="btn btn-primary" onClick={() => setPage('evaluation')}>
                <Icon name="evaluation" size="sm" />
                Run Evaluation
              </button>
            )}
          </div>
        </div>

        <div className="page-body">

          {page === 'dashboard' && (
            <Dashboard
              onNavigate={setPage}
              stats={{
                lastRun:  lastRunTurns ? { turns: lastRunTurns } : null,
                evalScore,
                passRate: evalPassRate,
              }}
            />
          )}

          {page === 'simulation' && (
            <div className="sim-layout">
              <ControlBar
                phase={phase}
                statusText={statusText}
                onStart={handleStart}
                onStop={handleStop}
                simCount={simCount}
                onSimCountChange={setSimCount}
                simProgress={phase === 'running' ? { completed: simCompleted, total: simTotal } : null}
              />
              {error && <div className="error-banner">{error}</div>}

              {/* Multi-run grid: one box per run */}
              {(() => {
                const runNums = simTotal > 1
                  ? Array.from({ length: simTotal }, (_, i) => i + 1)
                  : [1]
                const multi = runNums.length > 1

                return (
                  <div className={multi ? 'sim-multi-grid' : ''}>
                    {runNums.map(rn => (
                      <div key={rn} className={multi ? 'sim-run-box' : ''}>
                        {multi && (
                          <div className="sim-run-box-header">
                            <span className="sim-run-label">Simulation {rn}</span>
                            {phase === 'done' && (
                              <a
                                className="sim-run-audio-link"
                                href={`/api/audio?run=${rn}&t=${Date.now()}`}
                                download={`conversation-run${rn}.wav`}
                              >
                                <Icon name="download" size="xs" /> Recording
                              </a>
                            )}
                          </div>
                        )}
                        <TranscriptPanel
                          entries={transcriptsPerRun[rn] || []}
                          phase={phase}
                          compact={multi}
                        />
                        {!multi && <AudioPlayer ready={audioReady} runNum={null} />}
                      </div>
                    ))}
                  </div>
                )
              })()}
            </div>
          )}

          {page === 'evaluation' && <EvalReport />}

          {page === 'api-tester' && <ApiTester />}

          {page === 'nova-tools' && <NovaTools />}

          {page === 'settings' && <SettingsPanel />}

        </div>
      </div>
    </div>
  )
}