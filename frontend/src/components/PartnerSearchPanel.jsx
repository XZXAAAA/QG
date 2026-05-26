import React, { useState, useCallback } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

// ── Sector definitions (mirrors backend SECTOR_CONFIGS) ──────────────────────
const SECTORS = {
  consumer_electronics_brand: {
    label: 'Consumer Electronics & Appliance Brand Partnership',
    icon: '📱',
    placeholder:
      'e.g. Looking for a 55"+ smart TV and air-conditioner brand with strong brand recognition, preferably SASO-certified, with no exclusive distributor in Saudi Arabia. Mid-to-premium positioning preferred.',
    dimensions: [
      { key: 'products',         label: 'Products & Categories',        weight: 10 },
      { key: 'market_position',  label: 'Market Position',              weight: 20 },
      { key: 'manufacturing',    label: 'Manufacturing Capability',     weight: 15 },
      { key: 'certifications',   label: 'SASO/SABER Certification',     weight: 25 },
      { key: 'export_experience',label: 'Export Experience',            weight: 15 },
      { key: 'saudi_presence',   label: 'Saudi Market Presence',        weight: 15 },
    ],
  },
  social_commerce_agency: {
    label: 'Social Commerce Agency Partnership',
    icon: '📲',
    placeholder:
      'e.g. Agency must cover TikTok + Snapchat, have local Saudi/Gulf KOL resources, provide Arabic content localisation, ideally experienced with TikTok Shop, performance-based payment preferred.',
    dimensions: [
      { key: 'platform_cert',    label: 'Platform Certification',       weight: 30 },
      { key: 'mena_experience',  label: 'Middle East Experience',       weight: 30 },
      { key: 'service_scope',    label: 'Service Scope',                weight: 20 },
      { key: 'industry_position',label: 'Industry Standing',            weight: 10 },
      { key: 'business_model',   label: 'Business Model & Track Record',weight: 10 },
    ],
  },
};

// ── Helpers ───────────────────────────────────────────────────────────────────

const SCORE_COLOR = (s) => {
  if (s >= 4.5) return '#77d6c3';
  if (s >= 3.5) return '#c28a3d';
  if (s >= 2.5) return '#a8b3c8';
  return '#ff8d7d';
};

const SCORE_BG = (s) => {
  if (s >= 4.5) return 'rgba(119,214,195,0.12)';
  if (s >= 3.5) return 'rgba(194,138,61,0.12)';
  if (s >= 2.5) return 'rgba(168,179,200,0.08)';
  return 'rgba(255,141,125,0.12)';
};

function ScoreDot({ score }) {
  const c = SCORE_COLOR(score);
  return (
    <span style={{
      display: 'inline-block', width: 28, height: 28, borderRadius: '50%',
      background: SCORE_BG(score), border: `2px solid ${c}`,
      color: c, fontSize: '0.72rem', fontWeight: 800,
      textAlign: 'center', lineHeight: '24px',
    }}>
      {score}
    </span>
  );
}

function ScoreBar({ score, max = 5 }) {
  const pct = Math.min(100, (score / max) * 100);
  const c   = SCORE_COLOR(score);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{
        flex: 1, height: 6, borderRadius: 3,
        background: 'rgba(255,255,255,0.06)',
      }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 3,
          background: c, transition: 'width 0.4s',
        }} />
      </div>
      <span style={{ fontSize: '0.72rem', color: c, fontWeight: 700, minWidth: 20 }}>
        {score}
      </span>
    </div>
  );
}

// ── Candidate card ────────────────────────────────────────────────────────────

