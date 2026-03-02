import { useState, useCallback } from 'react'
import Icon from './Icon'

const METHODS    = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']
const METHOD_COLOR = { GET: 'method--get', POST: 'method--post', PUT: 'method--put', PATCH: 'method--patch', DELETE: 'method--delete' }

const STORAGE_KEY = 'apitester_endpoints'

function uid() { return `ep_${Date.now()}_${Math.random().toString(36).slice(2, 7)}` }

function loadSaved() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw)
  } catch { /* ignore */ }
  return [
    { id: uid(), name: 'Server status', method: 'GET', url: '/api/status', headers: '', body: '' },
    { id: uid(), name: 'List sessions', method: 'GET', url: '/api/sessions', headers: '', body: '' },
  ]
}

function save(endpoints) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(endpoints)) } catch { /* ignore */ }
}

function StatusChip({ status }) {
  if (!status && status !== 0) return null
  const cls = status >= 500 ? 'status--5xx' : status >= 400 ? 'status--4xx' : status >= 300 ? 'status--3xx' : status >= 200 ? 'status--2xx' : status === 0 ? 'status--err' : ''
  return <span className={`at-status-chip ${cls}`}>{status || 'ERR'}</span>
}

function MetricPill({ label, value }) {
  return (
    <span className="at-metric-pill">
      <span className="at-metric-label">{label}</span>
      <span className="at-metric-value">{value}</span>
    </span>
  )
}

