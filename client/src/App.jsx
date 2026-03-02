import { useState, useEffect, useRef, useCallback } from 'react'
import Icon            from './components/Icon'
import ControlBar      from './components/ControlBar'
import TranscriptPanel from './components/TranscriptPanel'
import AudioPlayer     from './components/AudioPlayer'
import SettingsPanel   from './components/SettingsPanel'
import EvalReport      from './components/EvalReport'
import Dashboard       from './components/Dashboard'

const NAV = [
  { id: 'dashboard',  icon: 'dashboard',  label: 'Dashboard'  },
  { id: 'simulation', icon: 'simulation', label: 'Simulation' },
  { id: 'evaluation', icon: 'evaluation', label: 'Evaluation' },
  { id: 'settings',   icon: 'settings',   label: 'Settings'   },
]

const PAGE_META = {
  dashboard:  { title: 'Dashboard',          sub: 'Overview of your voice bot evaluation platform' },
  simulation: { title: 'Simulation',         sub: 'Run a live call between the AI agent (Nova) and the simulated caller (Sage)' },
  evaluation: { title: 'Quality Evaluation', sub: 'Promptfoo-based assessment across 8 helpdesk call criteria' },
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
  const [transcript, setTranscript] = useState([])
  const [audioReady, setAudioReady] = useState(false)
  const [error, setError]           = useState(null)
  const [lastRunTurns, setLastRunTurns] = useState(null)
  const [evalScore, setEvalScore]   = useState(null)
  const [evalPassRate, setEvalPassRate] = useState(null)
  const [theme, setTheme]           = useState(getInitialTheme)
  const esRef        = useRef(null)
  const transcriptRef = useRef([])

  // Apply theme attribute to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    try { localStorage.setItem('theme', theme) } catch { /* ignore */ }
  }, [theme])

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark')

  // Keep ref in sync for SSE callback
  useEffect(() => { transcriptRef.current = transcript }, [transcript])

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
          setPhase('running'); setTranscript([]); setAudioReady(false)
          setError(null); setStatusText('Simulation started')
          break
        case 'status':
          setStatusText(ev.text)
          break
        case 'transcript':
          setTranscript(prev => [...prev, { turn: ev.turn, speaker: ev.speaker, text: ev.text }])
          break
        case 'done':
          setPhase('done'); setAudioReady(true)
          setStatusText('Simulation complete  recording ready.')
          setLastRunTurns(transcriptRef.current.length)
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

  const handleStart = async () => {
    setError(null); setTranscript([]); setAudioReady(false)
    const res = await fetch('/api/start', { method: 'POST' })
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
          {page === 'simulation' && phase === 'done' && (
            <button className="btn btn-primary" onClick={() => setPage('evaluation')}>
              <Icon name="evaluation" size="sm" />
              Run Evaluation
            </button>
          )}
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
              />
              {error && <div className="error-banner">{error}</div>}
              <TranscriptPanel entries={transcript} phase={phase} />
              <AudioPlayer ready={audioReady} />
            </div>
          )}

          {page === 'evaluation' && <EvalReport />}

          {page === 'settings' && <SettingsPanel />}

        </div>
      </div>
    </div>
  )
}