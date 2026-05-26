/**
 * PartnerIntelPanel — Unified Partner Intelligence
 *
 * Combines Partner Discovery (Phase 1) and Deep Evaluation (Phase 2)
 * into a single panel with three views:
 *
 *   setup      → sector selection + brief → "Discover" button
 *   discovery  → candidate list, top-3, comparison matrix
 *   deep-dive  → comprehensive single-company analysis
 *
 * Score consistency:
 *   Both phases use computeWeightedScore() — an exact mirror of the
 *   backend compute_weighted_score() formula:
 *     Σ ( dimension.score × weight × 20 )
 *   so the score shown in Deep Dive is always derived from the same
 *   formula as the Discovery score.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';

const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

// ── Export helpers ────────────────────────────────────────────────────────────
function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url  = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function slugify(str = '') {
  return str.slice(0, 40).replace(/[^\w\d-]+/g, '_').replace(/^_+|_+$/g, '') || 'report';
}

function serializeDiscoveryMarkdown(result, sectorKey) {
  const SECTORS_LOCAL = {
    consumer_electronics_brand: 'Consumer Electronics & Appliance Brand',
    social_commerce_agency: 'Social Commerce Agency',
  };
  const sectorLabel = SECTORS_LOCAL[sectorKey] || sectorKey;
  const lines = [
    `# Partner Intelligence Report — ${sectorLabel}`,
    `**Date:** ${result.search_date || new Date().toISOString().slice(0, 10)}`,
    result.client_brief_summary ? `**Brief:** ${result.client_brief_summary}` : '',
    '',
    '---',
    '',
  ];

  // § 1 Summary
  if (result.summary?.overview) {
    lines.push('## Summary', '', result.summary.overview, '');
    if (result.summary.key_considerations?.length) {
      lines.push('**Key Considerations:**');
      result.summary.key_considerations.forEach(c => lines.push(`- ${c}`));
      lines.push('');
    }
  }

  // § 2 Companies
  if (result.candidates?.length) {
    lines.push('---', '', '## Companies', '');
    result.candidates.forEach(c => {
      lines.push(`### #${c.rank} ${c.company_name_en || ''} ${c.company_name_cn || ''}`.trim());
      const bi = c.basic_info || {};
      if (bi.founded)        lines.push(`- **Founded:** ${bi.founded}`);
      if (bi.headquarters)   lines.push(`- **HQ:** ${bi.headquarters}`);
      if (bi.listed)         lines.push(`- **Listed:** ${bi.listed}`);
      if (bi.employees)      lines.push(`- **Employees:** ${bi.employees}`);
      if (bi.annual_revenue) lines.push(`- **Revenue:** ${bi.annual_revenue}`);
      if (bi.core_business)  lines.push(`- **Business:** ${bi.core_business}`);
      lines.push('');

      const co = c.china_operations || {};
      if (co.market_position || co.key_products || co.manufacturing_scale || co.recent_developments) {
        lines.push('**China Operations**');
        if (co.market_position)     lines.push(`- Market Position: ${co.market_position}`);
        if (co.key_products)        lines.push(`- Key Products: ${co.key_products}`);
        if (co.manufacturing_scale) lines.push(`- Manufacturing: ${co.manufacturing_scale}`);
        if (co.recent_developments) lines.push(`- Recent: ${co.recent_developments}`);
        lines.push('');
      }

      const me = c.middle_east_operations || {};
      if (me.presence || me.saudi_details || me.regional_details || me.partnerships) {
        lines.push('**Middle East Operations**');
        if (me.presence)        lines.push(`- Presence: ${me.presence}`);
        if (me.saudi_details)   lines.push(`- Saudi Arabia: ${me.saudi_details}`);
        if (me.regional_details)lines.push(`- Regional: ${me.regional_details}`);
        if (me.partnerships)    lines.push(`- Partnerships: ${me.partnerships}`);
        lines.push('');
      }

      if (c.strengths?.length) {
        lines.push('**Strengths**');
        c.strengths.forEach(s => lines.push(`- ${s}`));
        lines.push('');
      }
      if (c.risks?.length) {
        lines.push('**Risks**');
        c.risks.forEach(r => lines.push(`- ${r}`));
        lines.push('');
      }
      if (c.recommendation) lines.push(`**Assessment:** ${c.recommendation}`, '');
      lines.push(`**Partner Score:** ${c.weighted_score ?? '—'} / 100`, '', '---', '');
    });
  }

  // § 3 Comparison chart
  const chart = result.comparison_chart;
  if (chart?.rows?.length && chart.criteria?.length) {
    lines.push('## Comparison Chart', '');
    const criteria = chart.criteria;
    lines.push(`| Company | ${criteria.join(' | ')} |`);
    lines.push(`|---------|${criteria.map(() => '------').join('|')}|`);
    chart.rows.forEach(row => {
      const vals = criteria.map(c => (row.values?.[c] || '—').replace(/\|/g, '/'));
      lines.push(`| ${row.company} | ${vals.join(' | ')} |`);
    });
    lines.push('');
  }

  // § 4 Industry insight
  const ins = result.industry_insight;
  if (ins?.market_overview) {
    lines.push('---', '', '## Saudi / Middle East Market Insight', '', ins.market_overview, '');
    if (ins.key_trends?.length) {
      lines.push('**Key Trends**');
      ins.key_trends.forEach(t => lines.push(`- ${t}`));
      lines.push('');
    }
    if (ins.regulatory_environment) lines.push('**Regulatory Environment**', '', ins.regulatory_environment, '');
    if (ins.competitive_landscape)  lines.push('**Competitive Landscape**', '', ins.competitive_landscape, '');
  }

  // § 5+6 Recommendation + next steps
  const rm = result.recommendation_model;
  if (rm?.top_pick) {
    lines.push('---', '', '## Recommendation', '');
    if (rm.methodology) lines.push(`*${rm.methodology}*`, '');
    lines.push(`**Top Pick: ${rm.top_pick}**`, '');
    if (rm.top_pick_rationale) lines.push(rm.top_pick_rationale, '');
    if (rm.tiered_recommendations?.length) {
      rm.tiered_recommendations.forEach(t => {
        lines.push(`**${t.tier}:** ${t.company} — ${t.reason}`);
      });
      lines.push('');
    }
  }
  const ns = result.next_steps;
  if (ns) {
    lines.push('## Next Steps', '');
    if (ns.short_term?.length) { lines.push('**Short Term (0–3 months)**'); ns.short_term.forEach(a => lines.push(`- ${a}`)); lines.push(''); }
    if (ns.mid_term?.length)   { lines.push('**Mid Term (3–12 months)**');  ns.mid_term.forEach(a => lines.push(`- ${a}`));   lines.push(''); }
    if (ns.long_term?.length)  { lines.push('**Long Term (1–3 years)**');   ns.long_term.forEach(a => lines.push(`- ${a}`));  lines.push(''); }
  }

  // Sources
  if (result.authoritative_sources?.length) {
    lines.push('---', '', '## Sources', '');
    result.authoritative_sources.forEach(s => {
      lines.push(`- [${s.reliability}] ${s.name}${s.url ? ` — ${s.url}` : ''}${s.type ? ` (${s.type})` : ''}`);
    });
    lines.push('');
  }
  if (result.analyst_notes) lines.push('*Analyst Notes:', result.analyst_notes + '*', '');

  return lines.filter(l => l !== null && l !== undefined).join('\n');
}

function serializeDeepDiveMarkdown(report, candidate, sectorKey) {
  const companyName = report.companyName || candidate?.company_name_en || candidate?.company_name_cn || 'Company';
  const lines = [
    `# Deep Evaluation — ${companyName}`,
    `**Sector:** ${sectorKey}`,
    `**Partner Score:** ${report.partnerScore ?? '—'} / 100${report.presetScore != null ? ` (Discovery: ${report.presetScore})` : ''}`,
    `**Verdict:** ${report.partnerVerdict || '—'}`,
    '',
    report.summary ? report.summary : '',
    '',
    '---',
    '',
  ];

  // Company profile
  const prof = report.companyProfile || {};
  if (Object.keys(prof).length) {
    lines.push('## Company Profile', '');
    Object.entries(prof).filter(([, v]) => v).forEach(([k, v]) => {
      lines.push(`- **${k}:** ${v}`);
    });
    lines.push('');
  }

  // Dimensional scores
  const dims = report.dimensions || {};
  if (Object.keys(dims).length) {
    lines.push('## Dimensional Scores', '');
    Object.entries(dims).forEach(([key, d]) => {
      lines.push(`**${key}** — Score: ${d.score ?? '—'}${d.changed ? ` (refined from ${d.preScore})` : ''}${d.verified ? ' ✓' : ''}`);
      if (d.evidence) lines.push(`  ${d.evidence}${d.source ? ` [${d.source}]` : ''}`);
      if (d.changed && d.changeReason) lines.push(`  ↳ ${d.changeReason}`);
    });
    lines.push('');
  }

  // Business analysis
  const biz = report.businessAnalysis || {};
  if (biz.productDescription || biz.revenueModel) {
    lines.push('## Business Analysis', '');
    if (biz.productDescription) lines.push(`**Products/Services:** ${biz.productDescription}`, '');
    if (biz.revenueModel)       lines.push(`**Revenue Model:** ${biz.revenueModel}`, '');
    if (biz.partnershipSynergies?.length) {
      lines.push('**Synergies:**');
      biz.partnershipSynergies.forEach(s => lines.push(`- ${s}`));
      lines.push('');
    }
    if (biz.partnershipRisks?.length) {
      lines.push('**Partnership Risks:**');
      biz.partnershipRisks.forEach(r => lines.push(`- ${r}`));
      lines.push('');
    }
  }

  // Risk factors
  if (report.riskFactors?.length) {
    lines.push('## Risk Factors', '');
    report.riskFactors.forEach(r => lines.push(`- [${r.level}] **${r.category}:** ${r.description}`));
    lines.push('');
  }

  // Partnership recommendation
  const pr = report.partnershipRecommendation || {};
  if (pr.rationale || pr.nextSteps?.length) {
    lines.push('## Partnership Recommendation', '');
    if (pr.rationale)               lines.push(pr.rationale, '');
    if (pr.idealPartnershipType)    lines.push(`**Ideal Partnership Type:** ${pr.idealPartnershipType}`, '');
    if (pr.collaborationOpportunities?.length) {
      lines.push('**Opportunities:**');
      pr.collaborationOpportunities.forEach(o => lines.push(`- ${o}`));
      lines.push('');
    }
    if (pr.dueDiligenceQuestions?.length) {
      lines.push('**Due Diligence Questions:**');
      pr.dueDiligenceQuestions.forEach((q, i) => lines.push(`${i + 1}. ${q}`));
      lines.push('');
    }
    if (pr.nextSteps?.length) {
      lines.push('**Next Steps:**');
      pr.nextSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
      lines.push('');
    }
  }

  // Sources
  if (report.sources?.length) {
    lines.push('---', '', '## Sources', '');
    report.sources.forEach(s => {
      lines.push(`- [${s.reliability}] ${s.name}${s.url ? ` — ${s.url}` : ''}`);
    });
    lines.push('');
  }

  return lines.filter(l => l !== null && l !== undefined).join('\n');
}

// ── Sector definitions (mirrors backend SECTOR_CONFIGS) ───────────────────────
const SECTORS = {
  consumer_electronics_brand: {
    label: 'Consumer Electronics & Appliance Brand',
    tagline: 'Chinese electronics / appliance brands for Saudi market entry',
    icon: '📱',
    placeholder:
      'e.g. Looking for a 55"+ smart TV and air-conditioner brand with strong brand recognition, '
      + 'preferably SASO-certified, with no exclusive distributor in Saudi Arabia. Mid-to-premium positioning preferred.',
    dimensions: [
      { key: 'products',          label: 'Products & Categories',         weight: 0.10 },
      { key: 'market_position',   label: 'Market Position',               weight: 0.20 },
      { key: 'manufacturing',     label: 'Manufacturing Capability',      weight: 0.15 },
      { key: 'certifications',    label: 'SASO / SABER Certification',    weight: 0.25 },
      { key: 'export_experience', label: 'Export Experience',             weight: 0.15 },
      { key: 'saudi_presence',    label: 'Saudi Market Presence',         weight: 0.15 },
    ],
  },
  social_commerce_agency: {
    label: 'Social Commerce Agency',
    tagline: 'MCN & social commerce agencies for Middle East marketing',
    icon: '📲',
    placeholder:
      'e.g. Agency must cover TikTok + Snapchat, have local Saudi/Gulf KOL resources, '
      + 'provide Arabic content localisation, ideally experienced with TikTok Shop, performance-based payment preferred.',
    dimensions: [
      { key: 'platform_cert',     label: 'Platform Certification',        weight: 0.30 },
      { key: 'mena_experience',   label: 'Middle East Experience',        weight: 0.30 },
      { key: 'service_scope',     label: 'Service Scope',                 weight: 0.20 },
      { key: 'industry_position', label: 'Industry Standing',             weight: 0.10 },
      { key: 'business_model',    label: 'Business Model & Track Record', weight: 0.10 },
    ],
  },
};

// ── Deterministic score formula — mirrors backend compute_weighted_score() ────
function computeWeightedScore(dimensions, sectorKey) {
  const dims = SECTORS[sectorKey]?.dimensions ?? [];
  let total = 0;
  for (const dim of dims) {
    const raw   = (dimensions?.[dim.key])?.score ?? 0;
    const score = parseFloat(raw) || 0;
    total += score * dim.weight * 20;
  }
  return Math.max(0, Math.min(100, Math.round(total)));
}

// ── Color helpers ─────────────────────────────────────────────────────────────
function scoreColor(s) {
  if (s >= 4.5) return '#77d6c3';
  if (s >= 3.5) return '#c28a3d';
  if (s >= 2.5) return '#a8b3c8';
  return '#ff8d7d';
}
function scoreBg(s) {
  if (s >= 4.5) return 'rgba(119,214,195,0.12)';
  if (s >= 3.5) return 'rgba(194,138,61,0.12)';
  if (s >= 2.5) return 'rgba(168,179,200,0.08)';
  return 'rgba(255,141,125,0.12)';
}

// ── Progress steps ────────────────────────────────────────────────────────────
const DISCOVERY_STEPS = [
  { key: 'search',    label: '🔍 Searching for candidate companies' },
  { key: 'research',  label: '📊 Analysing authoritative data per dimension' },
  { key: 'structure', label: '✅ Generating comparison report' },
];
const DEEP_STEPS = [
  { key: 'registry',  label: '🏢 Fetching Qichacha business registry data' },
  { key: 'web',       label: '🌐 Live web research — certifications & market data' },
  { key: 'news',      label: '📰 Cross-referencing daily tech news cache' },
  { key: 'generate',  label: '✅ Generating deep evaluation report' },
];

function ProgressSteps({ steps, elapsed, thresholds, description }) {
  let stepIndex = 0;
  for (let i = thresholds.length - 1; i >= 0; i--) {
    if (elapsed >= thresholds[i]) { stepIndex = i; break; }
  }
  return (
    <div style={{
      padding: '28px 24px', borderRadius: 12,
      background: 'rgba(255,255,255,0.02)',
      border: '1px solid rgba(255,255,255,0.07)',
      display: 'flex', flexDirection: 'column', gap: 14,
    }}>
      <div style={{ fontSize: '0.82rem', color: '#5a6474', marginBottom: 4 }}>
        {description || 'Retrieving data from authoritative sources…'} {elapsed}s
      </div>
      {steps.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{
            width: 20, height: 20, borderRadius: '50%', flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: '0.7rem',
            background: i < stepIndex ? 'rgba(119,214,195,0.15)'
              : i === stepIndex ? 'rgba(194,138,61,0.15)' : 'rgba(255,255,255,0.04)',
            border: `1px solid ${i < stepIndex ? '#77d6c3'
              : i === stepIndex ? '#c28a3d' : 'rgba(255,255,255,0.1)'}`,
            color: i < stepIndex ? '#77d6c3' : i === stepIndex ? '#c28a3d' : '#3d4a5c',
          }}>
            {i < stepIndex ? '✓' : i === stepIndex ? '…' : '○'}
          </span>
          <span style={{
            fontSize: '0.83rem',
            color: i < stepIndex ? '#77d6c3' : i === stepIndex ? '#e8dcc8' : '#3d4a5c',
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
    </div>
  );
}

// ── Shared score components ───────────────────────────────────────────────────
function ScoreBar({ score, max = 5 }) {
  const pct = Math.min(100, (score / max) * 100);
  const c   = scoreColor(score);
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
      <span style={{ fontSize: '0.72rem', color: c, fontWeight: 700, minWidth: 20 }}>{score}</span>
    </div>
  );
}

function ScoreDot({ score }) {
  const c = scoreColor(score);
  return (
    <span style={{
      display: 'inline-block', width: 28, height: 28, borderRadius: '50%',
      background: scoreBg(score), border: `2px solid ${c}`,
      color: c, fontSize: '0.72rem', fontWeight: 800,
      textAlign: 'center', lineHeight: '24px',
    }}>
      {score}
    </span>
  );
}

// Large score dial for the deep-dive header
function ScoreGauge({ score, preScore }) {
  const pct   = Math.max(0, Math.min(100, score ?? 0));
  const color = pct >= 75 ? '#4ade80' : pct >= 55 ? '#77d6c3'
    : pct >= 40 ? '#f0bf68' : pct >= 25 ? '#ff8d7d' : '#ff6b6b';
  const delta = (preScore != null && preScore !== pct) ? pct - preScore : null;
  return (
    <div style={{ textAlign: 'center', minWidth: 130 }}>
      <div style={{ fontSize: '3rem', fontWeight: 800, color, lineHeight: 1 }}>{pct}</div>
      <div style={{ fontSize: '0.72rem', color: '#5a6474', margin: '4px 0 8px' }}>
        Partner Score / 100
      </div>
      {delta !== null ? (
        <div style={{
          fontSize: '0.72rem', fontWeight: 700,
          color: delta > 0 ? '#77d6c3' : '#ff8d7d', marginBottom: 4,
        }}>
          {delta > 0 ? `▲ +${delta}` : `▼ ${delta}`} vs Discovery
        </div>
      ) : preScore != null && (
        <div style={{ fontSize: '0.65rem', color: '#77d6c3', marginBottom: 4, fontWeight: 600 }}>
          ✓ Score confirmed
        </div>
      )}
      <div style={{ height: 8, borderRadius: 4, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
        <div style={{
          width: `${pct}%`, height: '100%', borderRadius: 4,
          background: color, transition: 'width 0.6s',
        }} />
      </div>
    </div>
  );
}

// Verdict badge (same levels as InvestmentPanel)
const VERDICT_CFG = {
  HIGHLY_RECOMMENDED: { label: 'Highly Recommended', color: '#4ade80', bg: 'rgba(74,222,128,0.12)' },
  RECOMMENDED:        { label: 'Recommended',         color: '#77d6c3', bg: 'rgba(119,214,195,0.12)' },
  NEUTRAL:            { label: 'Neutral',              color: '#a8b3c8', bg: 'rgba(168,179,200,0.12)' },
  CAUTIOUS:           { label: 'Cautious',             color: '#f0bf68', bg: 'rgba(240,191,104,0.12)' },
  NOT_RECOMMENDED:    { label: 'Not Recommended',      color: '#ff8d7d', bg: 'rgba(255,141,125,0.12)' },
};

function VerdictBadge({ verdict }) {
  const cfg = VERDICT_CFG[verdict] || VERDICT_CFG.NEUTRAL;
  return (
    <span style={{
      display: 'inline-block', padding: '4px 14px', borderRadius: 999,
      fontSize: '0.78rem', fontWeight: 700, letterSpacing: '0.04em',
      color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.color}44`,
    }}>
      {cfg.label}
    </span>
  );
}

// Dimension score grid — shared by Discovery card and Deep Dive report
function DimensionScoreGrid({ dimensions, sectorKey, showChanges = false }) {
  const dims = SECTORS[sectorKey]?.dimensions ?? [];
  return (
    <div style={{ display: 'grid', gap: 10 }}>
      {dims.map(dim => {
        const d = dimensions?.[dim.key] ?? {};
        return (
          <div key={dim.key}>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: '0.78rem', marginBottom: 4,
            }}>
              <span style={{ color: '#a8b3c8' }}>{dim.label}</span>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                {showChanges && d.changed && (
                  <span style={{ fontSize: '0.62rem', color: '#c28a3d', fontWeight: 700 }}>
                    REFINED from {d.preScore}
                  </span>
                )}
                {d.verified
                  ? <span style={{ fontSize: '0.62rem', color: '#77d6c3' }}>✓ Verified</span>
                  : d.score
                    ? <span style={{ fontSize: '0.62rem', color: '#c28a3d' }}>Unverified</span>
                    : null}
              </div>
            </div>
            <ScoreBar score={d.score ?? 0} />
            {d.evidence && (
              <div style={{
                fontSize: '0.72rem', color: '#5a6474',
                marginTop: 3, lineHeight: 1.5,
              }}>
                {d.evidence}
                {d.source && (
                  <span style={{ marginLeft: 6, color: '#3d7a7a', fontStyle: 'italic' }}>
                    [{d.source}]
                  </span>
                )}
              </div>
            )}
            {showChanges && d.changed && d.changeReason && (
              <div style={{ fontSize: '0.7rem', color: '#c28a3d', marginTop: 2, fontStyle: 'italic' }}>
                ↳ {d.changeReason}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Phase 1 candidate card ────────────────────────────────────────────────────
function CandidateCard({ candidate, sectorKey, rank, onDeepEvaluate }) {
  const [open, setOpen] = useState(rank <= 3);

  const CARD_VERDICT = {
    'Recommended':          { color: '#77d6c3', bg: 'rgba(119,214,195,0.1)' },
    'Proceed with Caution': { color: '#c28a3d', bg: 'rgba(194,138,61,0.1)' },
    'Not Recommended':      { color: '#ff8d7d', bg: 'rgba(255,141,125,0.1)' },
  };
  const recText   = candidate.recommendation ?? '';
  const vKey      = Object.keys(CARD_VERDICT).find(k => recText.includes(k)) ?? 'Proceed with Caution';
  const vc        = CARD_VERDICT[vKey];
  const wsColor   = scoreColor(candidate.weighted_score / 20);

  return (
    <div style={{
      background: 'rgba(255,255,255,0.025)',
      border: rank === 1
        ? '1px solid rgba(194,138,61,0.4)'
        : '1px solid rgba(255,255,255,0.07)',
      borderRadius: 12, overflow: 'hidden',
    }}>
      {/* Header — expand/collapse */}
      <button type="button" onClick={() => setOpen(v => !v)} style={{
        width: '100%', display: 'flex', alignItems: 'center', gap: 12,
        padding: '14px 16px', background: 'none', border: 'none',
        cursor: 'pointer', textAlign: 'left',
      }}>
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
        {/* Name */}
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#e8dcc8' }}>
            {candidate.company_name_en
              ? `${candidate.company_name_en} `
              : ''}
            <span style={{ color: '#8a96a8', fontWeight: 400 }}>
              {candidate.company_name_cn}
            </span>
          </div>
          {candidate.brief_intro && (
            <div style={{ fontSize: '0.75rem', color: '#5a6474', marginTop: 2 }}>
              {candidate.brief_intro}
            </div>
          )}
        </div>
        {/* Score */}
        <div style={{ textAlign: 'right', marginRight: 8 }}>
          <div style={{ fontSize: '1.3rem', fontWeight: 800, color: wsColor }}>
            {candidate.weighted_score ?? '—'}
          </div>
          <div style={{ fontSize: '0.65rem', color: '#5a6474' }}>/ 100</div>
        </div>
        {/* Verdict */}
        <span style={{
          padding: '4px 10px', borderRadius: 999, fontSize: '0.72rem',
          fontWeight: 700, color: vc.color, background: vc.bg,
          border: `1px solid ${vc.color}44`, whiteSpace: 'nowrap',
        }}>
          {vKey}
        </span>
        <span style={{ color: '#5a6474', fontSize: '0.8rem', marginLeft: 4 }}>
          {open ? '▲' : '▼'}
        </span>
      </button>

      {/* Deep Evaluate CTA — always visible */}
      <div style={{
        padding: '5px 16px 9px',
        borderTop: '1px solid rgba(255,255,255,0.04)',
        display: 'flex', justifyContent: 'flex-end',
      }}>
        <button
          type="button"
          onClick={() => onDeepEvaluate(candidate)}
          style={{
            padding: '5px 16px', borderRadius: 6, fontSize: '0.75rem',
            fontWeight: 700, cursor: 'pointer',
            background: 'rgba(194,138,61,0.1)',
            color: '#c28a3d', border: '1px solid rgba(194,138,61,0.35)',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(194,138,61,0.2)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(194,138,61,0.1)'; }}
        >
          🔬 Deep Evaluate →
        </button>
      </div>

      {/* Expanded body */}
      {open && (
        <div style={{ padding: '0 16px 16px', borderTop: '1px solid rgba(255,255,255,0.05)' }}>

          {/* Basic info strip */}
          {candidate.basic_info && (
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12, marginBottom: 14,
            }}>
              {[
                candidate.basic_info.founded     && `Est. ${candidate.basic_info.founded}`,
                candidate.basic_info.headquarters,
                candidate.basic_info.listed,
                candidate.basic_info.employees   && `${candidate.basic_info.employees} employees`,
                candidate.basic_info.annual_revenue,
              ].filter(Boolean).map((val, i) => (
                <span key={i} style={{
                  fontSize: '0.72rem', padding: '2px 8px', borderRadius: 4,
                  background: 'rgba(255,255,255,0.04)', color: '#8a96a8',
                  border: '1px solid rgba(255,255,255,0.08)',
                }}>{val}</span>
              ))}
              {candidate.basic_info.core_business && (
                <div style={{ width: '100%', fontSize: '0.75rem', color: '#5a6474', marginTop: 4, lineHeight: 1.5 }}>
                  {candidate.basic_info.core_business}
                </div>
              )}
            </div>
          )}

          {/* China ops + ME ops */}
          {(candidate.china_operations || candidate.middle_east_operations) && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              {candidate.china_operations && (
                <div style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#77d6c3', marginBottom: 8, letterSpacing: '0.05em' }}>
                    🇨🇳 CHINA OPERATIONS
                  </div>
                  {[
                    { label: 'Market Position', val: candidate.china_operations.market_position },
                    { label: 'Key Products',    val: candidate.china_operations.key_products },
                    { label: 'Manufacturing',   val: candidate.china_operations.manufacturing_scale },
                    { label: 'Recent News',     val: candidate.china_operations.recent_developments },
                  ].filter(r => r.val).map(({ label, val }) => (
                    <div key={label} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: '0.65rem', color: '#3d4a5c', marginBottom: 1 }}>{label}</div>
                      <div style={{ fontSize: '0.75rem', color: '#a8b3c8', lineHeight: 1.5 }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}
              {candidate.middle_east_operations && (
                <div style={{
                  padding: '10px 12px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
                }}>
                  <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#c28a3d', marginBottom: 8, letterSpacing: '0.05em' }}>
                    🌍 MIDDLE EAST OPERATIONS
                  </div>
                  {[
                    { label: 'Presence',          val: candidate.middle_east_operations.presence },
                    { label: 'Saudi Arabia',       val: candidate.middle_east_operations.saudi_details },
                    { label: 'Regional',           val: candidate.middle_east_operations.regional_details },
                    { label: 'Partnerships',       val: candidate.middle_east_operations.partnerships },
                  ].filter(r => r.val).map(({ label, val }) => (
                    <div key={label} style={{ marginBottom: 6 }}>
                      <div style={{ fontSize: '0.65rem', color: '#3d4a5c', marginBottom: 1 }}>{label}</div>
                      <div style={{
                        fontSize: '0.75rem', lineHeight: 1.5,
                        color: /^active/i.test(val) ? '#77d6c3' : /^none/i.test(val) ? '#5a6474' : '#a8b3c8',
                      }}>{val}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Dimension scores */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#5a6474', marginBottom: 10, letterSpacing: '0.05em' }}>
              DIMENSION SCORES
            </div>
            <DimensionScoreGrid dimensions={candidate.dimensions ?? {}} sectorKey={sectorKey} />
          </div>

          {/* Strengths + risks */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#77d6c3', marginBottom: 6 }}>✓ STRENGTHS</div>
              {(candidate.strengths ?? []).map((s, i) => (
                <div key={i} style={{ fontSize: '0.75rem', color: '#8a96a8', marginBottom: 4, lineHeight: 1.5 }}>· {s}</div>
              ))}
            </div>
            <div>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#ff8d7d', marginBottom: 6 }}>⚠ RISKS</div>
              {(candidate.risks ?? []).map((r, i) => (
                <div key={i} style={{ fontSize: '0.75rem', color: '#8a96a8', marginBottom: 4, lineHeight: 1.5 }}>· {r}</div>
              ))}
            </div>
          </div>

          {recText && (
            <div style={{
              marginTop: 12, padding: '8px 12px', borderRadius: 8,
              background: vc.bg, border: `1px solid ${vc.color}33`,
              fontSize: '0.78rem', color: '#c8d0dc', lineHeight: 1.6,
            }}>
              <span style={{ fontWeight: 700, color: vc.color }}>Assessment: </span>{recText}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Comparison matrix ─────────────────────────────────────────────────────────
function ComparisonMatrix({ candidates, sectorKey }) {
  const dims = SECTORS[sectorKey]?.dimensions ?? [];
  if (!candidates?.length || !dims.length) return null;
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
            {dims.map(d => (
              <th key={d.key} style={{
                textAlign: 'center', padding: '8px 10px',
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                color: '#5a6474', fontWeight: 600, whiteSpace: 'nowrap', minWidth: 90,
              }}>
                {d.label}
              </th>
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
                {c.company_name_en || c.company_name_cn}
              </td>
              {dims.map(d => (
                <td key={d.key} style={{ textAlign: 'center', padding: '8px 10px' }}>
                  <ScoreDot score={c.dimensions?.[d.key]?.score ?? 0} />
                </td>
              ))}
              <td style={{ textAlign: 'center', padding: '8px 10px' }}>
                <span style={{
                  fontWeight: 800, fontSize: '0.9rem',
                  color: scoreColor(c.weighted_score / 20),
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

// ── Shared section helpers ────────────────────────────────────────────────────
function SectionHeading({ label }) {
  return (
    <div style={{
      fontSize: '0.68rem', fontWeight: 700, color: '#5a6474',
      letterSpacing: '0.07em', marginBottom: 12,
      paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.06)',
    }}>
      {label.toUpperCase()}
    </div>
  );
}

function SourcesList({ sources, analystNotes }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {sources.map((s, i) => {
        const rc = s.reliability === 'HIGH' ? '#77d6c3' : s.reliability === 'MEDIUM' ? '#c28a3d' : '#5a6474';
        return (
          <div key={i} style={{
            padding: '8px 12px', borderRadius: 8,
            background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
            display: 'flex', gap: 10, alignItems: 'flex-start',
          }}>
            <span style={{
              fontSize: '0.62rem', fontWeight: 700, color: rc, padding: '2px 6px',
              borderRadius: 4, background: `${rc}18`, border: `1px solid ${rc}44`,
              whiteSpace: 'nowrap', marginTop: 2,
            }}>{s.reliability}</span>
            <div>
              <div style={{ fontSize: '0.8rem', color: '#e8dcc8', fontWeight: 600 }}>
                {s.url
                  ? <a href={s.url} target="_blank" rel="noopener noreferrer"
                      style={{ color: 'inherit', textDecoration: 'none' }}>{s.name} ↗</a>
                  : s.name}
              </div>
              {s.type && <div style={{ fontSize: '0.68rem', color: '#5a6474', marginTop: 1 }}>{s.type}</div>}
            </div>
          </div>
        );
      })}
      {analystNotes && (
        <div style={{
          marginTop: 4, padding: '10px 12px', borderRadius: 8,
          background: 'rgba(194,138,61,0.05)', border: '1px solid rgba(194,138,61,0.15)',
          fontSize: '0.75rem', color: '#8a96a8', lineHeight: 1.7,
        }}>
          <span style={{ fontWeight: 700, color: '#c28a3d' }}>Analyst Notes: </span>{analystNotes}
        </div>
      )}
    </div>
  );
}

// ── Section 1: Summary ────────────────────────────────────────────────────────
function SummarySection({ summary, candidateCount }) {
  if (!summary?.overview) return null;
  return (
    <div style={{
      padding: '16px 20px', borderRadius: 10,
      background: 'rgba(194,138,61,0.06)',
      border: '1px solid rgba(194,138,61,0.2)',
      marginBottom: 20,
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.78rem', color: '#c28a3d', marginBottom: 8, letterSpacing: '0.05em' }}>
        SUMMARY — {candidateCount} COMPANIES EVALUATED
      </div>
      <p style={{ fontSize: '0.88rem', color: '#c8d0dc', lineHeight: 1.75, margin: '0 0 12px' }}>
        {summary.overview}
      </p>
      {(summary.key_considerations ?? []).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {summary.key_considerations.map((c, i) => (
            <span key={i} style={{
              fontSize: '0.72rem', padding: '3px 10px', borderRadius: 999,
              background: 'rgba(194,138,61,0.1)', color: '#c28a3d',
              border: '1px solid rgba(194,138,61,0.25)',
            }}>{c}</span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Section 3: Comparison chart ───────────────────────────────────────────────
function ComparisonChartSection({ chart }) {
  if (!chart?.rows?.length) return null;
  const criteria = chart.criteria ?? [];
  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
        <thead>
          <tr>
            <th style={{
              textAlign: 'left', padding: '8px 12px', whiteSpace: 'nowrap',
              borderBottom: '1px solid rgba(255,255,255,0.1)',
              color: '#5a6474', fontWeight: 600, minWidth: 140,
            }}>Company</th>
            {criteria.map(c => (
              <th key={c} style={{
                textAlign: 'left', padding: '8px 10px', whiteSpace: 'nowrap',
                borderBottom: '1px solid rgba(255,255,255,0.1)',
                color: '#5a6474', fontWeight: 600, minWidth: 110,
              }}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {chart.rows.map((row, i) => (
            <tr key={i} style={{
              borderBottom: '1px solid rgba(255,255,255,0.04)',
              background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)',
            }}>
              <td style={{ padding: '8px 12px', color: '#e8dcc8', fontWeight: 600, whiteSpace: 'nowrap' }}>
                {row.company}
              </td>
              {criteria.map(c => {
                const val = row.values?.[c] ?? '—';
                const isPositive = /^yes/i.test(val) || /active/i.test(val);
                const isNegative = /^no\b/i.test(val) || /none/i.test(val);
                return (
                  <td key={c} style={{
                    padding: '8px 10px',
                    color: isPositive ? '#77d6c3' : isNegative ? '#5a6474' : '#a8b3c8',
                    verticalAlign: 'top',
                  }}>
                    {val}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Section 4: Industry insight ───────────────────────────────────────────────
function IndustryInsightSection({ insight }) {
  if (!insight) return null;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {insight.market_overview && (
        <p style={{ fontSize: '0.86rem', color: '#c8d0dc', lineHeight: 1.75, margin: 0 }}>
          {insight.market_overview}
        </p>
      )}
      {(insight.key_trends ?? []).length > 0 && (
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#77d6c3', marginBottom: 8 }}>KEY TRENDS</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {insight.key_trends.map((t, i) => (
              <div key={i} style={{ fontSize: '0.82rem', color: '#a8b3c8', lineHeight: 1.6 }}>
                <span style={{ color: '#77d6c3', marginRight: 8 }}>→</span>{t}
              </div>
            ))}
          </div>
        </div>
      )}
      {insight.regulatory_environment && (
        <div style={{
          padding: '10px 14px', borderRadius: 8,
          background: 'rgba(119,214,195,0.05)', border: '1px solid rgba(119,214,195,0.15)',
        }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#77d6c3', marginBottom: 6 }}>REGULATORY ENVIRONMENT</div>
          <div style={{ fontSize: '0.82rem', color: '#a8b3c8', lineHeight: 1.6 }}>{insight.regulatory_environment}</div>
        </div>
      )}
      {insight.competitive_landscape && (
        <div>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#c28a3d', marginBottom: 6 }}>COMPETITIVE LANDSCAPE</div>
          <div style={{ fontSize: '0.82rem', color: '#a8b3c8', lineHeight: 1.6 }}>{insight.competitive_landscape}</div>
        </div>
      )}
    </div>
  );
}

// ── Section 5 + 6: Recommendation model + Next steps ─────────────────────────
function RecommendationSection({ model, nextSteps }) {
  const TIER_COLOR = { Primary: '#4ade80', Alternative: '#77d6c3', Backup: '#a8b3c8' };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Recommendation model */}
      {model && (
        <div>
          {model.methodology && (
            <p style={{ fontSize: '0.82rem', color: '#8a96a8', lineHeight: 1.6, margin: '0 0 14px', fontStyle: 'italic' }}>
              {model.methodology}
            </p>
          )}
          {model.top_pick && (
            <div style={{
              padding: '12px 16px', borderRadius: 8, marginBottom: 14,
              background: 'rgba(74,222,128,0.06)', border: '1px solid rgba(74,222,128,0.2)',
            }}>
              <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#4ade80', marginBottom: 4 }}>🏆 TOP PICK</div>
              <div style={{ fontWeight: 700, color: '#e8dcc8', marginBottom: 6 }}>{model.top_pick}</div>
              {model.top_pick_rationale && (
                <div style={{ fontSize: '0.82rem', color: '#a8b3c8', lineHeight: 1.6 }}>{model.top_pick_rationale}</div>
              )}
            </div>
          )}
          {(model.tiered_recommendations ?? []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {model.tiered_recommendations.map((t, i) => {
                const c = TIER_COLOR[t.tier] ?? '#a8b3c8';
                return (
                  <div key={i} style={{
                    display: 'flex', gap: 12, alignItems: 'flex-start',
                    padding: '10px 14px', borderRadius: 8,
                    background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.07)',
                  }}>
                    <span style={{
                      fontSize: '0.68rem', fontWeight: 700, color: c,
                      padding: '2px 8px', borderRadius: 4,
                      background: `${c}18`, border: `1px solid ${c}44`,
                      whiteSpace: 'nowrap', marginTop: 2,
                    }}>{t.tier}</span>
                    <div>
                      <div style={{ fontWeight: 700, fontSize: '0.85rem', color: '#e8dcc8', marginBottom: 3 }}>{t.company}</div>
                      <div style={{ fontSize: '0.78rem', color: '#8a96a8', lineHeight: 1.5 }}>{t.reason}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Next steps */}
      {nextSteps && (
        <div>
          <div style={{ fontSize: '0.78rem', fontWeight: 700, color: '#5a6474', marginBottom: 12, letterSpacing: '0.05em' }}>
            NEXT STEPS
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px,1fr))', gap: 12 }}>
            {[
              { key: 'short_term', label: 'Short Term', sub: '0–3 months', color: '#77d6c3' },
              { key: 'mid_term',   label: 'Mid Term',   sub: '3–12 months', color: '#c28a3d' },
              { key: 'long_term',  label: 'Long Term',  sub: '1–3 years',   color: '#a8b3c8' },
            ].map(({ key, label, sub, color }) => {
              const items = nextSteps[key] ?? [];
              if (!items.length) return null;
              return (
                <div key={key} style={{
                  padding: '12px 14px', borderRadius: 8,
                  background: 'rgba(255,255,255,0.02)',
                  border: `1px solid ${color}33`,
                }}>
                  <div style={{ fontWeight: 700, fontSize: '0.78rem', color, marginBottom: 2 }}>{label}</div>
                  <div style={{ fontSize: '0.68rem', color: '#3d4a5c', marginBottom: 10 }}>{sub}</div>
                  {items.map((item, i) => (
                    <div key={i} style={{ fontSize: '0.78rem', color: '#8a96a8', marginBottom: 6, lineHeight: 1.5 }}>
                      <span style={{ color, marginRight: 6 }}>·</span>{item}
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Deep Dive report ──────────────────────────────────────────────────────────
const RISK_COLOR        = { LOW: '#77d6c3', MEDIUM: '#f0bf68', HIGH: '#ff8d7d', CRITICAL: '#ff6b6b' };
const RELIABILITY_COLOR = { HIGH: '#77d6c3', MEDIUM: '#f0bf68', LOW: '#ff8d7d' };
const RELIABILITY_LABEL = { HIGH: 'Verified',  MEDIUM: 'Partially Verified', LOW: 'Unverified' };

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

function camelToLabel(key) {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim();
}

function DeepDiveReport({ report, sectorKey, selectedCandidate, onBack }) {
  const {
    companyName = '', partnerScore = 0, presetScore,
    partnerVerdict = 'NEUTRAL', dimensions = {},
    summary = '', companyProfile = {}, developmentHistory = [],
    coreTeam = [], businessAnalysis = {}, marketAnalysis = {},
    partnershipHistory = [], recentNews = [], riskFactors = [],
    partnershipRecommendation = {}, sources = [], _meta,
  } = report;

  // Re-derive score from dimensions using the same formula — guaranteed consistent
  const displayScore = computeWeightedScore(dimensions, sectorKey) || partnerScore;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Back + Export row */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <button type="button" onClick={onBack} style={{
          padding: '6px 14px', borderRadius: 6,
          fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
          background: 'rgba(255,255,255,0.04)',
          color: '#a8b3c8', border: '1px solid rgba(255,255,255,0.1)',
        }}>
          ← Back to Results
        </button>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              const name = companyName || selectedCandidate?.company_name_en || 'company';
              const md = serializeDeepDiveMarkdown(report, selectedCandidate, sectorKey);
              downloadFile(`deep-eval-${slugify(name)}.md`, md, 'text/markdown;charset=utf-8');
            }}
          >Export MD</button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              const name = companyName || selectedCandidate?.company_name_en || 'company';
              downloadFile(`deep-eval-${slugify(name)}.json`, JSON.stringify(report, null, 2), 'application/json;charset=utf-8');
            }}
          >Export JSON</button>
        </div>
      </div>

      {/* Score + verdict header */}
      <Card title={companyName || 'Deep Partner Evaluation'}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <ScoreGauge score={displayScore} preScore={presetScore} />
          <div style={{ flex: 1, minWidth: 200 }}>
            <div style={{ marginBottom: 10 }}><VerdictBadge verdict={partnerVerdict} /></div>
            {summary && (
              <p style={{ fontSize: '0.88rem', color: '#c8d0dc', lineHeight: 1.7, margin: 0 }}>
                {summary}
              </p>
            )}
            {_meta && (
              <div className="meta-strip" style={{ marginTop: 12, flexWrap: 'wrap' }}>
                <span className="meta-pill">
                  Sector: {SECTORS[sectorKey]?.label ?? sectorKey}
                </span>
                <span className="meta-pill">
                  Registry: {_meta.qiChaChaDataFetched
                    ? '✓ Qichacha fetched'
                    : '企查查 not yet connected — web search used'}
                </span>
                {_meta.newsCacheIncluded && (
                  <span className="meta-pill">
                    News: ✓ {_meta.newsArticleCount} article{_meta.newsArticleCount !== 1 ? 's' : ''}
                  </span>
                )}
                {_meta.computedScore !== _meta.presetScore && (
                  <span className="meta-pill" style={{ color: '#f0bf68' }}>
                    Score refined: {_meta.presetScore} → {_meta.computedScore}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </Card>

      {/* Dimensional scoring — same formula as Discovery */}
      {Object.keys(dimensions).length > 0 && (
        <Card title="Dimensional Scoring" chip="Same formula as Discovery">
          <DimensionScoreGrid
            dimensions={dimensions}
            sectorKey={sectorKey}
            showChanges
          />
        </Card>
      )}

      {/* Company profile */}
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

      {/* Development history */}
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

      {/* Core team */}
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

      {/* Business analysis */}
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
          {(businessAnalysis.partnershipSynergies ?? []).length > 0 && (
            <div className="inv-biz-row">
              <div className="inv-biz-label">Synergies</div>
              <ul className="inv-bullet-list">
                {businessAnalysis.partnershipSynergies.map((s, i) => <li key={i}>{s}</li>)}
              </ul>
            </div>
          )}
          {(businessAnalysis.partnershipRisks ?? []).length > 0 && (
            <div className="inv-biz-row">
              <div className="inv-biz-label">Partnership Risks</div>
              <ul className="inv-bullet-list">
                {businessAnalysis.partnershipRisks.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
        </Card>
      )}

      {/* Market analysis */}
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
            {(marketAnalysis.competitors ?? []).length > 0 && (
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

      {/* Partnership history */}
      {partnershipHistory.length > 0 && (
        <Card title="Partnership History">
          <table className="clause-table">
            <thead>
              <tr>
                <th>Partner</th><th>Type</th><th>Date</th>
                <th>Outcome</th><th>Source</th>
              </tr>
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

      {/* Recent news */}
      {recentNews.length > 0 && (
        <Card title="Recent News">
          <div className="inv-news-list">
            {recentNews.map((n, i) => {
              const sc = n.sentiment === 'POSITIVE' ? '#77d6c3'
                : n.sentiment === 'NEGATIVE' ? '#ff8d7d' : '#a8b3c8';
              return (
                <div key={i} className="inv-news-item">
                  <div className="inv-news-header">
                    <span className="inv-news-title">{n.title}</span>
                    <span style={{
                      fontSize: '0.7rem', fontWeight: 700, padding: '2px 8px',
                      borderRadius: 999, color: sc, background: `${sc}18`,
                      border: `1px solid ${sc}44`, whiteSpace: 'nowrap',
                    }}>
                      {n.sentiment === 'POSITIVE' ? 'Positive'
                        : n.sentiment === 'NEGATIVE' ? 'Negative' : 'Neutral'}
                    </span>
                  </div>
                  <div className="inv-news-meta">
                    {n.date}
                    {n.source && (
                      <span>
                        {' · '}
                        {n.sourceUrl
                          ? <a href={n.sourceUrl} target="_blank" rel="noopener noreferrer"
                              className="inv-news-source-link">{n.source}</a>
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

      {/* Risk factors */}
      {riskFactors.length > 0 && (
        <Card title="Risk Factors">
          <div className="inv-risk-list">
            {riskFactors.map((r, i) => {
              const c = RISK_COLOR[r.level] ?? '#a8b3c8';
              return (
                <div key={i} className="suggestion-row">
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span style={{
                      display: 'inline-block', padding: '2px 10px', borderRadius: 999,
                      fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.05em',
                      textTransform: 'uppercase', color: c,
                      background: `${c}18`, border: `1px solid ${c}44`,
                    }}>
                      {r.level ?? '—'}
                    </span>
                    <span style={{
                      fontSize: '0.78rem', color: 'var(--text-muted)', fontWeight: 600,
                    }}>
                      {r.category}
                    </span>
                  </div>
                  <div className="suggestion-text">{r.description}</div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Partnership recommendation */}
      {Object.keys(partnershipRecommendation).length > 0 && (
        <Card
          title="Partnership Recommendation"
          chip={partnershipRecommendation.verdict ?? ''}
        >
          {partnershipRecommendation.rationale && (
            <p className="inv-rationale">{partnershipRecommendation.rationale}</p>
          )}
          {partnershipRecommendation.idealPartnershipType && (
            <div className="inv-profile-item" style={{ marginBottom: 14 }}>
              <div className="inv-profile-key">Ideal Partnership Type</div>
              <div className="inv-profile-val">
                {partnershipRecommendation.idealPartnershipType}
              </div>
            </div>
          )}
          {(partnershipRecommendation.collaborationOpportunities ?? []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="inv-profile-key" style={{ marginBottom: 8 }}>
                Collaboration Opportunities
              </div>
              <ul className="inv-bullet-list">
                {partnershipRecommendation.collaborationOpportunities.map((o, i) =>
                  <li key={i}>{o}</li>)}
              </ul>
            </div>
          )}
          {(partnershipRecommendation.dueDiligenceQuestions ?? []).length > 0 && (
            <div style={{ marginBottom: 14 }}>
              <div className="inv-profile-key" style={{ marginBottom: 8 }}>
                Due Diligence Questions
              </div>
              <ol className="inv-dd-list">
                {partnershipRecommendation.dueDiligenceQuestions.map((q, i) =>
                  <li key={i}>{q}</li>)}
              </ol>
            </div>
          )}
          {(partnershipRecommendation.nextSteps ?? []).length > 0 && (
            <div>
              <div className="inv-profile-key" style={{ marginBottom: 8 }}>Next Steps</div>
              <ol className="inv-dd-list">
                {partnershipRecommendation.nextSteps.map((s, i) => <li key={i}>{s}</li>)}
              </ol>
            </div>
          )}
        </Card>
      )}

      {/* Sources */}
      {sources.length > 0 && (
        <Card title="Sources" chip="Reliability Rating">
          <div className="inv-sources-list">
            {sources.map((s, i) => {
              const c = RELIABILITY_COLOR[s.reliability] ?? '#a8b3c8';
              return (
                <div key={i} className="inv-source-row">
                  <div className="inv-source-left">
                    <span style={{
                      display: 'inline-block', padding: '2px 8px', borderRadius: 999,
                      fontSize: '0.68rem', fontWeight: 700, color: c,
                      background: `${c}18`, border: `1px solid ${c}44`,
                    }}>
                      {RELIABILITY_LABEL[s.reliability] ?? s.reliability}
                    </span>
                    <span className="inv-source-type-tag">{s.type}</span>
                  </div>
                  <div className="inv-source-right">
                    {s.url
                      ? <a href={s.url} target="_blank" rel="noopener noreferrer"
                          className="inv-source-name-link">{s.name}</a>
                      : <span className="inv-source-name-plain">{s.name}</span>}
                    {s.note && <span className="inv-source-note">{s.note}</span>}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="inv-sources-disclaimer">
            ⚠️ AI-generated content is for reference only and does not constitute
            formal business advice. Please independently verify before making decisions.
          </div>
        </Card>
      )}
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────────────
export default function PartnerIntelPanel() {
  // Three-view state machine: setup → discovery → deep-dive
  const [view,     setView]     = useState('setup');
  const [sector,   setSector]   = useState('consumer_electronics_brand');
  const [brief,    setBrief]    = useState('');
  const [region,   setRegion]   = useState('');   // e.g. 威海、广东
  const [industry, setIndustry] = useState('');   // e.g. 渔具、纺织品

  // Phase 1 — Discovery
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchResult,  setSearchResult]  = useState(null);
  const [searchError,   setSearchError]   = useState('');
  const [searchElapsed, setSearchElapsed] = useState(0);
  const [searchTab,     setSearchTab]     = useState('cards');

  // Phase 2 — Deep Dive
  const [deepLoading,       setDeepLoading]       = useState(false);
  const [deepResult,        setDeepResult]        = useState(null);
  const [deepError,         setDeepError]         = useState('');
  const [deepElapsed,       setDeepElapsed]       = useState(0);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

  const searchTimerRef = useRef(null);
  const deepTimerRef   = useRef(null);

  useEffect(() => {
    return () => {
      if (searchTimerRef.current) clearInterval(searchTimerRef.current);
      if (deepTimerRef.current)   clearInterval(deepTimerRef.current);
    };
  }, []);

  // ── Phase 1 handler ─────────────────────────────────────────────────────────
  const handleSearch = useCallback(async () => {
    setSearchLoading(true);
    setSearchError('');
    setSearchResult(null);
    setSearchElapsed(0);
    setView('discovery');

    if (searchTimerRef.current) clearInterval(searchTimerRef.current);
    searchTimerRef.current = setInterval(() => setSearchElapsed(e => e + 1), 1000);

    try {
      const res  = await fetch(`${API_BASE}/partner/search`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ sector, brief, region, industry }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setSearchResult(json.data);
      setSearchTab('cards');
    } catch (err) {
      setSearchError(err.message || 'Search failed');
    } finally {
      if (searchTimerRef.current) {
        clearInterval(searchTimerRef.current);
        searchTimerRef.current = null;
      }
      setSearchLoading(false);
    }
  }, [sector, brief, region, industry]);

  // ── Phase 2 handler ─────────────────────────────────────────────────────────
  const handleDeepEvaluate = useCallback(async (candidate) => {
    setSelectedCandidate(candidate);
    setDeepLoading(true);
    setDeepError('');
    setDeepResult(null);
    setDeepElapsed(0);
    setView('deep-dive');

    if (deepTimerRef.current) clearInterval(deepTimerRef.current);
    deepTimerRef.current = setInterval(() => setDeepElapsed(e => e + 1), 1000);

    try {
      const res  = await fetch(`${API_BASE}/partner/deep-evaluate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          sector_key:            sector,
          company_name_cn:       candidate.company_name_cn ?? '',
          company_name_en:       candidate.company_name_en ?? '',
          preset_dimensions:     candidate.dimensions      ?? {},
          preset_weighted_score: candidate.weighted_score  ?? 0,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) throw new Error(json.error || `HTTP ${res.status}`);
      setDeepResult(json.data);
    } catch (err) {
      setDeepError(err.message || 'Deep evaluation failed');
    } finally {
      if (deepTimerRef.current) {
        clearInterval(deepTimerRef.current);
        deepTimerRef.current = null;
      }
      setDeepLoading(false);
    }
  }, [sector]);

  const candidates          = searchResult?.candidates            ?? [];
  const sources             = searchResult?.authoritative_sources ?? [];
  const summaryData         = searchResult?.summary               ?? null;
  const comparisonChart     = searchResult?.comparison_chart      ?? null;
  const industryInsight     = searchResult?.industry_insight      ?? null;
  const recommendationModel = searchResult?.recommendation_model  ?? null;
  const nextSteps           = searchResult?.next_steps            ?? null;

  const isWorking = searchLoading || deepLoading;

  return (
    <section className="panel">
      {/* ── Hero ── */}
      <div className="panel-hero">
        <div>
          <div className="panel-kicker">Partner Intelligence</div>
          <h1>Discover · Score · Deep Evaluate</h1>
          <p>
            Find Chinese partner candidates, score them across key dimensions,
            and deep-dive any company with registry data, web research, and news — one workflow, one consistent score.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexShrink: 0 }}>
          {view !== 'setup' && !isWorking && (
            <button
              type="button"
              onClick={() => {
                setView('setup');
                setSearchResult(null);
                setDeepResult(null);
                setSelectedCandidate(null);
                setRegion('');
                setIndustry('');
              }}
              style={{
                padding: '6px 14px', borderRadius: 6, fontSize: '0.78rem',
                fontWeight: 600, cursor: 'pointer',
                background: 'rgba(255,255,255,0.04)',
                color: '#a8b3c8', border: '1px solid rgba(255,255,255,0.1)',
              }}
            >
              ← New Search
            </button>
          )}
          <div className="header-status">
            <span className={`status-dot ${isWorking ? 'busy' : 'idle'}`} />
            {searchLoading ? 'Discovering…' : deepLoading ? 'Deep evaluating…' : 'Ready'}
          </div>
        </div>
      </div>

      {/* ════════════════ SETUP VIEW ════════════════ */}
      {view === 'setup' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Sector selector */}
          <div>
            <div style={{
              fontSize: '0.78rem', color: '#5a6474',
              fontWeight: 600, marginBottom: 10,
            }}>
              1 — Select Sector
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {Object.entries(SECTORS).map(([key, cfg]) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSector(key)}
                  style={{
                    padding: '14px 16px', borderRadius: 10,
                    cursor: 'pointer', textAlign: 'left', border: 'none',
                    background: sector === key
                      ? 'rgba(194,138,61,0.12)' : 'rgba(255,255,255,0.03)',
                    outline: sector === key
                      ? '2px solid rgba(194,138,61,0.5)'
                      : '1px solid rgba(255,255,255,0.08)',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{ fontSize: '1.2rem', marginBottom: 6 }}>{cfg.icon}</div>
                  <div style={{
                    fontWeight: 700, fontSize: '0.88rem',
                    color: sector === key ? '#c28a3d' : '#a8b3c8',
                    marginBottom: 4,
                  }}>
                    {cfg.label}
                  </div>
                  <div style={{ fontSize: '0.75rem', color: '#5a6474', lineHeight: 1.5 }}>
                    {cfg.tagline}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Region + Industry filters */}
          <div>
            <div style={{
              fontSize: '0.78rem', color: '#5a6474', fontWeight: 600, marginBottom: 8,
            }}>
              2 — 精准筛选（可选）
              <span style={{ marginLeft: 8, color: '#3d4a5c', fontWeight: 400 }}>
                填写后将覆盖行业默认搜索范围，精准锁定目标企业
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              {/* Region */}
              <div>
                <div style={{ fontSize: '0.72rem', color: '#5a6474', marginBottom: 5 }}>
                  🌏 供应商所在地区
                </div>
                <input
                  type="text"
                  value={region}
                  onChange={e => setRegion(e.target.value)}
                  placeholder="例：威海、广东、浙江义乌"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '10px 12px', borderRadius: 8,
                    background: region ? 'rgba(194,138,61,0.07)' : 'rgba(255,255,255,0.03)',
                    border: region ? '1px solid rgba(194,138,61,0.5)' : '1px solid rgba(255,255,255,0.1)',
                    color: '#e8dcc8', fontSize: '0.85rem',
                    outline: 'none', fontFamily: 'inherit',
                    transition: 'border 0.15s, background 0.15s',
                  }}
                />
              </div>
              {/* Industry */}
              <div>
                <div style={{ fontSize: '0.72rem', color: '#5a6474', marginBottom: 5 }}>
                  🏭 行业 / 品类
                </div>
                <input
                  type="text"
                  value={industry}
                  onChange={e => setIndustry(e.target.value)}
                  placeholder="例：渔具、纺织品、医疗器械"
                  style={{
                    width: '100%', boxSizing: 'border-box',
                    padding: '10px 12px', borderRadius: 8,
                    background: industry ? 'rgba(194,138,61,0.07)' : 'rgba(255,255,255,0.03)',
                    border: industry ? '1px solid rgba(194,138,61,0.5)' : '1px solid rgba(255,255,255,0.1)',
                    color: '#e8dcc8', fontSize: '0.85rem',
                    outline: 'none', fontFamily: 'inherit',
                    transition: 'border 0.15s, background 0.15s',
                  }}
                />
              </div>
            </div>
            {(region || industry) && (
              <div style={{
                marginTop: 8, padding: '7px 12px', borderRadius: 6,
                background: 'rgba(194,138,61,0.08)',
                border: '1px solid rgba(194,138,61,0.3)',
                fontSize: '0.75rem', color: '#c28a3d', lineHeight: 1.6,
              }}>
                ✓ 已启用精准筛选：将只搜索
                {industry ? <strong> {industry} </strong> : '指定行业'}
                企业
                {region ? <><span>（位于 </span><strong>{region}</strong><span> 地区）</span></> : ''}
                ，忽略默认行业范围
              </div>
            )}
          </div>

          {/* Brief input */}
          <div>
            <div style={{
              display: 'flex', justifyContent: 'space-between',
              fontSize: '0.78rem', color: '#5a6474', fontWeight: 600, marginBottom: 8,
            }}>
              <span>3 — 补充需求说明（可选）</span>
              <span style={{ color: '#3d4a5c', fontWeight: 400 }}>
                More detail = more targeted results
              </span>
            </div>
            <textarea
              value={brief}
              onChange={e => setBrief(e.target.value)}
              placeholder={SECTORS[sector].placeholder}
              rows={4}
              style={{
                width: '100%', boxSizing: 'border-box',
                padding: '12px 14px', borderRadius: 8,
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.1)',
                color: '#e8dcc8', fontSize: '0.85rem',
                lineHeight: 1.6, resize: 'vertical',
                outline: 'none', fontFamily: 'inherit',
              }}
            />
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
            onMouseEnter={e => { e.currentTarget.style.background = 'rgba(194,138,61,0.25)'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(194,138,61,0.15)'; }}
          >
            🔍 Discover Partners  ·  est. 60–120 sec
          </button>
        </div>
      )}

      {/* ════════════════ DISCOVERY VIEW ════════════════ */}
      {view === 'discovery' && (
        <div>
          {searchLoading && (
            <ProgressSteps
              steps={DISCOVERY_STEPS}
              elapsed={searchElapsed}
              thresholds={[0, 30, 80]}
              description="Searching and scoring candidates via authoritative web sources…"
            />
          )}

          {!searchLoading && searchError && (
            <div style={{
              padding: '12px 16px', borderRadius: 8, fontSize: '0.84rem',
              color: '#ff8d7d', background: 'rgba(255,141,125,0.08)',
              border: '1px solid rgba(255,141,125,0.25)',
            }}>
              ⚠ {searchError}
            </div>
          )}

          {!searchLoading && searchResult && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>

              {/* Result meta strip */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: '#e8dcc8' }}>
                  {searchResult.sector}
                </span>
                <span style={{
                  fontSize: '0.75rem', color: '#58a6a6', padding: '3px 10px',
                  borderRadius: 999, background: 'rgba(88,166,166,0.1)',
                  border: '1px solid rgba(88,166,166,0.25)',
                }}>
                  {candidates.length} companies
                </span>
                <span style={{ fontSize: '0.72rem', color: '#3d4a5c' }}>📅 {searchResult.search_date}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      const md = serializeDiscoveryMarkdown(searchResult, sector);
                      downloadFile(`partner-discovery-${slugify(searchResult.sector)}.md`, md, 'text/markdown;charset=utf-8');
                    }}
                  >Export MD</button>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => {
                      downloadFile(`partner-discovery-${slugify(searchResult.sector)}.json`, JSON.stringify(searchResult, null, 2), 'application/json;charset=utf-8');
                    }}
                  >Export JSON</button>
                </div>
              </div>

              {/* § 1 — Summary */}
              <SummarySection summary={summaryData} candidateCount={candidates.length} />

              {/* § 2 — Companies */}
              <div>
                <SectionHeading label="Companies" />
                {/* Tab bar */}
                <div style={{
                  display: 'flex', gap: 4, marginBottom: 16,
                  borderBottom: '1px solid rgba(255,255,255,0.07)',
                }}>
                  {[
                    { key: 'cards',  label: `All Companies (${candidates.length})` },
                    { key: 'matrix', label: 'Dimension Scores' },
                  ].map(t => (
                    <button key={t.key} type="button" onClick={() => setSearchTab(t.key)} style={{
                      padding: '7px 14px', fontSize: '0.8rem',
                      fontWeight: searchTab === t.key ? 700 : 400,
                      background: 'none', border: 'none', cursor: 'pointer',
                      color: searchTab === t.key ? '#c28a3d' : '#5a6474',
                      borderBottom: searchTab === t.key ? '2px solid #c28a3d' : '2px solid transparent',
                      marginBottom: -1,
                    }}>{t.label}</button>
                  ))}
                </div>
                {searchTab === 'cards' && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {candidates.map((c, i) => (
                      <CandidateCard key={i} candidate={c} sectorKey={sector}
                        rank={c.rank || i + 1} onDeepEvaluate={handleDeepEvaluate} />
                    ))}
                  </div>
                )}
                {searchTab === 'matrix' && <ComparisonMatrix candidates={candidates} sectorKey={sector} />}
              </div>

              {/* § 3 — Comparison chart */}
              {comparisonChart?.rows?.length > 0 && (
                <div>
                  <SectionHeading label="Comparison Chart" />
                  <ComparisonChartSection chart={comparisonChart} />
                </div>
              )}

              {/* § 4 — Industry insight */}
              {industryInsight?.market_overview && (
                <div>
                  <SectionHeading label="Saudi / Middle East Market Insight" />
                  <IndustryInsightSection insight={industryInsight} />
                </div>
              )}

              {/* § 5 + 6 — Recommendation model + Next steps */}
              {(recommendationModel?.top_pick || nextSteps) && (
                <div>
                  <SectionHeading label="Recommendation & Next Steps" />
                  <RecommendationSection model={recommendationModel} nextSteps={nextSteps} />
                </div>
              )}

              {/* Sources + analyst notes */}
              {(sources.length > 0 || searchResult.analyst_notes) && (
                <div>
                  <SectionHeading label="Sources" />
                  <SourcesList sources={sources} analystNotes={searchResult.analyst_notes} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ════════════════ DEEP DIVE VIEW ════════════════ */}
      {view === 'deep-dive' && (
        <div>
          {/* Selected company banner */}
          {selectedCandidate && (
            <div style={{
              padding: '9px 14px', borderRadius: 8, fontSize: '0.82rem',
              background: 'rgba(194,138,61,0.06)',
              border: '1px solid rgba(194,138,61,0.2)',
              color: '#c28a3d', display: 'flex', alignItems: 'center',
              gap: 10, marginBottom: 16, flexWrap: 'wrap',
            }}>
              <span>
                🔬 Deep evaluating:{' '}
                <strong>
                  {selectedCandidate.company_name_en || selectedCandidate.company_name_cn}
                </strong>
              </span>
              {selectedCandidate.weighted_score != null && (
                <span style={{ marginLeft: 'auto', color: '#8a96a8', fontSize: '0.75rem' }}>
                  Discovery Score:{' '}
                  <strong style={{ color: '#c28a3d' }}>
                    {selectedCandidate.weighted_score}
                  </strong>
                  /100
                </span>
              )}
            </div>
          )}

          {/* Loading */}
          {deepLoading && (
            <ProgressSteps
              steps={DEEP_STEPS}
              elapsed={deepElapsed}
              thresholds={[0, 20, 60, 100]}
              description="Running deep due-diligence: registry · web research · news analysis…"
            />
          )}

          {/* Error */}
          {!deepLoading && deepError && (
            <div>
              <div style={{
                padding: '12px 16px', borderRadius: 8, color: '#ff8d7d',
                background: 'rgba(255,141,125,0.08)',
                border: '1px solid rgba(255,141,125,0.25)', marginBottom: 12,
              }}>
                ⚠ {deepError}
              </div>
              <button
                type="button"
                onClick={() => setView('discovery')}
                style={{
                  padding: '6px 14px', borderRadius: 6, fontSize: '0.78rem',
                  background: 'rgba(255,255,255,0.04)',
                  color: '#a8b3c8', border: '1px solid rgba(255,255,255,0.1)',
                  cursor: 'pointer',
                }}
              >
                ← Back to Results
              </button>
            </div>
          )}

          {/* Deep dive report */}
          {!deepLoading && deepResult && (
            <DeepDiveReport
              report={deepResult}
              sectorKey={sector}
              selectedCandidate={selectedCandidate}
              onBack={() => setView('discovery')}
            />
          )}
        </div>
      )}
    </section>
  );
}
