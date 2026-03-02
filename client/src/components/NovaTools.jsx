/**
 * NovaTools.jsx
 *
 * Editor for Nova's Realtime function-calling tools.
 * Three execution modes:
 *   static — fixed JSON response (hardcoded lookup data)
 *   http   — calls an external HTTP endpoint with the tool args as body
 *   code   — runs sandboxed JS on the server (Math, Date, JSON, etc. available)
 */

import { useState, useEffect, useCallback } from 'react'
import { createPortal } from 'react-dom'

// ── Sample data for the help modal ─────────────────────────────────────────
const SAMPLES = [
  {
    mode: 'static',
    title: 'Static Response',
    about:
      'Returns a fixed JSON value every time — no computation, no network call. ' +
      'Perfect for read-only reference data that rarely changes, like opening hours, ' +
      'contact numbers, or priority definitions.',
    tool: {
      name: 'get_business_hours',
      description:
        'Returns Joblogic helpdesk operating hours. Use when the caller asks what time the office is open or when they can call back.',
      parameters: JSON.stringify({ type: 'object', properties: {} }, null, 2),
      execution: 'static',
      staticResponse: JSON.stringify({
        weekdays:  'Mon–Fri 08:00–18:00',
        saturday:  'Sat 09:00–13:00',
        sunday:    'Closed',
        emergency: '24/7 emergency on-call line available',
      }, null, 2),
      httpMethod: 'POST', httpUrl: '', httpHeaders: '{}', codeBody: '',
    },
  },
  {
    mode: 'http',
    title: 'HTTP Endpoint',
    about:
      'Calls an external API with the tool arguments as the JSON request body. ' +
      'Use for live data — job status from your CRM, customer records, stock levels, etc. ' +
      'Content-Type: application/json is added automatically.',
    tool: {
      name: 'lookup_job_status',
      description:
        'Look up the live status of a service job by its reference number (e.g. JL-48291). ' +
        'Call this when the caller wants to know the current status of an existing job.',
      parameters: JSON.stringify({
        type: 'object',
        properties: {
          reference: { type: 'string', description: 'Job reference number, e.g. JL-48291' },
        },
        required: ['reference'],
      }, null, 2),
      execution: 'http',
      httpMethod: 'POST',
      httpUrl: 'https://your-api.example.com/api/jobs/status',
      httpHeaders: JSON.stringify({ Authorization: 'Bearer YOUR_TOKEN' }, null, 2),
      staticResponse: '{"result":"ok"}', codeBody: '',
    },
  },
  {
    mode: 'code',
    title: 'Code (local JS)',
    about:
      'Runs a JavaScript function body on the server in a sandboxed VM (Node vm module) — ' +
      'no network required. The variable args holds the parsed arguments from GPT. ' +
      'Available globals: Math, Date, JSON, Number, String, Boolean, Object, Array, ' +
      'parseInt, parseFloat, isNaN, isFinite.',
    tool: {
      name: 'calculate_sla_deadline',
      description:
        'Calculates the SLA response deadline based on priority level. ' +
        'Use when the caller confirms their priority and wants to know when an engineer will attend.',
      parameters: JSON.stringify({
        type: 'object',
        properties: {
          priority: {
            type: 'string',
            enum: ['Emergency', 'High', 'Medium', 'Low'],
            description: 'Job priority level',
          },
        },
        required: ['priority'],
      }, null, 2),
      execution: 'code',
      codeBody: `const hours = { Emergency: 2, High: 4, Medium: 24, Low: 72 };
const h = hours[args.priority] || 24;
const deadline = new Date(Date.now() + h * 60 * 60 * 1000);
return {
  priority: args.priority,
  sla_hours: h,
  target_by: deadline.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }),
  message: \`A \${args.priority} priority job targets attendance within \${h} hour\${h === 1 ? '' : 's'}.\`,
};`,
      staticResponse: '{"result":"ok"}', httpMethod: 'POST', httpUrl: '', httpHeaders: '{}',
    },
  },
]

// ── Helpers ─────────────────────────────────────────────────────────────────
const DEFAULT_PARAMS = JSON.stringify(
  { type: 'object', properties: { input: { type: 'string', description: 'Input value' } }, required: [] },
  null, 2
)

