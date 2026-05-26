import React, { useCallback, useEffect, useState } from 'react';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

// ── Sentiment config ────────────────────────────────────────────────────────
const SENTIMENT_CFG = {
  Bullish:  { label: 'Bullish', color: '#77d6c3', bg: 'rgba(119,214,195,0.12)' },
  Bearish:  { label: 'Bearish', color: '#ff8d7d', bg: 'rgba(255,141,125,0.12)' },
  Neutral:  { label: 'Neutral', color: '#a8b3c8', bg: 'rgba(168,179,200,0.12)' },
  利好:     { label: 'Bullish', color: '#77d6c3', bg: 'rgba(119,214,195,0.12)' },
  利空:     { label: 'Bearish', color: '#ff8d7d', bg: 'rgba(255,141,125,0.12)' },
  中性:     { label: 'Neutral', color: '#a8b3c8', bg: 'rgba(168,179,200,0.12)' },
};

const SECTOR_ICON = {
  'Consumer Electronics': '📱',
  'Robotics':             '🤖',
  'Biotech & Health':     '🧬',
  'New Energy':           '⚡',
  'Other':                '📰',
};

// ── Sub-components ───────────────────────────────────────────────────────────

function SentimentBadge({ sentiment }) {
  const cfg = SENTIMENT_CFG[sentiment] || SENTIMENT_CFG.Neutral;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '999px',
      fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.04em',
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}44`,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

function SectorBadge({ category }) {
  const icon = SECTOR_ICON[category] || '📰';
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: '4px',
      padding: '3px 10px', borderRadius: '6px', fontSize: '0.72rem',
      fontWeight: 600, color: '#c28a3d', background: 'rgba(194,138,61,0.1)',
      border: '1px solid rgba(194,138,61,0.25)',
    }}>
      {icon} {category}
    </span>
  );
}

function NewsCard({ article }) {
  const [expanded, setExpanded] = useState(false);
  const content = article.content || article['内容'] || '';
  const title   = article.title   || article['标题'] || '(no title)';
  const preview = content.length > 160 ? content.slice(0, 160) + '…' : content;

  return (
    <article style={{
      background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
      borderRadius: '10px', padding: '14px 16px', display: 'flex', flexDirection: 'column',
      gap: '8px',
    }}>
      {/* Title row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px' }}>
        <div style={{ fontWeight: 600, fontSize: '0.9rem', color: '#e8dcc8', lineHeight: 1.4, flex: 1 }}>
          {article.link ? (
            <a href={article.link} target="_blank" rel="noopener noreferrer"
              style={{ color: 'inherit', textDecoration: 'none' }}
              onMouseEnter={e => e.target.style.color = '#c28a3d'}
              onMouseLeave={e => e.target.style.color = 'inherit'}
            >
              {title}
            </a>
          ) : title}
        </div>
        <SentimentBadge sentiment={article.sentiment || article['市场情绪']} />
      </div>

      {/* Content */}
      <div style={{ fontSize: '0.82rem', color: '#8a96a8', lineHeight: 1.6 }}>
        {expanded ? content : preview}
        {content.length > 160 && (
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            style={{
              marginLeft: '6px', background: 'none', border: 'none', padding: 0,
              color: '#58a6a6', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
            }}
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', gap: '10px', alignItems: 'center', flexWrap: 'wrap', marginTop: '2px' }}>
        {(article.media || article.source) && (
          <span style={{ fontSize: '0.7rem', color: '#58a6a6', fontWeight: 500 }}>
            {article.media || article.source}
          </span>
        )}
        {article.date_iso && (
          <span style={{ fontSize: '0.7rem', color: '#5a6474' }}>{article.date_iso}</span>
        )}
        {article.category && <SectorBadge category={article.category} />}
        {article.source_note && article.source_note !== (article.media || article.source) && (
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: '3px',
            fontSize: '0.68rem', color: '#7a8699',
            padding: '2px 8px', borderRadius: '5px',
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)',
          }}>
            📌 {article.source_note}
          </span>
        )}
      </div>
    </article>
  );
}

function SectionView({ sections }) {
  if (!sections?.length) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', color: '#5a6474', fontSize: '0.9rem' }}>
        No sector data yet. Click &quot;Refresh Feed&quot; to fetch today&apos;s news.
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '28px' }}>
      {sections.map(section => (
        <div key={section.category}>
          {/* Section header */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: '10px',
            marginBottom: '12px', paddingBottom: '8px',
            borderBottom: '1px solid rgba(255,255,255,0.06)',
          }}>
            <span style={{ fontSize: '1.1rem' }}>
              {SECTOR_ICON[section.category] || '📰'}
            </span>
            <span style={{ fontWeight: 700, fontSize: '0.95rem', color: '#c28a3d' }}>
              {section.category}
            </span>
            <span style={{
              fontSize: '0.72rem', color: '#5a6474', fontWeight: 500,
              padding: '2px 8px', borderRadius: '999px',
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
            }}>
              {section.count || section.entries?.length || 0}
            </span>
          </div>

          {/* Articles grid */}
          <div style={{ display: 'grid', gap: '10px' }}>
            {(section.entries || []).map((entry, i) => (
              <NewsCard
                key={entry.title ? `${entry.title}-${i}` : i}
                article={entry}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ReportView({ reportText }) {
  if (!reportText) {
    return (
      <div style={{ textAlign: 'center', padding: '48px 0', color: '#5a6474', fontSize: '0.9rem' }}>
        No report available yet. Click &quot;Refresh Feed&quot; to generate today&apos;s report.
      </div>
    );
  }

  return (
    <pre style={{
      fontFamily: '"Noto Sans SC", "Segoe UI", sans-serif',
      fontSize: '0.88rem', lineHeight: 1.9, color: '#c8d0dc',
      whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
      borderRadius: '10px', padding: '20px 22px', margin: 0,
    }}>
      {reportText}
    </pre>
  );
}

// ── Main panel ───────────────────────────────────────────────────────────────

export default function NewsPanel() {
  const [tab, setTab]             = useState('sections'); // 'sections' | 'report'
  const [data, setData]           = useState(null);       // { date, article_count, articles, daily_report, sections }
  const [loading, setLoading]     = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError]         = useState('');

  const fetchToday = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/investment/news/today`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setData(json);
    } catch (err) {
      setError(err.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    setError('');
    try {
      const res = await fetch(`${API_BASE_URL}/investment/news/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ force: true }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      // After refresh, reload today's data
      await fetchToday();
    } catch (err) {
      setError(err.message || 'Refresh failed');
    } finally {
      setRefreshing(false);
    }
  }, [fetchToday]);

  useEffect(() => { fetchToday(); }, [fetchToday]);

  const sections     = data?.sections ?? [];
  const articleCount = sections.reduce((sum, s) => sum + (s.entries?.length || 0), 0);
  const reportText   = data?.daily_report ?? '';
  const reportDate   = data?.date ?? '';
  const busy         = loading || refreshing;

  return (
    <section className="panel">
      {/* ── Hero ── */}
      <div className="panel-hero">
        <div>
          <div className="panel-kicker">Intelligence Feed</div>
          <h1>Daily Tech News</h1>
          <p>
            Automatically fetched from 9 Chinese tech media sources including TiMedia, 36Kr, ITHome, iFanr. AI-filtered, structured, and categorised by sector.
          </p>
        </div>
        <div className="header-status" style={{ alignSelf: 'flex-start' }}>
          <span className={`status-dot ${busy ? 'busy' : 'idle'}`} />
          {refreshing ? 'Fetching…' : loading ? 'Loading…' : 'Ready'}
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: '12px', marginBottom: '20px',
      }}>
        {/* Date + count */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          {reportDate && (
            <span style={{ fontSize: '0.82rem', color: '#5a6474' }}>
              📅 {reportDate}
            </span>
          )}
          {articleCount > 0 && (
            <span style={{
              fontSize: '0.78rem', fontWeight: 600, color: '#58a6a6',
              padding: '3px 10px', borderRadius: '999px',
              background: 'rgba(88,166,166,0.1)', border: '1px solid rgba(88,166,166,0.25)',
            }}>
              {articleCount} articles
            </span>
          )}
          {sections.length > 0 && (
            <span style={{
              fontSize: '0.78rem', color: '#5a6474',
            }}>
              {sections.length} sectors
            </span>
          )}
        </div>

        {/* Buttons */}
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            onClick={fetchToday}
            disabled={busy}
            style={{
              padding: '7px 16px', borderRadius: '7px', fontSize: '0.8rem',
              fontWeight: 600, cursor: busy ? 'not-allowed' : 'pointer',
              background: 'rgba(255,255,255,0.04)', color: '#a8b3c8',
              border: '1px solid rgba(255,255,255,0.1)',
              opacity: busy ? 0.5 : 1,
            }}
          >
            ↺ Load Cache
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            disabled={busy}
            style={{
              padding: '7px 18px', borderRadius: '7px', fontSize: '0.8rem',
              fontWeight: 700, cursor: busy ? 'not-allowed' : 'pointer',
              background: busy ? 'rgba(194,138,61,0.3)' : 'rgba(194,138,61,0.15)',
              color: '#c28a3d', border: '1px solid rgba(194,138,61,0.4)',
              opacity: busy ? 0.7 : 1,
              transition: 'background 0.15s',
            }}
          >
            {refreshing ? 'Fetching…' : '⚡ Refresh Feed'}
          </button>
        </div>
      </div>

      {/* ── Error banner ── */}
      {error && (
        <div style={{
          padding: '10px 14px', borderRadius: '8px', fontSize: '0.83rem',
          color: '#ff8d7d', background: 'rgba(255,141,125,0.08)',
          border: '1px solid rgba(255,141,125,0.25)', marginBottom: '16px',
        }}>
          ⚠ {error}
        </div>
      )}

      {/* ── Tab bar ── */}
      <div style={{
        display: 'flex', gap: '4px', marginBottom: '20px',
        borderBottom: '1px solid rgba(255,255,255,0.07)', paddingBottom: '0',
      }}>
        {[
          { key: 'sections', label: '📊 By Sector' },
          { key: 'report',   label: '📄 Full Report' },
        ].map(t => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            style={{
              padding: '8px 18px', fontSize: '0.83rem', fontWeight: tab === t.key ? 700 : 500,
              background: 'none', border: 'none', cursor: 'pointer',
              color: tab === t.key ? '#c28a3d' : '#5a6474',
              borderBottom: tab === t.key ? '2px solid #c28a3d' : '2px solid transparent',
              marginBottom: '-1px', transition: 'color 0.15s',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Loading skeleton ── */}
      {loading && !data && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {[1, 2, 3].map(i => (
            <div key={i} style={{
              height: '80px', borderRadius: '10px',
              background: 'rgba(255,255,255,0.03)',
              animation: 'pulse 1.5s ease-in-out infinite',
            }} />
          ))}
        </div>
      )}

      {/* ── Content ── */}
      {!loading && (
        tab === 'sections'
          ? <SectionView sections={sections} />
          : <ReportView reportText={reportText} />
      )}
    </section>
  );
}
