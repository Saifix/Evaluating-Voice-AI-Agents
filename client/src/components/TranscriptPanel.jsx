/**
 * TranscriptPanel — chat-bubble style live transcript.
 *
 * Props:
 *   entries  [{ turn, speaker: 'nova'|'sage', text }]
 *   phase    'idle' | 'running' | 'done'
 */
import { useEffect, useRef } from 'react'

const LABEL = { nova: 'Agent', sage: 'Caller', agent: 'Agent', caller: 'Caller' }

export default function TranscriptPanel({ entries, phase, compact = false }) {
  const listRef = useRef(null)

  useEffect(() => {
    // Scroll the list container itself — not scrollIntoView which scrolls the page
    if (listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight
    }
  }, [entries])

  return (
    <div className={`transcript-panel${compact ? ' transcript-panel--compact' : ''}`}>
      <div className="transcript-header">
        <span className="transcript-title">Live Transcript</span>
        <div className="transcript-legend">
          <span className="legend-dot agent">Agent (Nova)</span>
          <span className="legend-dot caller">Caller (Sage)</span>
        </div>
      </div>
      <div className="transcript-list" ref={listRef}>
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
      </div>
    </div>
  )
}
