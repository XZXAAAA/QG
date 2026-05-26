import React, { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

const INVESTMENT_PANEL_CACHE_KEY = 'qg-investment-panel-cache-v1';

// ---------------------------------------------------------------------------
// Normalise company name: always "English Name ChineseName"
// Handles cases where LLM returns "海尔集团公司Haier Group" (Chinese first)
// ---------------------------------------------------------------------------
function normaliseCompanyName(raw) {
  if (!raw) return raw;
  // Detect leading CJK block (U+4E00–U+9FFF, U+3400–U+4DBF, full-width)
  const cjkLeading = /^[\u3400-\u9fff\uf900-\ufaff\u{20000}-\u{2a6df}]/u;
  if (!cjkLeading.test(raw)) return raw;          // already English-first, keep as-is
  // Split at the boundary where CJK ends and ASCII/Latin begins
  const splitAt = raw.search(/[A-Za-z]/);
  if (splitAt <= 0) return raw;                   // no Latin part found, can't reorder
  const chinesePart = raw.slice(0, splitAt).trim();
  const englishPart = raw.slice(splitAt).trim();
  return `${englishPart} ${chinesePart}`;
}

// ---------------------------------------------------------------------------
// Verdict config (partnership framing)
// ---------------------------------------------------------------------------
const VERDICT_CONFIG = {
  HIGHLY_RECOMMENDED: { label: 'Highly Recommended', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  RECOMMENDED:        { label: 'Recommended',         color: '#77d6c3', bg: 'rgba(119,214,195,0.12)' },
  NEUTRAL:            { label: 'Neutral',              color: '#a8b3c8', bg: 'rgba(168,179,200,0.12)' },
  CAUTIOUS:           { label: 'Cautious',             color: '#f0bf68', bg: 'rgba(240,191,104,0.12)' },
  NOT_RECOMMENDED:    { label: 'Not Recommended',      color: '#ff8d7d', bg: 'rgba(255,141,125,0.12)' },
};

const RISK_COLOR = {
  LOW:      '#77d6c3',
  MEDIUM:   '#f0bf68',
  HIGH:     '#ff8d7d',
  CRITICAL: '#ff6b6b',
};

const RELIABILITY_COLOR = {
  HIGH:   '#77d6c3',
  MEDIUM: '#f0bf68',
  LOW:    '#ff8d7d',
};

const RELIABILITY_LABEL = {
  HIGH:   'Verified',
  MEDIUM: 'Partially Verified',
  LOW:    'Unverified',
};

function VerdictBadge({ verdict }) {
  const cfg = VERDICT_CONFIG[verdict] || VERDICT_CONFIG.NEUTRAL;
  return (
    <span style={{
      display: 'inline-block', padding: '4px 14px', borderRadius: '999px',
      fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em',
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}44`,
    }}>
      {cfg.label}
    </span>
  );
}

function RiskBadge({ level }) {
  const color = RISK_COLOR[level] || '#a8b3c8';
  return (
    <span style={{
      display: 'inline-block', padding: '2px 10px', borderRadius: '999px',
      fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
      textTransform: 'uppercase', color, background: `${color}18`,
      border: `1px solid ${color}44`, whiteSpace: 'nowrap',
    }}>
      {level || '—'}
    </span>
  );
}

function ReliabilityBadge({ level }) {
  const color = RELIABILITY_COLOR[level] || '#a8b3c8';
  const label = RELIABILITY_LABEL[level] || level;
  return (
    <span style={{
      display: 'inline-block', padding: '2px 8px', borderRadius: '999px',
      fontSize: '0.68rem', fontWeight: 700, color,
      background: `${color}18`, border: `1px solid ${color}44`, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

function ScoreGauge({ score }) {
  const pct = Math.max(0, Math.min(100, score || 0));
  const color =
    pct >= 75 ? '#4ade80' :
    pct >= 55 ? '#77d6c3' :
    pct >= 40 ? '#f0bf68' :
    pct >= 25 ? '#ff8d7d' : '#ff6b6b';
  return (
    <div className="inv-score-wrap">
      <div className="inv-score-number" style={{ color }}>{pct}</div>
      <div className="inv-score-label">Partner Score / 100</div>
      <div className="inv-score-bar-track">
        <div className="inv-score-bar-fill" style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Markdown export
// ---------------------------------------------------------------------------
function buildMarkdown(report) {
  const {
    companyName = '', partnerScore = 0, partnerVerdict = '',
    summary = '', companyProfile = {}, developmentHistory = [],
    coreTeam = [], businessAnalysis = {}, marketAnalysis = {},
    partnershipHistory = [], recentNews = [], riskFactors = [],
    partnershipRecommendation = {}, sources = [],
  } = report;
  const now = new Date().toLocaleString();
  const lines = [
    `# Partner Evaluation Report`,
    ``,
    `**Company:** ${companyName}  `,
    `**Partner Score:** ${partnerScore}/100  `,
    `**Overall Verdict:** ${partnerVerdict}  `,
    `**Generated:** ${now}`,
    ``,
    `> ⚠️ This report is AI-generated for reference only. Please verify from authoritative sources before making important decisions.`,
    ``,
    `---`,
    `## Executive Summary`,
    ``,
    summary,
    ``,
    `---`,
    `## Company Profile`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    ...Object.entries(companyProfile).filter(([, v]) => v).map(([k, v]) => `| ${camelToLabel(k)} | ${v} |`),
    ``,
    `---`,
    `## Development History`,
    ``,
    ...developmentHistory.map((m) => `**${m.date}** — ${m.milestone}\n${m.detail}${m.source ? `\n*Source: ${m.source}*` : ''}`),
    ``,
    `---`,
    `## Core Team`,
    ``,
    ...coreTeam.map((m) => `**${m.name}** — ${m.title}\n${m.background}`),
    ``,
    `---`,
    `## Business Analysis`,
    ``,
    `**Products / Services:** ${businessAnalysis.productDescription || '—'}`,
    ``,
    `**Revenue Model:** ${businessAnalysis.revenueModel || '—'}`,
    ``,
    `**Synergies:**`,
    ...(businessAnalysis.partnershipSynergies || []).map((s) => `- ${s}`),
    ``,
    `**Partnership Risks:**`,
    ...(businessAnalysis.partnershipRisks || []).map((r) => `- ${r}`),
    ``,
    `---`,
    `## Market Analysis`,
    ``,
    `**Target Market:** ${marketAnalysis.targetMarket || '—'}`,
    `**Market Size:** ${marketAnalysis.marketSize || '—'}`,
    `**Market Position:** ${marketAnalysis.marketPosition || '—'}`,
    `**Key Competitors:** ${(marketAnalysis.competitors || []).join(', ')}`,
    ``,
    `---`,
    `## Partnership History`,
    ``,
    ...partnershipHistory.map((p) => `**${p.partner}** (${p.type}, ${p.date}): ${p.outcome}${p.source ? ` — Source: ${p.source}` : ''}`),
    ``,
    `---`,
    `## Recent News`,
    ``,
    ...recentNews.map((n) => `**[${n.sentiment}] ${n.title}**\n*${n.date} · ${n.source}${n.sourceUrl ? ` · ${n.sourceUrl}` : ''}*\n${n.summary}`),
    ``,
    `---`,
    `## Risk Factors`,
    ``,
    ...riskFactors.map((r) => `**[${r.level}] ${r.category}:** ${r.description}`),
    ``,
    `---`,
    `## Partnership Recommendation`,
    ``,
    `**Overall Verdict:** ${partnershipRecommendation.verdict || '—'}`,
    ``,
    partnershipRecommendation.rationale || '',
    ``,
    `**Ideal Partnership Type:** ${partnershipRecommendation.idealPartnershipType || '—'}`,
    ``,
    `**Collaboration Opportunities:**`,
    ...(partnershipRecommendation.collaborationOpportunities || []).map((o) => `- ${o}`),
    ``,
    `**Due Diligence Questions:**`,
    ...(partnershipRecommendation.dueDiligenceQuestions || []).map((q) => `- ${q}`),
    ``,
    `**Next Steps:**`,
    ...(partnershipRecommendation.nextSteps || []).map((s) => `- ${s}`),
    ``,
    `---`,
    `## Sources`,
    ``,
    `| Source | Type | Reliability | Note |`,
    `|--------|------|-------------|------|`,
    ...sources.map((s) => `| [${s.name}](${s.url || '#'}) | ${s.type} | ${s.reliability} | ${s.note || ''} |`),
    ``,
    `---`,
    `*This report is AI-generated for reference only and does not constitute formal business advice. Please conduct independent due diligence before making partnership decisions.*`,
  ];
  return lines.join('\n');
}

function downloadText(content, filename) {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Shared card wrapper
// ---------------------------------------------------------------------------
function Card({ title, chip, children }) {
  return (
    <div className="answer-card" style={{ marginBottom: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <span className="section-heading">{title}</span>
        {chip && <span className="section-chip">{chip}</span>}
      </div>
      {children}
    </div>
  );
}

function extractQccRows(qccResult) {
  const data = qccResult?.data;
  if (!data || typeof data !== 'object') return [];
  const preferred = [
    ['Name', 'Company Name'],
    ['CreditCode', 'Unified Social Credit Code'],
    ['No', 'Registration No.'],
    ['OperName', 'Legal Representative'],
    ['Status', 'Operating Status'],
    ['StartDate', 'Establishment Date'],
    ['RegistCapi', 'Registered Capital'],
    ['EconKind', 'Company Type'],
    ['Address', 'Registered Address'],
    ['Scope', 'Business Scope'],
  ];
  const rows = preferred
    .filter(([key]) => data[key] !== undefined && data[key] !== null && String(data[key]).trim() !== '')
    .map(([key, label]) => [label, String(data[key])]);
  if (rows.length) return rows;
  return Object.entries(data)
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object' && String(value).trim() !== '')
    .slice(0, 12)
    .map(([key, value]) => [key, String(value)]);
}

function camelToLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase()).trim();
}

// ---------------------------------------------------------------------------
// Analysis progress steps
// ---------------------------------------------------------------------------
const INV_STEPS = [
  { key: 'extract',  label: '🔍 Extracting company identity' },
  { key: 'fetch',    label: '📋 Fetching registry & web intelligence' },
  { key: 'analyse',  label: '📊 Analysing market position & risks' },
  { key: 'generate', label: '✅ Generating source-cited evaluation report' },
];

function InvProgressSteps({ elapsed }) {
  const stepIndex =
    elapsed < 15 ? 0 :
    elapsed < 45 ? 1 :
    elapsed < 90 ? 2 : 3;

  return (
    <div style={{
      padding: '28px 24px', borderRadius: 12,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ fontSize: '0.82rem', color: '#5a6474', marginBottom: 4 }}>
        Gathering intelligence from registry & authoritative sources… {elapsed}s
      </div>
      {INV_STEPS.map((s, i) => (
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
        Deep-research may take 1–3 minutes. Retrieving registry data, web citations and market analysis — please wait…
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function InvestmentPanel({ presetContext, onClearPreset }) {
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [report, setReport] = useState(null);
  const isMountedRef = useRef(true);
  const elapsedTimerRef = useRef(null);

  useEffect(() => {
    isMountedRef.current = true;
    try {
      const raw = window.localStorage.getItem(INVESTMENT_PANEL_CACHE_KEY);
      if (!raw) return;
      const cached = JSON.parse(raw);
      setQuery(cached.query || '');
      setLoading(Boolean(cached.loading));
      setError(cached.error || null);
      setReport(cached.report || null);
    } catch {
      // Ignore corrupted cache
    }
    return () => {
      isMountedRef.current = false;
      if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    };
  }, []);

  // Pre-fill query from Partner Search preset
  useEffect(() => {
    if (!presetContext) return;
    const name = [presetContext.company_name_en, presetContext.company_name_cn]
      .filter(Boolean).join(' ').trim();
    if (name) {
      setQuery(name);
      setReport(null);
      setError(null);
    }
  }, [presetContext]);

  useEffect(() => {
    try {
      window.localStorage.setItem(INVESTMENT_PANEL_CACHE_KEY, JSON.stringify({ query, loading, error, report }));
    } catch {
      // Ignore storage failures
    }
  }, [query, loading, error, report]);

  const handleQichachaLookup = useCallback(async () => {
    const keyword = (qccKeyword || query).trim();
    if (!keyword) return;
    setQccLoading(true);
    setQccError(null);
    setQccResult(null);
    try {
      const res = await fetch(`${API_BASE_URL}/qichacha/company`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keyword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setQccResult(data);
      if (!data.ok) {
        setQccError(data.message || data.hint || `Qichacha Status ${data.status || 'unknown'}`);
      }
    } catch (err) {
      setQccError(err.message || 'Qichacha lookup failed');
    } finally {
      setQccLoading(false);
    }
  }, [qccKeyword, query]);

  const handleEvaluate = useCallback(async () => {
    const q = query.trim();
    if (!q) return;
    setLoading(true); setError(null); setReport(null); setElapsed(0);

    // Start elapsed timer
    if (elapsedTimerRef.current) clearInterval(elapsedTimerRef.current);
    elapsedTimerRef.current = setInterval(() => setElapsed(e => e + 1), 1000);

    const controller = new AbortController();
    const tid = setTimeout(() => controller.abort(), 360_000); // 6 minutes

    try {
      const body = { query: q };
      const res = await fetch(`${API_BASE_URL}/investment/evaluate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      if (isMountedRef.current) {
        setReport(data);
      }
    } catch (err) {
      if (isMountedRef.current) {
        if (err.name === 'AbortError') {
          setError('Analysis timed out (exceeded 6 minutes), please try again.');
        } else {
          setError(err.message || 'Analysis failed, please try again later.');
        }
      }
    } finally {
      clearTimeout(tid);
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [query]);

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleEvaluate(); }
  }

  function handleExport() {
    if (!report) return;
    const md = buildMarkdown(report);
    const safe = (report.companyName || 'company').replace(/[^\w\u4e00-\u9fa5]/g, '_');
    downloadText(md, `partner_eval_${safe}_${Date.now()}.md`);
  }

  const {
    companyName: _rawCompanyName = '', partnerScore = 50, partnerVerdict = 'NEUTRAL',
    summary = '', companyProfile = {}, developmentHistory = [],
    coreTeam = [], businessAnalysis = {}, marketAnalysis = {},
    partnershipHistory = [], recentNews = [], riskFactors = [],
    partnershipRecommendation = {}, sources = [], _meta,
  } = report || {};
  const companyName = normaliseCompanyName(_rawCompanyName);

  // When a Partner Search preset is active, always show the Partner Search score
  // to maintain consistency with what the user saw in the search results.
  const displayScore = (presetContext?.weighted_score != null)
    ? presetContext.weighted_score
    : partnerScore;
  const scoreFromPreset = presetContext?.weighted_score != null;

  return (
    <div className="panel inv-panel">
      {/* Hero */}
      <div className="panel-hero">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
          <div>
            <div className="panel-hero-title">Partner Evaluation</div>
            <div className="panel-hero-sub">
              Enter a company name and AI will gather registry data, web intelligence and market insights to generate a source-cited evaluation report
            </div>
          </div>
          {report && (
            <button type="button" className="primary-button" onClick={handleExport}
              style={{ fontSize: '0.8rem', padding: '7px 16px' }}>
              Export Report
            </button>
          )}
        </div>
      </div>

      {/* Preset banner — shown when pre-filled from Partner Search */}
      {presetContext && (
        <div style={{
          padding: '9px 14px', borderRadius: 8, fontSize: '0.8rem',
          background: 'rgba(194,138,61,0.08)', border: '1px solid rgba(194,138,61,0.25)',
          color: '#c28a3d', display: 'flex', alignItems: 'center',
          justifyContent: 'space-between', gap: 12, marginBottom: 4,
        }}>
          <span>
            🔗 Pre-filled from <strong>Partner Search</strong>
            {' · '}<strong>{presetContext.company_name_en || presetContext.company_name_cn}</strong>
            {presetContext.weighted_score != null && (
              <> · Partner Search Score: <strong>{presetContext.weighted_score}</strong>/100</>
            )}
          </span>
          {onClearPreset && (
            <button
              type="button"
              onClick={onClearPreset}
              style={{
                background: 'none', border: 'none', color: '#c28a3d',
                cursor: 'pointer', fontSize: '1.1rem', lineHeight: 1, padding: '0 2px',
              }}
              title="Clear preset"
            >
              ×
            </button>
          )}
        </div>
      )}

      {/* Query input */}
      <div className="inv-input-wrap">
        <input
          type="text"
          className="inv-input"
          placeholder="Enter company name (e.g. Hisense, TCL) or describe the type of partner you're looking for..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
        />
        <button
          type="button"
          className="primary-button inv-submit-btn"
          onClick={handleEvaluate}
          disabled={loading || !query.trim()}
        >
          {loading ? 'Analysing…' : 'Evaluate'}
        </button>
      </div>

      <Card title="Qichacha Direct Lookup" chip="ECIV4/GetBasicDetailsByName">
        <div className="inv-input-wrap" style={{ marginBottom: 12 }}>
          <input
            type="text"
            className="inv-input"
            placeholder="Company name / unified social credit code. Empty uses the company above."
            value={qccKeyword}
            onChange={(e) => setQccKeyword(e.target.value)}
            disabled={qccLoading}
          />
          <button
            type="button"
            className="secondary-button inv-submit-btn"
            onClick={handleQichachaLookup}
            disabled={qccLoading || !(qccKeyword.trim() || query.trim())}
          >
            {qccLoading ? 'Querying…' : 'Lookup Qichacha'}
          </button>
        </div>
        <div className="inv-sources-note">
          Credentials stay on the Flask backend. Frontend calls <code>/api/qichacha/company</code>, backend signs with Token = MD5(key + Timespan + SecretKey).
        </div>
        {qccError && <div className="info-banner danger" style={{ marginTop: 10 }}><strong>Qichacha:</strong> {qccError}</div>}
        {qccResult?.ok && (
          <div style={{ marginTop: 12 }}>
            <div className="meta-strip" style={{ marginBottom: 10 }}>
              <span className="meta-pill">Status: {qccResult.status}</span>
              <span className="meta-pill">Endpoint: {qccResult.endpoint}</span>
            </div>
            <table className="clause-table">
              <tbody>
                {extractQccRows(qccResult).map(([label, value]) => (
                  <tr key={label}>
                    <th style={{ width: '220px' }}>{label}</th>
                    <td>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontWeight: 700 }}>Show raw Qichacha JSON</summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowX: 'auto', fontSize: '0.72rem', color: 'var(--muted-strong)' }}>
                {JSON.stringify(qccResult.raw, null, 2)}
              </pre>
            </details>
          </div>
        )}
      </Card>

      {loading && <InvProgressSteps elapsed={elapsed} />}

      {error && (
        <div className="info-banner danger"><strong>Error:</strong> {error}</div>
      )}

      {report && (
        <div className="inv-report">

          {/* ── 评分 + 评级 ── */}
          <Card title={companyName || 'Partner Evaluation Report'}>
            <div className="inv-header-row">
              <div>
                <ScoreGauge score={displayScore} />
                {scoreFromPreset && (
                  <div style={{
                    fontSize: '0.65rem', color: '#c28a3d', textAlign: 'center',
                    marginTop: 4, fontWeight: 600,
                  }}>
                    Score from Partner Search
                  </div>
                )}
              </div>
              <div className="inv-header-meta">
                <VerdictBadge verdict={partnerVerdict} />
                {summary && <p className="inv-summary">{summary}</p>}
                {_meta && (
                  <div className="meta-strip" style={{ marginTop: 10 }}>
                    {_meta.extractedCompany && (
                      <span className="meta-pill">Company: {_meta.extractedCompany}</span>
                    )}
                    <span className="meta-pill">
                      Qichacha: {_meta.qiChaChaDataFetched ? '✓ Fetched' : 'Not fetched — supplemented by web search'}
                    </span>
                    {_meta.newsCacheIncluded && (
                      <span className="meta-pill">Daily News: ✓ Included</span>
                    )}
                  </div>
                )}
              </div>
            </div>
          </Card>

          {/* ── 公司基本信息 ── */}
          {Object.keys(companyProfile).length > 0 && (
            <Card title="Company Profile">
              <div className="inv-profile-grid">
                {Object.entries(companyProfile).filter(([, v]) => v).map(([key, val]) => (
                  <div key={key} className="inv-profile-item">
                    <div className="inv-profile-key">{camelToLabel(key)}</div>
                    <div className="inv-profile-val">{val}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── 发展历程 ── */}
          {developmentHistory.length > 0 && (
            <Card title="Development History">
              <div className="inv-timeline">
                {developmentHistory.map((m, i) => (
                  <div key={i} className="inv-timeline-item">
                    <div className="inv-timeline-dot" />
                    <div className="inv-timeline-body">
                      <div className="inv-timeline-header">
                        <span className="inv-timeline-title">{m.milestone}</span>
                        {m.date && <span className="inv-timeline-date">{m.date}</span>}
                      </div>
                      {m.detail && <div className="inv-timeline-detail">{m.detail}</div>}
                      {m.source && (
                        <div className="inv-source-tag">
                          <span className="inv-source-icon">⊡</span> {m.source}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── 核心团队 ── */}
          {coreTeam.length > 0 && (
            <Card title="Core Team">
              <div className="inv-team-grid">
                {coreTeam.map((m, i) => (
                  <div key={i} className="inv-team-card">
                    <div className="inv-team-name">{m.name}</div>
                    <div className="inv-team-title">{m.title}</div>
                    <div className="inv-team-bg">{m.background}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── 业务分析 ── */}
          {Object.keys(businessAnalysis).length > 0 && (
            <Card title="Business Analysis">
              {businessAnalysis.productDescription && (
                <div className="inv-biz-row">
                  <div className="inv-biz-label">Products / Services</div>
                  <div className="inv-biz-val">{businessAnalysis.productDescription}</div>
                </div>
              )}
              {businessAnalysis.revenueModel && (
                <div className="inv-biz-row">
                  <div className="inv-biz-label">Revenue Model</div>
                  <div className="inv-biz-val">{businessAnalysis.revenueModel}</div>
                </div>
              )}
              {(businessAnalysis.partnershipSynergies || []).length > 0 && (
                <div className="inv-biz-row">
                  <div className="inv-biz-label">Synergies</div>
                  <ul className="inv-bullet-list">
                    {businessAnalysis.partnershipSynergies.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              )}
              {(businessAnalysis.partnershipRisks || []).length > 0 && (
                <div className="inv-biz-row">
                  <div className="inv-biz-label">Partnership Risks</div>
                  <ul className="inv-bullet-list">
                    {businessAnalysis.partnershipRisks.map((r, i) => <li key={i}>{r}</li>)}
                  </ul>
                </div>
              )}
            </Card>
          )}

          {/* ── 市场分析 ── */}
          {Object.keys(marketAnalysis).length > 0 && (
            <Card title="Market Analysis">
              <div className="inv-profile-grid">
                {marketAnalysis.targetMarket && (
                  <div className="inv-profile-item">
                    <div className="inv-profile-key">Target Market</div>
                    <div className="inv-profile-val">{marketAnalysis.targetMarket}</div>
                  </div>
                )}
                {marketAnalysis.marketSize && (
                  <div className="inv-profile-item">
                    <div className="inv-profile-key">Market Size</div>
                    <div className="inv-profile-val">{marketAnalysis.marketSize}</div>
                  </div>
                )}
                {marketAnalysis.marketPosition && (
                  <div className="inv-profile-item inv-profile-item--wide">
                    <div className="inv-profile-key">Market Position</div>
                    <div className="inv-profile-val">{marketAnalysis.marketPosition}</div>
                  </div>
                )}
                {(marketAnalysis.competitors || []).length > 0 && (
                  <div className="inv-profile-item inv-profile-item--wide">
                    <div className="inv-profile-key">Key Competitors</div>
                    <div className="tag-row">
                      {marketAnalysis.competitors.map((c, i) => (
                        <span key={i} className="reference-tag">{c}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}

          {/* ── 合作历史 ── */}
          {partnershipHistory.length > 0 && (
            <Card title="Partnership History">
              <table className="clause-table">
                <thead>
                  <tr><th>Partner</th><th>Type</th><th>Date</th><th>Outcome</th><th>Source</th></tr>
                </thead>
                <tbody>
                  {partnershipHistory.map((p, i) => (
                    <tr key={i}>
                      <td><strong>{p.partner}</strong></td>
                      <td>{p.type}</td>
                      <td>{p.date}</td>
                      <td>{p.outcome}</td>
                      <td>
                        {p.source && (
                          <span className="inv-source-tag" style={{ fontSize: '0.73rem' }}>
                            {p.source}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          )}

          {/* ── 近期动态 ── */}
          {recentNews.length > 0 && (
            <Card title="Recent News">
              <div className="inv-news-list">
                {recentNews.map((n, i) => {
                  const sc = n.sentiment === 'POSITIVE' ? '#77d6c3' : n.sentiment === 'NEGATIVE' ? '#ff8d7d' : '#a8b3c8';
                  return (
                    <div key={i} className="inv-news-item">
                      <div className="inv-news-header">
                        <span className="inv-news-title">{n.title}</span>
                        <span style={{ fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px', borderRadius: 999, color: sc, background: `${sc}18`, border: `1px solid ${sc}44`, whiteSpace: 'nowrap' }}>
                          {n.sentiment === 'POSITIVE' ? 'Positive' : n.sentiment === 'NEGATIVE' ? 'Negative' : 'Neutral'}
                        </span>
                      </div>
                      <div className="inv-news-meta">
                        {n.date}
                        {n.source && (
                          <span>
                            {' · '}
                            {n.sourceUrl
                              ? <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer" className="inv-news-source-link">{n.source}</a>
                              : n.source}
                          </span>
                        )}
                      </div>
                      {n.summary && <div className="inv-news-summary">{n.summary}</div>}
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          {/* ── 风险因素 ── */}
          {riskFactors.length > 0 && (
            <Card title="Risk Factors">
              <div className="inv-risk-list">
                {riskFactors.map((r, i) => (
                  <div key={i} className="suggestion-row">
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <RiskBadge level={r.level} />
                      <span style={{ fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600 }}>{r.category}</span>
                    </div>
                    <div className="suggestion-text">{r.description}</div>
                  </div>
                ))}
              </div>
            </Card>
          )}

          {/* ── 合作建议 ── */}
          {Object.keys(partnershipRecommendation).length > 0 && (
            <Card title="Partnership Recommendation" chip={partnershipRecommendation.verdict || ''}>
              {partnershipRecommendation.rationale && (
                <p className="inv-rationale">{partnershipRecommendation.rationale}</p>
              )}
              {partnershipRecommendation.idealPartnershipType && (
                <div className="inv-profile-item" style={{ marginBottom: 14 }}>
                  <div className="inv-profile-key">Ideal Partnership Type</div>
                  <div className="inv-profile-val">{partnershipRecommendation.idealPartnershipType}</div>
                </div>
              )}
              {(partnershipRecommendation.collaborationOpportunities || []).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div className="inv-profile-key" style={{ marginBottom: 8 }}>Collaboration Opportunities</div>
                  <ul className="inv-bullet-list">
                    {partnershipRecommendation.collaborationOpportunities.map((o, i) => <li key={i}>{o}</li>)}
                  </ul>
                </div>
              )}
              {(partnershipRecommendation.dueDiligenceQuestions || []).length > 0 && (
                <div style={{ marginBottom: 14 }}>
                  <div className="inv-profile-key" style={{ marginBottom: 8 }}>Due Diligence Questions</div>
                  <ol className="inv-dd-list">
                    {partnershipRecommendation.dueDiligenceQuestions.map((q, i) => <li key={i}>{q}</li>)}
                  </ol>
                </div>
              )}
              {(partnershipRecommendation.nextSteps || []).length > 0 && (
                <div>
                  <div className="inv-profile-key" style={{ marginBottom: 8 }}>Next Steps</div>
                  <ol className="inv-dd-list">
                    {partnershipRecommendation.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
                  </ol>
                </div>
              )}
            </Card>
          )}

          {/* ── 信息来源 ── */}
          {sources.length > 0 && (
            <Card title="Sources" chip="Reliability Rating">
              <div className="inv-sources-note">
                The following sources were referenced by the AI during research. Prioritise HIGH reliability sources and independently verify key facts before making decisions.
              </div>
              <div className="inv-sources-list">
                {sources.map((s, i) => (
                  <div key={i} className="inv-source-row">
                    <div className="inv-source-left">
                      <ReliabilityBadge level={s.reliability} />
                      <span className="inv-source-type-tag">{s.type}</span>
                    </div>
                    <div className="inv-source-right">
                      {s.url
                        ? <a href={s.url} target="_blank" rel="noopener noreferrer" className="inv-source-name-link">{s.name}</a>
                        : <span className="inv-source-name-plain">{s.name}</span>
                      }
                      {s.note && <span className="inv-source-note">{s.note}</span>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="inv-sources-disclaimer">
                ⚠️ AI-generated content is for reference only and does not constitute formal business advice. Please independently verify before making decisions.
              </div>
            </Card>
          )}

        </div>
      )}

      {!report && !loading && !error && (
        <div className="inv-empty">
          <div className="inv-empty-icon">⬡</div>
          <div className="inv-empty-title">Partner Intelligence Evaluation</div>
          <div className="inv-empty-sub">
            Enter a target company name. The system integrates company registry data, web intelligence and market insights to generate a structured evaluation report with <strong>source citations and reliability ratings</strong>, helping you quickly assess partnership potential and risks.
          </div>
        </div>
      )}
    </div>
  );
}