const DEFAULT_CODE = `// args contains the parsed arguments from GPT
// Available: Math, Date, JSON, Number, String, Object, Array, parseInt, parseFloat
const { input } = args;
return { result: input };`

const EXEC_LABELS = { static: 'Static', http: 'HTTP', code: 'Code' }

const DEFAULT_TOOL = () => ({
  id: `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
  name: '',
  description: '',
  parameters: DEFAULT_PARAMS,
  execution: 'static',
  staticResponse: '{"result": "ok"}',
  httpMethod: 'POST',
  httpUrl: '',
  httpHeaders: '{}',
  codeBody: DEFAULT_CODE,
})

const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE']

function parseJsonSafe(str) {
  try { JSON.parse(str); return null; }
  catch (e) { return e.message; }
}

function checkCodeSyntax(body) {
  try { new Function('args', body); return null; } // eslint-disable-line no-new-func
  catch (e) { return e.message; }
}

function validateTool(tool) {
  const errs = {}
  if (!tool.name.trim()) errs.name = 'Name is required'
  else if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(tool.name.trim()))
    errs.name = 'Use letters, digits, underscores only (no spaces)'
  if (!tool.description.trim()) errs.description = 'Description is required'
  const paramErr = parseJsonSafe(tool.parameters)
  if (paramErr) errs.parameters = 'Invalid JSON: ' + paramErr
  if (tool.execution === 'static') {
    const err = parseJsonSafe(tool.staticResponse)
    if (err) errs.staticResponse = 'Invalid JSON: ' + err
  } else if (tool.execution === 'http') {
    if (!tool.httpUrl.trim()) errs.httpUrl = 'URL is required'
    const err = parseJsonSafe(tool.httpHeaders)
    if (err) errs.httpHeaders = 'Invalid JSON: ' + err
  } else if (tool.execution === 'code') {
    if (!tool.codeBody?.trim()) errs.codeBody = 'Code body is required'
    else {
      const err = checkCodeSyntax(tool.codeBody)
      if (err) errs.codeBody = 'Syntax error: ' + err
    }
  }
  return errs
}

// ── HelpModal ───────────────────────────────────────────────────────────────
function HelpModal({ onClose, onUse }) {
  const [tab, setTab]       = useState(0)
  const [copied, setCopied] = useState(false)
  const s = SAMPLES[tab]

  function copy() {
    const lines = [
      `name: ${s.tool.name}`,
      `description: ${s.tool.description}`,
      `parameters:\n${s.tool.parameters}`,
      s.tool.execution === 'static'
        ? `staticResponse:\n${s.tool.staticResponse}`
        : s.tool.execution === 'http'
          ? `httpMethod: ${s.tool.httpMethod}\nhttpUrl: ${s.tool.httpUrl}\nhttpHeaders:\n${s.tool.httpHeaders}`
          : `codeBody:\n${s.tool.codeBody}`,
    ].join('\n\n')
    navigator.clipboard?.writeText(lines).then(() => {
      setCopied(true); setTimeout(() => setCopied(false), 2000)
    })
  }

  return createPortal(
    <div className="nt-modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="nt-modal">
        <div className="nt-modal-header">
          <h2 className="nt-modal-title">How to use Nova Tools</h2>
          <button className="btn btn-ghost nt-modal-close" onClick={onClose}>✕</button>
        </div>

        <div className="nt-modal-tabs">
          {SAMPLES.map((s, i) => (
            <button
              key={i}
              className={`nt-modal-tab ${tab === i ? 'nt-modal-tab--active' : ''}`}
              onClick={() => { setTab(i); setCopied(false) }}
            >
              {s.title}
            </button>
          ))}
        </div>

        <div className="nt-modal-body">
          <p className="nt-modal-about">{s.about}</p>

          <div className="nt-modal-sample">
            <div className="nt-modal-sample-header">
              <span className="nt-modal-sample-label">Sample — <code>{s.tool.name}</code></span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn btn-ghost btn-sm" onClick={copy}>
                  {copied ? 'Copied' : 'Copy'}
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => { onUse(s.tool); onClose() }}
                >+ Add as tool</button>
              </div>
            </div>
            <div className="nt-modal-fields">
              <ModalField label="Function Name" value={s.tool.name} mono />
              <ModalField label="Description"   value={s.tool.description} />
              <ModalField label="Parameters (JSON Schema)" value={s.tool.parameters} code />
              {s.tool.execution === 'static' && (
                <ModalField label="Static Response (JSON)" value={s.tool.staticResponse} code />
              )}
              {s.tool.execution === 'http' && (<>
                <ModalField label="HTTP Method" value={s.tool.httpMethod} mono />
                <ModalField label="URL"         value={s.tool.httpUrl}    mono />
                <ModalField label="Headers (JSON)" value={s.tool.httpHeaders} code />
              </>)}
              {s.tool.execution === 'code' && (
                <ModalField label="Code Body (JS — use args.* for inputs, return an object)" value={s.tool.codeBody} code />
              )}
            </div>
          </div>

          {s.tool.execution === 'code' && (
            <div className="nt-modal-tip">
              <strong>Tip:</strong> Runs in a Node.js <code>vm</code> sandbox — no <code>require</code>,
              no <code>fetch</code>, no file system. Use <strong>HTTP</strong> mode for network calls.
            </div>
          )}
          {s.tool.execution === 'http' && (
            <div className="nt-modal-tip">
              <strong>Tip:</strong> Replace the example URL and <code>YOUR_TOKEN</code> with real values.
              Tool arguments from GPT are sent as the JSON request body.
            </div>
          )}
          {s.tool.execution === 'static' && (
            <div className="nt-modal-tip">
              <strong>Tip:</strong> Static responses never change at runtime.
              For dynamic dates or computed values, use <strong>Code</strong> mode.
            </div>
          )}
        </div>
      </div>
    </div>,
    document.body
  )
}

function ModalField({ label, value, mono, code }) {
  return (
    <div className="nt-modal-field">
      <div className="nt-modal-field-label">{label}</div>
      <div className={`nt-modal-field-value${code || mono ? ' nt-modal-field-value--code' : ''}`}>
        {value}
      </div>
    </div>
  )
}

// ── ToolCard ────────────────────────────────────────────────────────────────
function ToolCard({ tool, onChange, onDelete }) {
  const [open, setOpen] = useState(!tool.name)
  const [errs, setErrs] = useState({})

  function set(field, val) {
    const next = { ...tool, [field]: val }
    onChange(next)
    const newErrs = validateTool(next)
    setErrs(Object.fromEntries(Object.entries(newErrs).filter(([k]) => errs[k] !== undefined)))
  }

  function blur() {
    setErrs(validateTool(tool))
  }

  const hasErrors = Object.keys(validateTool(tool)).length > 0

  return (
    <div className={`nt-card ${hasErrors ? 'nt-card--err' : tool.name ? 'nt-card--ok' : ''}`}>
      {/* ── Card header ── */}
      <div className="nt-card-header" onClick={() => setOpen(o => !o)}>
        <span className={`nt-exec-badge nt-exec--${tool.execution}`}>
          {EXEC_LABELS[tool.execution] || tool.execution}
        </span>
        <span className="nt-fn-name">{tool.name || <em className="nt-unnamed">unnamed</em>}</span>
        {tool.description && (
          <span className="nt-fn-desc">{tool.description}</span>
        )}
        <div className="nt-card-actions">
          {hasErrors && <span className="nt-err-badge">!</span>}
          <button
            className="btn btn-ghost btn-xs"
            onClick={e => { e.stopPropagation(); onDelete() }}
            title="Delete tool"
          >✕</button>
          <span className="nt-chevron">{open ? '▲' : '▼'}</span>
        </div>
      </div>

      {open && (
        <div className="nt-editor">
          {/* Row 1: name + execution toggle */}
          <div className="nt-row nt-row--two">
            <div className="field-group">
              <label className="field-label">Function Name <span className="nt-hint">(snake_case)</span></label>
              <input
                className={`field-input ${errs.name ? 'field-input--err' : ''}`}
                value={tool.name}
                placeholder="e.g. get_job_status"
                onChange={e => set('name', e.target.value)}
                onBlur={blur}
              />
              {errs.name && <div className="nt-field-error">{errs.name}</div>}
            </div>
            <div className="field-group">
              <label className="field-label">Execution Mode</label>
              <div className="nt-exec-toggle">
                {['static', 'http', 'code'].map(mode => (
                  <button
                    key={mode}
                    className={`nt-exec-btn ${tool.execution === mode ? 'nt-exec-btn--active' : ''}`}
                    onClick={() => set('execution', mode)}
                  >
                    {EXEC_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Description */}
          <div className="field-group">
            <label className="field-label">Description <span className="nt-hint">(tells GPT when to call this tool)</span></label>
            <textarea
              className={`field-input nt-textarea nt-textarea--desc ${errs.description ? 'field-input--err' : ''}`}
              value={tool.description}
              placeholder="e.g. Look up the status of a Joblogic service job by reference number."
              onChange={e => set('description', e.target.value)}
              onBlur={blur}
              rows={2}
            />
            {errs.description && <div className="nt-field-error">{errs.description}</div>}
          </div>

          {/* Parameters JSON Schema */}
          <div className="field-group">
            <label className="field-label">
              Parameters <span className="nt-hint">(JSON Schema — defines what arguments GPT provides)</span>
            </label>
            <textarea
              className={`field-input nt-textarea nt-textarea--code ${errs.parameters ? 'field-input--err' : ''}`}
              value={tool.parameters}
              onChange={e => set('parameters', e.target.value)}
              onBlur={blur}
              rows={6}
              spellCheck={false}
            />
            {errs.parameters && <div className="nt-field-error">{errs.parameters}</div>}
          </div>

          {/* ── Execution-specific fields ── */}
          {tool.execution === 'static' && (
            <div className="field-group">
              <label className="field-label">
                Static Response <span className="nt-hint">(JSON — returned instantly, no computation)</span>
              </label>
              <textarea
                className={`field-input nt-textarea nt-textarea--code ${errs.staticResponse ? 'field-input--err' : ''}`}
                value={tool.staticResponse}
                onChange={e => set('staticResponse', e.target.value)}
                onBlur={blur}
                rows={4}
                spellCheck={false}
              />
              {errs.staticResponse && <div className="nt-field-error">{errs.staticResponse}</div>}
            </div>
          )}

          {tool.execution === 'http' && (<>
            <div className="nt-row nt-row--http">
              <div className="field-group field-group--method">
                <label className="field-label">Method</label>
                <select
                  className="field-input nt-method-select"
                  value={tool.httpMethod}
                  onChange={e => set('httpMethod', e.target.value)}
                >
                  {HTTP_METHODS.map(m => <option key={m}>{m}</option>)}
                </select>
              </div>
              <div className="field-group field-group--url">
                <label className="field-label">URL</label>
                <input
                  className={`field-input ${errs.httpUrl ? 'field-input--err' : ''}`}
                  value={tool.httpUrl}
                  placeholder="https://api.example.com/endpoint"
                  onChange={e => set('httpUrl', e.target.value)}
                  onBlur={blur}
                />
                {errs.httpUrl && <div className="nt-field-error">{errs.httpUrl}</div>}
              </div>
            </div>
            <div className="field-group">
              <label className="field-label">
                Headers <span className="nt-hint">(JSON object — merged with Content-Type: application/json)</span>
              </label>
              <textarea
                className={`field-input nt-textarea nt-textarea--code ${errs.httpHeaders ? 'field-input--err' : ''}`}
                value={tool.httpHeaders}
                onChange={e => set('httpHeaders', e.target.value)}
                onBlur={blur}
                rows={3}
                spellCheck={false}
              />
              {errs.httpHeaders && <div className="nt-field-error">{errs.httpHeaders}</div>}
            </div>
          </>)}

          {tool.execution === 'code' && (
            <div className="field-group">
              <label className="field-label">
                Code Body{' '}
                <span className="nt-hint">(<code>args</code> has GPT's input — <code>return</code> a JSON-serialisable value)</span>
              </label>
              <div className="nt-code-hint">
                Available: <code>Math</code> · <code>Date</code> · <code>JSON</code> · <code>Number</code> ·{' '}
                <code>String</code> · <code>Object</code> · <code>Array</code> · <code>parseInt</code> ·{' '}
                <code>parseFloat</code> · <code>isNaN</code> · <code>isFinite</code>
              </div>
              <textarea
                className={`field-input nt-textarea nt-textarea--code nt-textarea--tall ${errs.codeBody ? 'field-input--err' : ''}`}
                value={tool.codeBody || ''}
                onChange={e => set('codeBody', e.target.value)}
                onBlur={blur}
                rows={8}
                spellCheck={false}
              />
              {errs.codeBody && <div className="nt-field-error">{errs.codeBody}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function NovaTools() {
  const [tools, setTools]     = useState([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving]   = useState(false)
  const [saved, setSaved]     = useState(false)
  const [error, setError]     = useState(null)
  const [showHelp, setShowHelp] = useState(false)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(cfg => {
        setTools(cfg.novaTools || [])
        setLoading(false)
      })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  const addTool = (preset) => {
    const t = { ...DEFAULT_TOOL(), ...(preset || {}) }
    t.id = `tool_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
    setTools(ts => [...ts, t])
    setSaved(false)
  }

  const updateTool = useCallback((id, next) => {
    setTools(ts => ts.map(t => t.id === id ? next : t))
    setSaved(false)
  }, [])

  const deleteTool = useCallback((id) => {
    setTools(ts => ts.filter(t => t.id !== id))
    setSaved(false)
  }, [])

  async function save() {
    setSaving(true); setError(null); setSaved(false)
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ novaTools: tools }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setError(e.message)
    } finally {
      setSaving(false)
    }
  }

  const validCount   = tools.filter(t => Object.keys(validateTool(t)).length === 0 && t.name).length
  const invalidCount = tools.length - validCount

  if (loading) return <div className="nova-tools"><p className="nt-loading">Loading…</p></div>

  return (
    <div className="nova-tools">
      {showHelp && (
        <HelpModal
          onClose={() => setShowHelp(false)}
          onUse={preset => { addTool(preset); setShowHelp(false) }}
        />
      )}

      {/* ── Toolbar ── */}
      <div className="nt-toolbar">
        <div className="nt-toolbar-left">
          <button className="btn btn-primary" onClick={() => addTool()}>+ Add Tool</button>
          <button className="btn btn-ghost" onClick={() => setShowHelp(true)}>How to use</button>
          {tools.length > 0 && (
            <>
              <span className="nt-summary-chip nt-summary--valid">{validCount} valid</span>
              {invalidCount > 0 && (
                <span className="nt-summary-chip nt-summary--invalid">{invalidCount} with errors</span>
              )}
            </>
          )}
        </div>
        <div className="nt-toolbar-right">
          {error && <span className="nt-inline-error">{error}</span>}
          {saved && <span className="nt-saved-badge">✓ Saved</span>}
          <button
            className="btn btn-primary"
            onClick={save}
            disabled={saving || tools.length === 0}
          >
            {saving ? 'Saving…' : 'Save Tools'}
          </button>
        </div>
      </div>

      {/* ── How it works ── */}
      <div className="nt-info-box">
        <strong>How it works:</strong> Each tool is registered with the GPT Realtime API via{' '}
        <code>session.update</code> when a simulation starts. Nova decides when to call a tool based
        on its description. Three execution modes are available:{' '}
        <strong>Static</strong> — return a fixed JSON response instantly;{' '}
        <strong>HTTP</strong> — call an external API and forward the result; or{' '}
        <strong>Code</strong> — run a small JavaScript function on the server for local computation
        (maths, date logic, lookups, etc.). Click <em>How to use</em> for examples.
      </div>

      {/* ── Tool list ── */}
      {tools.length === 0 ? (
        <div className="nt-empty">
          <p>No tools configured yet.</p>
          <p>Tools let Nova look up or calculate information during calls — job status, SLA deadlines,
             business hours, customer records, and more.</p>
          <div className="nt-empty-actions">
            <button className="btn btn-primary" onClick={() => addTool()}>+ Blank tool</button>
            <button className="btn btn-ghost"   onClick={() => setShowHelp(true)}>See examples</button>
          </div>
        </div>
      ) : (
        <div className="nt-list">
          {tools.map(tool => (
            <ToolCard
              key={tool.id}
              tool={tool}
              onChange={next => updateTool(tool.id, next)}
              onDelete={() => deleteTool(tool.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
