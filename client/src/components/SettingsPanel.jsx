import { useState, useEffect, useRef } from 'react'
import Icon from './Icon'

const VOICE_OPTIONS         = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse']
const TTS_MODELS            = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']
const NOVA_REALTIME_MODELS  = ['gpt-4o-realtime-preview', 'gpt-4o-mini-realtime-preview']
const SAGE_CHAT_MODELS      = ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']
const EVAL_MODELS           = ['gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']

export default function SettingsPanel() {
  const [form, setForm]       = useState(null)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState(null)
  const formRef               = useRef(null)
  const autoSaveTimer         = useRef(null)

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(data => { setForm(data); formRef.current = data; setLoading(false) })
      .catch(() => { setErr('Could not load configuration.'); setLoading(false) })
  }, [])

  const set = (key, value) => setForm(prev => {
    const next = { ...prev, [key]: value }
    formRef.current = next
    return next
  })

  // Persist criteria to server immediately (silent — main Save still works for all other fields)
  const autoSaveCriteria = async (updatedCriteria) => {
    const base = formRef.current || {}
    try {
      await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, criteria: updatedCriteria }),
      })
    } catch { /* silent */ }
  }

  //  Criteria helpers 
  const updateCriterion = (idx, field, value) => {
    const updated = [...(form.criteria || [])]
    updated[idx] = { ...updated[idx], [field]: value }
    set('criteria', updated)
    // Debounced auto-save so rapid typing doesn't spam the server
    clearTimeout(autoSaveTimer.current)
    autoSaveTimer.current = setTimeout(() => autoSaveCriteria(updated), 800)
  }

  const addCriterion = () => {
    const id = `c_${Date.now()}`
    const updated = [...(form.criteria || []), { id, name: '', description: '', passMark: 7 }]
    set('criteria', updated)
    autoSaveCriteria(updated)
  }

  const removeCriterion = (idx) => {
    const updated = (form.criteria || []).filter((_, i) => i !== idx)
    set('criteria', updated)
    autoSaveCriteria(updated)
  }

  const handleSave = async e => {
    e.preventDefault()
    setSaved(false); setErr(null)
    try {
      const res = await fetch('/api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      setSaved(true)
      setTimeout(() => setSaved(false), 3000)
    } catch (e) {
      setErr('Save failed: ' + e.message)
    }
  }

  if (loading) return <div className="settings-loading">Loading settings...</div>
  if (!form)   return <div className="settings-loading error-text">{err}</div>

  return (
    <form className="settings-panel" onSubmit={handleSave}>

      {/* API */}
      <section className="settings-section">
        <h2 className="settings-section-title">API</h2>
        <div className="field-group">
          <label className="field-label">OpenAI API Key</label>
          <p className="field-hint">Leave blank to use the <code>OPENAI_API_KEY</code> env variable.</p>
          <input type="password" className="field-input"
            placeholder="sk-...  (leave blank to use .env)"
            value={form.openaiApiKey || ''} autoComplete="off"
            onChange={e => set('openaiApiKey', e.target.value)} />
        </div>
      </section>

      {/* Conversation */}
      <section className="settings-section">
        <h2 className="settings-section-title">Conversation</h2>

        <div className="field-row">
          <div className="field-group field-group--half">
            <label className="field-label">Max Exchanges</label>
            <p className="field-hint">Back-and-forth turns before bots wrap up (3 - 30).</p>
            <input type="number" className="field-input field-input--short" min={3} max={30}
              value={form.maxExchanges ?? 10}
              onChange={e => set('maxExchanges', Number(e.target.value))} />
          </div>

          <div className="field-group field-group--half">
            <label className="field-label">Simulation Runs</label>
            <p className="field-hint">How many simulations to launch per Start click (1 - 5).</p>
            <input type="number" className="field-input field-input--short" min={1} max={20}
              value={form.simCount ?? 1}
              onChange={e => set('simCount', Number(e.target.value))} />
          </div>
        </div>
      </section>

      {/* Evaluation */}
      <section className="settings-section">
        <h2 className="settings-section-title">Evaluation</h2>
        <div className="field-group">
          <label className="field-label">Evaluator Model</label>
          <p className="field-hint">The OpenAI model used to score each criterion. Used by both promptfoo and the direct OpenAI fallback.</p>
          <select className="field-select" value={form.evalModel || 'gpt-4.1'}
            onChange={e => set('evalModel', e.target.value)}>
            {EVAL_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
      </section>

      {/* Evaluation Criteria */}
      <section className="settings-section">
        <h2 className="settings-section-title">Evaluation Criteria</h2>
        <p className="field-hint" style={{ marginBottom: 16 }}>
          Each criterion is scored 0-10 by the LLM evaluator. The <strong>Pass Mark</strong> sets
          the minimum score to pass. Changes take effect on the next evaluation run.
        </p>

        <div className="criteria-editor-list">
          {(form.criteria || []).map((c, idx) => (
            <div key={c.id || idx} className="criteria-editor-item">
              <div className="criteria-editor-header">
                <input
                  className="field-input criteria-name-input"
                  placeholder="Criterion name (e.g. Professional Greeting)"
                  value={c.name || ''}
                  onChange={e => updateCriterion(idx, 'name', e.target.value)}
                />
                <div className="criteria-passmark-group">
                  <label className="sim-count-label">Pass</label>
                  <input type="number" className="field-input field-input--tiny"
                    min={0} max={10}
                    value={c.passMark ?? 7}
                    onChange={e => updateCriterion(idx, 'passMark', Number(e.target.value))} />
                  <span className="criteria-passmark-denom">/10</span>
                </div>
                <button type="button" className="btn-icon btn-icon--danger"
                  onClick={() => removeCriterion(idx)} title="Remove criterion">
                  <Icon name="x" size="sm" />
                </button>
              </div>
              <textarea
                className="field-textarea criteria-desc-input"
                rows={2}
                placeholder="What should the evaluator assess? (e.g. Did Nova greet the caller professionally...?)"
                value={c.description || ''}
                onChange={e => updateCriterion(idx, 'description', e.target.value)}
              />
            </div>
          ))}
        </div>

        <button type="button" className="btn btn-secondary criteria-add-btn" onClick={addCriterion}>
          + Add Criterion
        </button>
      </section>

      {/* Nova */}
      <section className="settings-section">
        <h2 className="settings-section-title">Nova — GPT-4o Realtime</h2>

        <div className="field-group">
          <label className="field-label">Realtime Model</label>
          <select className="field-select" value={form.novaModel || 'gpt-4o-realtime-preview'}
            onChange={e => set('novaModel', e.target.value)}>
            {NOVA_REALTIME_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">Voice</label>
          <select className="field-select" value={form.novaVoice || 'alloy'}
            onChange={e => set('novaVoice', e.target.value)}>
            {VOICE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">Opening Topic</label>
          <p className="field-hint">The prompt Nova uses to open the conversation.</p>
          <textarea className="field-textarea" rows={3} value={form.novaTopic || ''}
            onChange={e => set('novaTopic', e.target.value)} />
        </div>

        <div className="field-group">
          <label className="field-label">System Instructions</label>
          <p className="field-hint">Nova's personality and conversation rules.</p>
          <textarea className="field-textarea" rows={6} value={form.novaInstructions || ''}
            onChange={e => set('novaInstructions', e.target.value)} />
        </div>
      </section>

      {/* Sage */}
      <section className="settings-section">
        <h2 className="settings-section-title">Sage — GPT-4.1 + TTS</h2>

        <div className="field-group">
          <label className="field-label">Chat Model</label>
          <select className="field-select" value={form.sageModel || 'gpt-4.1'}
            onChange={e => set('sageModel', e.target.value)}>
            {SAGE_CHAT_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">TTS Model</label>
          <select className="field-select" value={form.ttsModel || 'tts-1'}
            onChange={e => set('ttsModel', e.target.value)}>
            {TTS_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">STT Model</label>
          <input type="text" className="field-input" value={form.sttModel || ''}
            onChange={e => set('sttModel', e.target.value)} />
        </div>

        <div className="field-group">
          <label className="field-label">Voice</label>
          <select className="field-select" value={form.sageVoice || 'echo'}
            onChange={e => set('sageVoice', e.target.value)}>
            {VOICE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">System Instructions</label>
          <p className="field-hint">Sage's personality and wrapping rules. Use <code>MAX_EXCHANGES</code> as placeholder for the exchange count.</p>
          <textarea className="field-textarea" rows={8} value={form.sageInstructions || ''}
            onChange={e => set('sageInstructions', e.target.value)} />
        </div>
      </section>

      {/* Save */}
      <div className="settings-footer">
        {err   && <span className="settings-msg settings-msg--error">{err}</span>}
        {saved && <span className="settings-msg settings-msg--ok">Settings saved</span>}
        <button type="submit" className="btn btn-primary">Save Settings</button>
      </div>
    </form>
  )
}