export default function ApiTester() {
  const [endpoints, setEndpoints] = useState(loadSaved)
  const [results,   setResults]   = useState({})    // keyed by endpoint id
  const [running,   setRunning]   = useState(new Set())
  const [expanded,  setExpanded]  = useState(new Set())
  const [respOpen,  setRespOpen]  = useState(new Set())

  const persist = (eps) => { setEndpoints(eps); save(eps) }

  const updateEp = (id, field, value) => {
    persist(endpoints.map(ep => ep.id === id ? { ...ep, [field]: value } : ep))
  }

  const addEndpoint = () => {
    const id = uid()
    const eps = [...endpoints, { id, name: 'New endpoint', method: 'GET', url: '', headers: '', body: '' }]
    persist(eps)
    setExpanded(prev => new Set([...prev, id]))
  }

  const removeEndpoint = (id) => {
    persist(endpoints.filter(ep => ep.id !== id))
    setResults(prev => { const n = { ...prev }; delete n[id]; return n })
    setExpanded(prev => { const n = new Set(prev); n.delete(id); return n })
  }

  const toggleExpand = (id) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const toggleResp = (id) => setRespOpen(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const runOne = useCallback(async (ep) => {
    if (!ep.url) return
    setRunning(prev => new Set([...prev, ep.id]))
    const start = performance.now()
    let result = {}
    try {
      let headers = { 'Content-Type': 'application/json' }
      if (ep.headers.trim()) {
        try { headers = { ...headers, ...JSON.parse(ep.headers) } }
        catch { result.headerError = 'Invalid headers JSON' }
      }
      const opts = { method: ep.method, headers }
      if (!['GET', 'HEAD'].includes(ep.method) && ep.body.trim()) {
        try { opts.body = JSON.stringify(JSON.parse(ep.body)) }
        catch { result.bodyError = 'Invalid body JSON'; opts.body = ep.body }
      }
      const res  = await fetch(ep.url, opts)
      const latencyMs = Math.round(performance.now() - start)
      const text = await res.text()
      let parsed = null, keys = null
      try {
        parsed = JSON.parse(text)
        if (parsed && typeof parsed === 'object') {
          keys = Array.isArray(parsed)
            ? [`Array[${parsed.length}]`, ...(parsed[0] && typeof parsed[0] === 'object' ? Object.keys(parsed[0]).map(k => `[0].${k}`) : [])]
            : Object.keys(parsed)
        }
      } catch { /* not JSON */ }
      result = {
        ...result,
        status: res.status,
        ok: res.ok,
        latencyMs,
        responseChars: text.length,
        keys,
        rawPreview: text.slice(0, 2000),
        timestamp: new Date().toLocaleTimeString(),
      }
    } catch (e) {
      result = {
        ...result,
        status: 0,
        ok: false,
        latencyMs: Math.round(performance.now() - start),
        error: e.message,
        timestamp: new Date().toLocaleTimeString(),
      }
    }
    setResults(prev => ({ ...prev, [ep.id]: result }))
    setRunning(prev => { const n = new Set(prev); n.delete(ep.id); return n })
  }, [])

  const runAll = () => endpoints.filter(ep => ep.url).forEach(ep => runOne(ep))

  const anyRunning = running.size > 0
  const totalRan   = Object.keys(results).length
  const passCount  = Object.values(results).filter(r => r.ok).length

  return (
    <div className="api-tester">

      {/* ── Toolbar ───────────────────────────────────────────────────── */}
      <div className="at-toolbar">
        <div className="at-toolbar-left">
          {totalRan > 0 && (
            <>
              <span className="at-summary-chip at-summary--pass">{passCount} passed</span>
              <span className="at-summary-chip at-summary--fail">{totalRan - passCount} failed</span>
              <span className="at-summary-chip at-summary--total">{totalRan} run</span>
            </>
          )}
        </div>
        <div className="at-toolbar-right">
          <button className="btn btn-secondary" onClick={addEndpoint}>
            <Icon name="plus" size="sm" /> Add Endpoint
          </button>
          <button
            className="btn btn-primary"
            onClick={runAll}
            disabled={anyRunning || endpoints.filter(e => e.url).length === 0}
          >
            {anyRunning
              ? <><span className="btn-spinner" /> Running…</>
              : <><Icon name="zap" size="sm" /> Run All</>}
          </button>
        </div>
      </div>

      {/* ── Endpoint list ─────────────────────────────────────────────── */}
      {endpoints.length === 0 && (
        <div className="eval-empty">
          <div className="eval-empty-icon"><Icon name="activity" size="xl" /></div>
          <div className="eval-empty-title">No endpoints yet</div>
          <div className="eval-empty-desc">Click "Add Endpoint" to create your first request.</div>
        </div>
      )}

      <div className="at-list">
        {endpoints.map(ep => {
          const res   = results[ep.id]
          const busy  = running.has(ep.id)
          const open  = expanded.has(ep.id)
          const ropen = respOpen.has(ep.id)

          return (
            <div key={ep.id} className={`at-card${res ? (res.ok ? ' at-card--ok' : ' at-card--fail') : ''}`}>

              {/* ── Card header ─────────────────────────────────────── */}
              <div className="at-card-header">
                <span className={`at-method-badge ${METHOD_COLOR[ep.method] || ''}`}>{ep.method}</span>
                <span className="at-card-name" title={ep.name}>{ep.name || <em>Unnamed</em>}</span>
                <span className="at-card-url" title={ep.url}>{ep.url || <em className="at-card-url--empty">no URL set</em>}</span>

                {/* Result metrics — inline */}
                {res && (
                  <div className="at-metric-row">
                    <StatusChip status={res.status} />
                    <MetricPill label="⏱" value={`${res.latencyMs}ms`} />
                    <MetricPill label="chars" value={res.responseChars?.toLocaleString() ?? '—'} />
                    {res.keys && <MetricPill label="keys" value={res.keys.length} />}
                    <span className="at-timestamp">{res.timestamp}</span>
                  </div>
                )}
                {res?.error && <span className="at-error-inline" title={res.error}>⚠ {res.error.slice(0, 60)}</span>}

                <div className="at-card-actions">
                  <button
                    className="btn btn-primary btn--xs"
                    onClick={() => runOne(ep)}
                    disabled={busy || !ep.url}
                    title="Run this endpoint"
                  >
                    {busy ? <><span className="btn-spinner" /></> : <Icon name="zap" size="xs" />}
                    {busy ? 'Running' : 'Run'}
                  </button>
                  <button className="btn btn-secondary btn--xs" onClick={() => toggleExpand(ep.id)} title={open ? 'Collapse' : 'Edit'}>
                    <Icon name={open ? 'chevron-up' : 'settings'} size="xs" />
                  </button>
                  <button className="btn-icon btn-icon--danger" onClick={() => removeEndpoint(ep.id)} title="Remove">
                    <Icon name="x" size="sm" />
                  </button>
                </div>
              </div>

              {/* ── Editor ──────────────────────────────────────────── */}
              {open && (
                <div className="at-editor">
                  <div className="at-editor-row">
                    <div className="field-group" style={{ flex: '0 0 auto' }}>
                      <label className="field-label">Name</label>
                      <input className="field-input" value={ep.name}
                        onChange={e => updateEp(ep.id, 'name', e.target.value)} placeholder="Endpoint name" />
                    </div>
                    <div className="field-group" style={{ flex: '0 0 auto' }}>
                      <label className="field-label">Method</label>
                      <select className={`field-select at-method-select ${METHOD_COLOR[ep.method] || ''}`}
                        value={ep.method} onChange={e => updateEp(ep.id, 'method', e.target.value)}>
                        {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                      </select>
                    </div>
                    <div className="field-group" style={{ flex: 1 }}>
                      <label className="field-label">URL</label>
                      <input className="field-input at-url-input" value={ep.url}
                        onChange={e => updateEp(ep.id, 'url', e.target.value)}
                        placeholder="https://... or /api/..." />
                    </div>
                  </div>

                  <div className="at-editor-row at-editor-row--equal">
                    <div className="field-group">
                      <label className="field-label">Headers <span className="field-hint-inline">(JSON object)</span></label>
                      <textarea className="field-textarea at-code-area" rows={3} value={ep.headers}
                        onChange={e => updateEp(ep.id, 'headers', e.target.value)}
                        placeholder={'{\n  "Authorization": "Bearer ..."\n}'} />
                      {res?.headerError && <span className="at-field-error">{res.headerError}</span>}
                    </div>
                    <div className="field-group">
                      <label className="field-label">Body <span className="field-hint-inline">(JSON object)</span></label>
                      <textarea className="field-textarea at-code-area" rows={3} value={ep.body}
                        onChange={e => updateEp(ep.id, 'body', e.target.value)}
                        placeholder={'{\n  "key": "value"\n}'} />
                      {res?.bodyError && <span className="at-field-error">{res.bodyError}</span>}
                    </div>
                  </div>
                </div>
              )}

              {/* ── Response panel ──────────────────────────────────── */}
              {res && (res.keys || res.rawPreview) && (
                <div className="at-response">
                  <button className="at-response-toggle" onClick={() => toggleResp(ep.id)}>
                    <Icon name={ropen ? 'chevron-up' : 'chevron-down'} size="xs" />
                    {ropen ? 'Hide response' : 'Show response'}
                    {res.keys && (
                      <span className="at-keys-strip">
                        {res.keys.slice(0, 8).map(k => <code key={k} className="at-key-chip">{k}</code>)}
                        {res.keys.length > 8 && <code className="at-key-chip at-key-chip--more">+{res.keys.length - 8}</code>}
                      </span>
                    )}
                  </button>
                  {ropen && (
                    <pre className="at-response-body">{res.rawPreview}{res.rawPreview?.length >= 2000 ? '\n\n… (truncated at 2000 chars)' : ''}</pre>
                  )}
                </div>
              )}

            </div>
          )
        })}
      </div>
    </div>
  )
}