function CandidateCard({ candidate, dimensions, rank, onDeepEvaluate }) {
  const [open, setOpen] = useState(rank <= 3); // top-3 expanded by default
  const dims = dimensions || [];

  const VERDICT_CFG = {
    'Recommended':          { color: '#77d6c3', bg: 'rgba(119,214,195,0.1)' },
    'Proceed with Caution': { color: '#c28a3d', bg: 'rgba(194,138,61,0.1)' },
    'Not Recommended':      { color: '#ff8d7d', bg: 'rgba(255,141,125,0.1)' },
  };
  const recText = candidate.recommendation || '';
  const verdictKey = Object.keys(VERDICT_CFG).find(k => recText.includes(k)) || 'Proceed with Caution';
  const vc = VERDICT_CFG[verdictKey];

  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: rank === 1
        ? '1px solid rgba(194,138,61,0.4)'
        : '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12,
      overflow: 'hidden',
    }}>
      {/* Header */}
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        style={{
          width: '100%', display: 'flex', alignItems: 'center', gap: 12,
          padding: '14px 16px', background: 'none', border: 'none',
          cursor: 'pointer', textAlign: 'left',
        }}
      >
        {/* Rank badge */}
        <span style={{
          minWidth: 28, height: 28, borderRadius: '50%',
          background: rank === 1 ? 'rgba(194,138,61,0.2)' : 'rgba(255,255,255,0.05)',
          border: `1px solid ${rank === 1 ? '#c28a3d' : 'rgba(255,255,255,0.1)'}`,
          color: rank === 1 ? '#c28a3d' : '#5a6474',
          fontSize: '0.75rem', fontWeight: 800,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          #{rank}
        </span>

        {/* Company name */}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e8dcc8' }}>
            {candidate.company_name_cn}
            {candidate.company_name_en && (
              <span style={{ marginLeft: 8, fontSize: '0.78rem', color: '#5a6474', fontWeight: 400 }}>
                {candidate.company_name_en}
              </span>
            )}
          </div>
          {candidate.brief_intro && (
            <div style={{ fontSize: '0.75rem', color: '#5a6474', marginTop: 2 }}>
              {candidate.brief_intro}
            </div>
          )}
        </div>

        {/* Score */}
        <div style={{ textAlign: 'right', marginRight: 8 }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: SCORE_COLOR(candidate.weighted_score / 20) }}>
            {candidate.weighted_score ?? '—'}
          </div>
          <div style={{ fontSize: '0.65rem', color: '#5a6474' }}>Overall Score</div>
        </div>

        {/* Verdict */}
        <span style={{
          padding: '4px 10px', borderRadius: 999, fontSize: '0.72rem',
          fontWeight: 700, color: vc.color, background: vc.bg,
          border: `1px solid ${vc.color}44`, whiteSpace: 'nowrap',
        }}>
          {verdictKey}
        </span>

        <span style={{ color: '#5a6474', fontSize: '0.8rem', marginLeft: 4 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Deep Evaluate shortcut */}
      {onDeepEvaluate && (
        <div style={{
          padding: '6px 16px 8px',
          borderTop: '1px solid rgba(255,255,255,0.04)',
          display: 'flex', justifyContent: 'flex-end',
        }}>
          <button
            type="button"
            onClick={() => onDeepEvaluate(candidate)}
            style={{
              padding: '5px 14px', borderRadius: 6, fontSize: '0.75rem',
              fontWeight: 700, cursor: 'pointer',
              background: 'rgba(194,138,61,0.1)',
              color: '#c28a3d', border: '1px solid rgba(194,138,61,0.35)',
              transition: 'background 0.15s',
            }}
            onMouseEnter={e => e.currentTarget.style.background = 'rgba(194,138,61,0.2)'}
            onMouseLeave={e => e.currentTarget.style.background = 'rgba(194,138,61,0.1)'}
          >
            🔬 Deep Evaluate →
          </button>
        </div>
      )}

      {/* Body */}
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
          {/* Dimension scores */}
          <div style={{ marginTop: 14, display: 'grid', gap: 10 }}>
            {dims.map(dim => {
              const d = candidate.dimensions?.[dim.key] || {};
              return (
                <div key={dim.key}>
                  <div style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: '0.78rem', marginBottom: 4,
                  }}>
                    <span style={{ color: '#a8b3c8' }}>
                      {dim.label}
                      <span style={{ marginLeft: 6, fontSize: '0.65rem', color: '#3d4a5c' }}>
                        (weight {dim.weight}%)
                      </span>
                    </span>
                    {!d.verified && d.score && (
                      <span style={{ fontSize: '0.62rem', color: '#c28a3d' }}>Unverified</span>
                    )}
                  </div>
                  <ScoreBar score={d.score || 0} />
                  {d.evidence && (
                    <div style={{ fontSize: '0.72rem', color: '#5a6474', marginTop: 3, lineHeight: 1.5 }}>
                      {d.evidence}
                      {d.source && (
                        <span style={{ marginLeft: 6, color: '#3d7a7a', fontStyle: 'italic' }}>
                          [{d.source}]
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Strengths / Risks */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 14 }}>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#77d6c3', marginBottom: 6 }}>
                ✓ Key Strengths
              </div>
              {(candidate.strengths || []).map((s, i) => (
                <div key={i} style={{ fontSize: '0.75rem', color: '#8a96a8', marginBottom: 4, lineHeight: 1.5 }}>
                  • {s}
                </div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#ff8d7d', marginBottom: 6 }}>
                ⚠ Risks / Unverified
              </div>
              {(candidate.risks || []).map((r, i) => (
                <div key={i} style={{ fontSize: '0.75rem', color: '#8a96a8', marginBottom: 4, lineHeight: 1.5 }}>
                  • {r}
                </div>
              ))}
            </div>
          </div>

          {/* Recommendation */}
          {recText && (
            <div style={{
              marginTop: 12, padding: '8px 12px', borderRadius: 8,
              background: vc.bg, border: `1px solid ${vc.color}33`,
              fontSize: '0.78rem', color: '#c8d0dc', lineHeight: 1.6,
            }}>
              <span style={{ fontWeight: 700, color: vc.color }}>Assessment: </span>
              {recText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Comparison matrix ─────────────────────────────────────────────────────────

function ComparisonMatrix({ candidates, dimensions }) {
  if (!candidates?.length || !dimensions?.length) return null;
  return (
    <div style={{ overflowX: 'auto', marginBottom: 24 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr>
            <th style={{
              textAlign: 'left', padding: '8px 12px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              color: '#5a6474', fontWeight: 600, whiteSpace: 'nowrap',
            }}>Company</th>
            {dimensions.map(d => (
              <th key={d.key} style={{
                textAlign: 'center', padding: '8px 10px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                color: '#5a6474', fontWeight: 600, whiteSpace: 'nowrap',
                minWidth: 90,
              }}>{d.label}</th>
            ))}
            <th style={{
              textAlign: 'center', padding: '8px 10px',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              color: '#c28a3d', fontWeight: 700, whiteSpace: 'nowrap',
            }}>Score</th>
          </tr>
        </thead>
        <tbody>
          {candidates.map((c, idx) => (
            <tr key={idx} style={{
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: idx % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
            }}>
              <td style={{ padding: '8px 12px', color: '#e8dcc8', fontWeight: 600 }}>
                <span style={{ color: '#5a6474', marginRight: 6 }}>#{c.rank}</span>
                {c.company_name_cn}
              </td>
              {dimensions.map(d => {
                const score = c.dimensions?.[d.key]?.score || 0;
                return (
                  <td key={d.key} style={{ textAlign: 'center', padding: '8px 10px' }}>
                    <ScoreDot score={score} />
                  </td>
                );
              })}
              <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                <span style={{
                  fontWeight: 800, fontSize: '0.9rem',
                  color: SCORE_COLOR(c.weighted_score / 20),
                }}>
                  {c.weighted_score ?? '—'}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Top-3 recommendation cards ────────────────────────────────────────────────

function Top3Cards({ top3 }) {
  if (!top3?.length) return null;
  const MEDAL = ['🥇', '🥈', '🥉'];
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px,1fr))', gap: 12, marginBottom: 28 }}>
      {top3.map((t, i) => (
        <div key={i} style={{
          padding: '14px 16px', borderRadius: 10,
          background: i === 0 ? 'rgba(194,138,61,0.08)' : 'rgba(255,255,255,0.03)',
          border: i === 0 ? '1px solid rgba(194,138,61,0.3)' : '1px solid rgba(255,255,255,0.07)',
        }}>
          <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>{MEDAL[i]}</div>
          <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#e8dcc8', marginBottom: 6 }}>
            {t.company}
          </div>
          <div style={{ fontSize: '0.75rem', color: '#8a96a8', lineHeight: 1.6 }}>
            {t.rationale}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Progress steps ────────────────────────────────────────────────────────────

const STEPS = [
  { key: 'search',    label: '🔍 Searching for candidate companies' },
  { key: 'research',  label: '📊 Analysing authoritative data per dimension' },
  { key: 'structure', label: '✅ Generating comparison report' },
];

function ProgressSteps({ elapsed }) {
  const stepIndex =
    elapsed < 30 ? 0 :
    elapsed < 80 ? 1 : 2;

  return (
    <div style={{
      padding: '28px 24px', borderRadius: 12,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ fontSize: '0.82rem', color: '#5a6474', marginBottom: 4 }}>
        Retrieving real-time data from authoritative sources… {elapsed}s
      </div>
      {STEPS.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.7rem',
            background: i < stepIndex ? 'rgba(119,214,195,0.15)' :
                         i === stepIndex ? 'rgba(194,138,61,0.15)' :
                         'rgba(255,255,255,0.04)',
            border: `1px solid ${i < stepIndex ? '#77d6c3' :
                                  i === stepIndex ? '#c28a3d' :
                                  'rgba(255,255,255,0.1)'}`,
            color: i < stepIndex ? '#77d6c3' :
                   i === stepIndex ? '#c28a3d' : '#3d4a5c',
          }}>
            {i < stepIndex ? '✓' : i === stepIndex ? '…' : '○'}
          </span>
          <span style={{
            fontSize: '0.83rem',
            color: i < stepIndex ? '#77d6c3' :
                   i === stepIndex ? '#e8dcc8' : '#3d4a5c',
            fontWeight: i === stepIndex ? 600 : 400,
          }}>
            {s.label}
          </span>
          {i === stepIndex && (
            <span style={{
              fontSize: '0.65rem', color: '#c28a3d', marginLeft: 4,
              animation: 'pulse 1.5s ease-in-out infinite',
            }}>● In progress</span>
          )}
        </div>
      ))}
      <div style={{ fontSize: '0.72rem', color: '#3d4a5c', marginTop: 4, lineHeight: 1.6 }}>
        Retrieving real-time data from authoritative sources. Estimated time: 60–120 seconds. Please wait…
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────

export default function PartnerSearchPanel({ onDeepEvaluate }) {
  const [sector,    setSector]    = useState('consumer_electronics_brand');
  const [brief,     setBrief]     = useState('');
  const [loading,   setLoading]   = useState(false);
  const [elapsed,   setElapsed]   = useState(0);
  const [result,    setResult]    = useState(null);
  const [error,     setError]     = useState('');
  const [activeTab, setActiveTab] = useState('cards'); // 'cards' | 'matrix' | 'sources'

  const sectorCfg = SECTORS[sector];

  const handleSearch = useCallback(async () => {
    setLoading(true);
    setError('');
    setResult(null);
    setElapsed(0);

    const timer = setInterval(() => setElapsed(e => e + 1), 1000);

    try {
      const res = await fetch(`${API_BASE}/partner/search`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sector, brief }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setResult(json.data);
      setActiveTab('cards');
    } catch (err) {
      setError(err.message || 'Search failed');
    } finally {
      clearInterval(timer);
      setLoading(false);
    }
  }, [sector, brief]);

  const candidates  = result?.candidates  || [];
  const top3        = result?.top3        || [];
  const sources     = result?.authoritative_sources || [];
  const dims        = sectorCfg.dimensions;

  return (
    <section className="panel">
      {/* Hero */}
      <div className="panel-hero">
        <div>
          <div className="panel-kicker">Partner Discovery</div>
          <h1>Partner Search</h1>
          <p>
            Based on your requirements brief, discovers and evaluates Chinese candidate companies using live web search of authoritative sources, generating a multi-dimensional comparison report with full source citations.
          </p>
        </div>
        <div className="header-status" style={{ alignSelf: 'flex-start' }}>
          <span className={`status-dot ${loading ? 'busy' : 'idle'}`} />
          {loading ? 'Searching…' : 'Ready'}
        </div>
      </div>

      {/* ── Input form ── */}
      {!loading && !result && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Sector selector */}
          <div>
            <div style={{ fontSize: '0.78rem', color: '#5a6474', fontWeight: 600, marginBottom: 10 }}>
              Select Sector
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {Object.entries(SECTORS).map(([key, cfg]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSector(key)}
                  style={{
                    padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                    textAlign: 'left', border: 'none',
                    background: sector === key
                      ? 'rgba(194,138,61,0.12)'
                      : 'rgba(255,255,255,0.03)',
                    outline: sector === key
                      ? '2px solid rgba(194,138,61,0.5)'
                      : '1px solid rgba(255,255,255,0.08)',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>{cfg.icon}</div>
                  <div style={{
                    fontWeight: 700, fontSize: '0.85rem',
                    color: sector === key ? '#c28a3d' : '#a8b3c8',
                  }}>
                    {cfg.label}
                  </div>
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {cfg.dimensions.map(d => (
                      <span key={d.key} style={{
                        fontSize: '0.65rem', color: '#3d4a5c', padding: '2px 6px',
                        borderRadius: 4, background: 'rgba(255,255,255,0.04)',
                        border: '1px solid rgba(255,255,255,0.06)',
                      }}>
                        {d.label}
                      </span>
                    ))}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Brief input */}
          <div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: '0.78rem', color: '#5a6474', fontWeight: 600, marginBottom: 8,
            }}>
              <span>Additional Requirements (optional)</span>
              <span style={{ color: '#3d4a5c', fontWeight: 400 }}>
                More detail = more targeted results
              </span>
            </div>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              placeholder={sectorCfg.placeholder}
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '12px 14px', borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#e8dcc8', fontSize: '0.85rem', lineHeight: 1.6,
                resize: 'vertical', outline: 'none',
                fontFamily: 'inherit',
              }}
            />
          </div>

          {/* Data source note */}
          <div style={{
            padding: '10px 14px', borderRadius: 8, fontSize: '0.78rem',
            color: '#58a6a6', background: 'rgba(88,166,166,0.06)',
            border: '1px solid rgba(88,166,166,0.2)', lineHeight: 1.7,
          }}>
            <strong>Data source note:</strong> All company information is retrieved via live web search from authoritative sources including official websites, annual reports,{' '}
            {sector === 'consumer_electronics_brand'
              ? 'SASO/SABER certification databases, IDC/GfK industry reports, China Appliance Association, and customs data for Sector 1'
              : 'TikTok for Business official partner pages, Meta certification directory, LinkedIn, and industry award databases for Sector 2'}. Every key data point is source-cited. Unverifiable information is flagged as &quot;Unverified&quot;.
          </div>

          {/* Submit */}
          <button
            type="button"
            onClick={handleSearch}
            style={{
              padding: '13px 24px', borderRadius: 8, fontSize: '0.9rem',
              fontWeight: 700, cursor: 'pointer',
              background: 'rgba(194,138,61,0.15)',
              color: '#c28a3d', border: '1px solid rgba(194,138,61,0.4)',
              transition: 'background 0.15s',
            }}
          >
            🔍 Search (live web, ~60–120 sec)
          </button>
        </div>
      )}

      {/* ── Progress ── */}
      {loading && <ProgressSteps elapsed={elapsed} />}

      {/* ── Error ── */}
      {!loading && error && (
        <div style={{
          padding: '12px 16px', borderRadius: 8, fontSize: '0.84rem',
          color: '#ff8d7d', background: 'rgba(255,141,125,0.08)',
          border: '1px solid rgba(255,141,125,0.25)', marginBottom: 16,
        }}>
          ⚠ {error}
          <button
            type="button"
            onClick={() => { setError(''); setResult(null); }}
            style={{
              marginLeft: 12, background: 'none', border: 'none',
              color: '#ff8d7d', cursor: 'pointer', textDecoration: 'underline',
              fontSize: '0.8rem',
            }}
          >
            Back
          </button>
        </div>
      )}

      {/* ── Results ── */}
      {!loading && result && (
        <div>
          {/* Header bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            flexWrap: 'wrap', gap: 12, marginBottom: 20,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e8dcc8' }}>
                {result.sector}
              </span>
              <span style={{
                fontSize: '0.75rem', color: '#58a6a6', padding: '3px 10px',
                borderRadius: 999, background: 'rgba(88,166,166,0.1)',
                border: '1px solid rgba(88,166,166,0.25)',
              }}>
                {candidates.length} candidates found
              </span>
              <span style={{ fontSize: '0.72rem', color: '#3d4a5c' }}>
                📅 {result.search_date}
              </span>
            </div>
            <button
              type="button"
              onClick={() => { setResult(null); setBrief(''); }}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: '0.78rem',
                fontWeight: 600, cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)',
                color: '#a8b3c8', border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              ← New Search
            </button>
          </div>

          {/* Top-3 */}
          {top3.length > 0 && (
            <>
              <div style={{
                fontSize: '0.82rem', fontWeight: 700, color: '#c28a3d',
                marginBottom: 10,
              }}>
                🏆 Top 3 Recommendations
              </div>
              <Top3Cards top3={top3} />
            </>
          )}

          {/* Tab bar */}
          <div style={{
            display: 'flex', gap: 4, marginBottom: 16,
            borderBottom: '1px solid rgba(255,255,255,0.07)',
          }}>
            {[
              { key: 'cards',  label: `📋 Candidate Details (${candidates.length})` },
              { key: 'matrix', label: '📊 Comparison Matrix' },
              { key: 'sources',label: `📚 Sources (${sources.length})` },
            ].map(t => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                style={{
                  padding: '8px 16px', fontSize: '0.82rem',
                  fontWeight: activeTab === t.key ? 700 : 400,
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: activeTab === t.key ? '#c28a3d' : '#5a6474',
                  borderBottom: activeTab === t.key
                    ? '2px solid #c28a3d' : '2px solid transparent',
                  marginBottom: -1, transition: 'color 0.15s',
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab: candidate cards */}
          {activeTab === 'cards' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {candidates.map((c, i) => (
                <CandidateCard
                  key={i}
                  candidate={c}
                  dimensions={dims}
                  rank={c.rank || i + 1}
                  onDeepEvaluate={onDeepEvaluate || null}
                />
              ))}
            </div>
          )}

          {/* Tab: comparison matrix */}
          {activeTab === 'matrix' && (
            <ComparisonMatrix candidates={candidates} dimensions={dims} />
          )}

          {/* Tab: sources */}
          {activeTab === 'sources' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {sources.length === 0 && (
                <div style={{ color: '#5a6474', fontSize: '0.85rem' }}>
                  No sources available
                </div>
              )}
              {sources.map((s, i) => {
                const reliabilityColor = s.reliability === 'HIGH' ? '#77d6c3'
                  : s.reliability === 'MEDIUM' ? '#c28a3d' : '#5a6474';
                return (
                  <div key={i} style={{
                    padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.02)',
                    border: '1px solid rgba(255,255,255,0.07)',
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                  }}>
                    <span style={{
                      fontSize: '0.65rem', fontWeight: 700,
                      color: reliabilityColor,
                      padding: '2px 6px', borderRadius: 4,
                      background: `${reliabilityColor}18`,
                      border: `1px solid ${reliabilityColor}44`,
                      whiteSpace: 'nowrap', marginTop: 2,
                    }}>
                      {s.reliability}
                    </span>
                    <div>
                      <div style={{ fontSize: '0.82rem', color: '#e8dcc8', fontWeight: 600 }}>
                        {s.url ? (
                          <a href={s.url} target="_blank" rel="noopener noreferrer"
                            style={{ color: 'inherit', textDecoration: 'none' }}
                            onMouseEnter={e => e.target.style.color = '#c28a3d'}
                            onMouseLeave={e => e.target.style.color = 'inherit'}
                          >
                            {s.name} ↗
                          </a>
                        ) : s.name}
                      </div>
                      {s.type && (
                        <div style={{ fontSize: '0.7rem', color: '#5a6474', marginTop: 2 }}>
                          {s.type}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Analyst notes */}
              {result.analyst_notes && (
                <div style={{
                  marginTop: 8, padding: '12px 14px', borderRadius: 8,
                  background: 'rgba(194,138,61,0.06)',
                  border: '1px solid rgba(194,138,61,0.2)',
                  fontSize: '0.78rem', color: '#a8b3c8', lineHeight: 1.7,
                }}>
                  <div style={{ fontWeight: 700, color: '#c28a3d', marginBottom: 4 }}>
                    📝 Analyst Notes
                  </div>
                  {result.analyst_notes}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
