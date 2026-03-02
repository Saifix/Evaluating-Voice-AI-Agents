import { useState, useEffect } from 'react'

const VOICE_OPTIONS = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'onyx', 'nova', 'sage', 'shimmer', 'verse']
const TTS_MODELS    = ['tts-1', 'tts-1-hd', 'gpt-4o-mini-tts']

export default function SettingsPanel() {
  const [form, setForm]       = useState(null)
  const [saved, setSaved]     = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr]         = useState(null)

  // Load config on mount
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(data => { setForm(data); setLoading(false) })
      .catch(() => { setErr('Could not load configuration.'); setLoading(false) })
  }, [])

  const set = (key, value) => setForm(prev => ({ ...prev, [key]: value }))

  const handleSave = async e => {
    e.preventDefault()
    setSaved(false)
    setErr(null)
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

  if (loading) return <div className="settings-loading">Loading settings…</div>
  if (!form)   return <div className="settings-loading error-text">{err}</div>

  return (
    <form className="settings-panel" onSubmit={handleSave}>

      {/* ── API ──────────────────────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section-title">API</h2>

        <div className="field-group">
          <label className="field-label">OpenAI API Key</label>
          <p className="field-hint">Leave blank to use the <code>OPENAI_API_KEY</code> env variable.</p>
          <input
            type="password"
            className="field-input"
            placeholder="sk-…  (leave blank to use .env)"
            value={form.openaiApiKey || ''}
            onChange={e => set('openaiApiKey', e.target.value)}
            autoComplete="off"
          />
        </div>
      </section>

      {/* ── Conversation ────────────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section-title">Conversation</h2>

        <div className="field-group">
          <label className="field-label">Max Exchanges</label>
          <p className="field-hint">Number of back-and-forth turns before bots wrap up (3 – 30).</p>
          <input
            type="number"
            className="field-input field-input--short"
            min={3} max={30}
            value={form.maxExchanges ?? 10}
            onChange={e => set('maxExchanges', Number(e.target.value))}
          />
        </div>
      </section>

      {/* ── Nova (GPT-4o Realtime) ───────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section-title">Nova — GPT-4o Realtime</h2>

        <div className="field-group">
          <label className="field-label">Voice</label>
          <select className="field-select" value={form.novaVoice || 'alloy'} onChange={e => set('novaVoice', e.target.value)}>
            {VOICE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">Opening Topic</label>
          <p className="field-hint">The prompt Nova uses to open the conversation.</p>
          <textarea
            className="field-textarea"
            rows={3}
            value={form.novaTopic || ''}
            onChange={e => set('novaTopic', e.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label">System Instructions</label>
          <p className="field-hint">Nova's personality and conversation rules.</p>
          <textarea
            className="field-textarea"
            rows={6}
            value={form.novaInstructions || ''}
            onChange={e => set('novaInstructions', e.target.value)}
          />
        </div>
      </section>

      {/* ── Sage (GPT-4.1 + TTS) ─────────────────────────────────────────── */}
      <section className="settings-section">
        <h2 className="settings-section-title">Sage — GPT-4.1 + TTS</h2>

        <div className="field-group">
          <label className="field-label">Chat Model</label>
          <input
            type="text"
            className="field-input"
            value={form.sageModel || ''}
            onChange={e => set('sageModel', e.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label">TTS Model</label>
          <select className="field-select" value={form.ttsModel || 'tts-1'} onChange={e => set('ttsModel', e.target.value)}>
            {TTS_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">STT Model</label>
          <input
            type="text"
            className="field-input"
            value={form.sttModel || ''}
            onChange={e => set('sttModel', e.target.value)}
          />
        </div>

        <div className="field-group">
          <label className="field-label">Voice</label>
          <select className="field-select" value={form.sageVoice || 'echo'} onChange={e => set('sageVoice', e.target.value)}>
            {VOICE_OPTIONS.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>

        <div className="field-group">
          <label className="field-label">System Instructions</label>
          <p className="field-hint">Sage's personality and wrapping rules. Use <code>MAX_EXCHANGES</code> as a placeholder for the exchange count.</p>
          <textarea
            className="field-textarea"
            rows={8}
            value={form.sageInstructions || ''}
            onChange={e => set('sageInstructions', e.target.value)}
          />
        </div>
      </section>

      {/* ── Save ─────────────────────────────────────────────────────────── */}
      <div className="settings-footer">
        {err   && <span className="settings-msg settings-msg--error">{err}</span>}
        {saved && <span className="settings-msg settings-msg--ok">✔ Settings saved</span>}
        <button type="submit" className="btn btn-primary">Save Settings</button>
      </div>
    </form>
  )
}
