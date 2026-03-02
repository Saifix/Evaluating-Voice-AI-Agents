/**
 * TranscriptPanel — chat-bubble style live transcript.
 *
 * Props:
 *   entries  [{ turn, speaker: 'nova'|'sage', text }]
 *   phase    'idle' | 'running' | 'done'
 */
import { useEffect, useRef } from 'react'

const LABEL = { nova: 'Agent', sage: 'Caller', agent: 'Agent', caller: 'Caller' }

export default function TranscriptPanel({ entries, phase }) {
  const bottomRef = useRef(null)

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [entries])

  return (
    <div className="transcript-panel">
      <div className="transcript-header">
        <span className="transcript-title">Live Transcript</span>
        <div className="transcript-legend">
          <span className="legend-dot agent">Agent (Nova)</span>
          <span className="legend-dot caller">Caller (Sage)</span>
        </div>
      </div>
      <div className="transcript-list">
        {entries.length === 0 ? (
          <p className="transcript-empty">
            {phase === 'idle' ? 'Press Start Simulation to begin.' : 'Waiting for first turn…'}
          </p>
        ) : (
          entries.map((e) => (
            <div className={`transcript-entry ${e.speaker}`} key={e.turn}>
              <div className="entry-speaker-label">
                {LABEL[e.speaker] ?? e.speaker}
              </div>
              <div className="entry-bubble">
                {e.text || <em style={{ opacity: 0.5 }}>(no transcript)</em>}
              </div>
              <div className="entry-turn">Turn {e.turn}</div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
