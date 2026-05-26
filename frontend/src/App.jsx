import React, { useEffect, useMemo, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import ToolSelector from './components/ToolSelector';
import ContractPanel from './components/ContractPanel';
import NewsPanel from './components/NewsPanel';
import PartnerIntelPanel from './components/PartnerIntelPanel';

const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || 'http://127.0.0.1:5000/api';

const STORAGE_KEY = 'qg-legal-session-store-v1';

const ENTITY_TYPES = [
  'All / Unspecified',
  'Foreign Investor',
  'Joint Venture',
  'Wholly Foreign-Owned Enterprise',
  'Domestic Partner',
];

const REGIONS = [
  'All / Unspecified',
  'National',
  'Shanghai',
  'Beijing',
  'Guangdong',
  'Shenzhen',
];

const SESSION_LABELS = {
  mcp: 'Law Search',
  farui: 'Legal Consultation',
};

const DEFAULT_MCP_ANSWER =
  'Enter your legal question above. The assistant will retrieve relevant Chinese-law materials and return a structured answer in English.';

const DEFAULT_FARUI_ANSWER =
  'Use this page to submit investment and legal questions. Answers and supporting references will be shown here in English.';

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function createSession(type) {
  const now = new Date().toISOString();
  return {
    id: createId(type),
    type,
    title: type === 'mcp' ? 'New Search Conversation' : 'New Consultation',
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function ensureSessions(inputSessions, inputCurrentIds) {
  const sessions = Array.isArray(inputSessions) ? [...inputSessions] : [];
  const currentSessionIds = { ...(inputCurrentIds || {}) };

  ['mcp', 'farui'].forEach((type) => {
    const current = sessions.find((item) => item.id === currentSessionIds[type]);
    if (current) {
      return;
    }

    const latest = sessions
      .filter((item) => item.type === type)
      .sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt))[0];

    if (latest) {
      currentSessionIds[type] = latest.id;
      return;
    }

    const nextSession = createSession(type);
    sessions.unshift(nextSession);
    currentSessionIds[type] = nextSession.id;
  });

  return { sessions, currentSessionIds };
}

function initializeSessionStore() {
  if (typeof window === 'undefined') {
    return ensureSessions([], {});
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return ensureSessions([], {});
    }

    const parsed = JSON.parse(raw);
    return ensureSessions(parsed.sessions, parsed.currentSessionIds);
  } catch {
    return ensureSessions([], {});
  }
}

function getSessionById(sessions, sessionId) {
  return sessions.find((session) => session.id === sessionId) || null;
}

function getConversationHistory(session) {
  return (session?.messages || [])
    .filter((item) => item.role === 'user' || item.role === 'assistant')
    .map((item) => ({ role: item.role, content: item.content }));
}

function getLatestAssistantMessage(session) {
  const assistantMessages = (session?.messages || []).filter(
    (item) => item.role === 'assistant'
  );
  return assistantMessages[assistantMessages.length - 1] || null;
}

function deriveTitle(question, type) {
  const fallback = SESSION_LABELS[type] || 'Conversation';
  const trimmed = question.trim();
  if (!trimmed) {
    return fallback;
  }
  return trimmed.length > 72 ? `${trimmed.slice(0, 72)}...` : trimmed;
}

function appendExchangeToSession(sessions, sessionId, payload) {
  const now = new Date().toISOString();
  const { type, userMessage, assistantMessage, assistantMetadata } = payload;

  return sessions.map((session) => {
    if (session.id !== sessionId) {
      return session;
    }

    return {
      ...session,
      title:
        (session.messages || []).length > 0
          ? session.title
          : deriveTitle(userMessage, type),
      updatedAt: now,
      messages: [
        ...(session.messages || []),
        {
          id: createId('user'),
          role: 'user',
          content: userMessage,
          createdAt: now,
        },
        {
          id: createId('assistant'),
          role: 'assistant',
          content: assistantMessage,
          metadata: assistantMetadata || null,
          createdAt: now,
        },
      ],
    };
  });
}

function formatDate(value) {
  if (!value) {
    return '';
  }

  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function serializeConversationMarkdown(session) {
  const parts = [
    `# ${session.title}`,
    `Type: ${SESSION_LABELS[session.type] || session.type}`,
    `Created: ${formatDate(session.createdAt)}`,
    `Updated: ${formatDate(session.updatedAt)}`,
  ];

  (session.messages || []).forEach((message) => {
    parts.push(`## ${message.role === 'assistant' ? 'Assistant' : 'User'}`);
    parts.push(message.content || '');
  });

  return parts.join('\n\n');
}

class MarkdownErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidUpdate(prevProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <pre className="markdown-fallback" translate="no">
          {this.props.content}
        </pre>
      );
    }
    return this.props.children;
  }
}

function MarkdownBlock({ content }) {
  return (
    <MarkdownErrorBoundary resetKey={content} content={content}>
      <div className="answer-markdown notranslate" translate="no">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </MarkdownErrorBoundary>
  );
}

function StatusBadge({ loading, idleText, busyText }) {
  return (
    <div className={`header-status ${loading ? 'busy' : 'idle'}`}>
      <span className="status-dot" />
      {loading ? busyText : idleText}
    </div>
  );
}

function SidebarButton({ active, title, subtitle, onClick }) {
  return (
    <button
      type="button"
      className={`sidebar-button ${active ? 'active' : ''}`}
      onClick={onClick}
    >
      <span className="sidebar-button-title">{title}</span>
      <span className="sidebar-button-subtitle">{subtitle}</span>
    </button>
  );
}

function ToggleField({ checked, onChange, label, hint }) {
  return (
    <label className="toggle-field">
      <span className="toggle-copy">
        <span className="toggle-label">{label}</span>
        <span className="toggle-hint">{hint}</span>
      </span>
      <span className={`toggle-switch ${checked ? 'checked' : ''}`}>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
        />
        <span className="toggle-slider" />
      </span>
    </label>
  );
}

function InfoBanner({ children, tone = 'info' }) {
  return <div className={`info-banner ${tone}`}>{children}</div>;
}

function RelatedDocuments({ documents }) {
  if (!documents?.length) {
    return null;
  }

  return (
    <section className="documents-card">
      <div className="section-heading">
        <h2>Related Documents</h2>
        <span className="section-chip">{documents.length} items</span>
      </div>
      <div className="documents-grid">
        {documents.map((doc, index) => (
          <article
            className="document-item"
            key={`${doc.documentId || doc.title}-${index}`}
          >
            <div className="document-title">{doc.title}</div>
            <div className="document-meta">
              {doc.status ? <span>Status: {doc.status}</span> : null}
              {doc.sourceTool ? <span>Source: {doc.sourceTool}</span> : null}
            </div>
            {doc.snippets?.length ? (
              <ul className="document-snippets">
                {doc.snippets.map((snippet, snippetIndex) => (
                  <li key={snippetIndex}>{snippet}</li>
                ))}
              </ul>
            ) : (
              <p className="document-empty">
                No excerpt available from this retrieval step.
              </p>
            )}
          </article>
        ))}
      </div>
    </section>
  );
}

function FaruiReferences({ references }) {
  const laws = references?.laws || [];
  const cases = references?.cases || [];
  const search = references?.search || [];

  if (!laws.length && !cases.length && !search.length) {
    return null;
  }

  return (
    <section className="documents-card">
      <div className="section-heading">
        <h2>Supporting References</h2>
        <span className="section-chip">References</span>
      </div>

      {laws.length ? (
        <div className="law-grid">
          {laws.map((law, index) => (
            <article
              className="law-card"
              key={`${law.lawId || law.lawTitle || law.lawName}-${index}`}
            >
              <div className="law-title">
                {law.lawTitle || law.lawName || 'Legal Reference'}
              </div>
              <div className="law-meta">
                {law.lawOrder ? <span>{law.lawOrder}</span> : null}
                {law.timeliness ? <span>{law.timeliness}</span> : null}
                {law.releaseDate ? <span>Released {law.releaseDate}</span> : null}
              </div>
              {law.sourceContent ? (
                <p className="law-content">{law.sourceContent}</p>
              ) : (
                <p className="document-empty">No statute excerpt was returned.</p>
              )}
            </article>
          ))}
        </div>
      ) : null}

      {cases.length ? (
        <div className="reference-group">
          <div className="reference-label">Related Cases</div>
          <div className="tag-row">
            {cases.map((item, index) => (
              <span className="reference-tag" key={`${item}-${index}`}>
                {item}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {search.length ? (
        <div className="reference-group">
          <div className="reference-label">Online Search References</div>
          <div className="search-list">
            {search.map((item, index) => (
              <div className="search-item" key={index}>
                {typeof item === 'string'
                  ? item
                  : item?.title || item?.content || JSON.stringify(item)}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function Clock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);
  const timeStr = now.toLocaleTimeString('en-GB', {
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const dateStr = now.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
  return (
    <div className="clock-widget">
      <span className="clock-time">{timeStr}</span>
      <span className="clock-date">{dateStr}</span>
    </div>
  );
}

const OFFICIAL_WEBSITES = [
  {
    category: 'Legislation',
    sites: [
      { name: 'National Laws & Regulations Database', desc: 'National laws & regs', url: 'https://flk.npc.gov.cn' },
      { name: 'National People\'s Congress', desc: 'National People\'s Congress', url: 'http://www.npc.gov.cn' },
      { name: 'State Council Portal', desc: 'State Council portal', url: 'https://www.gov.cn' },
    ],
  },
  {
    category: 'Judicial',
    sites: [
      { name: 'Supreme People\'s Court', desc: 'Supreme People\'s Court', url: 'https://www.court.gov.cn' },
      { name: 'China Judgments Online', desc: 'Judgments database', url: 'https://wenshu.court.gov.cn' },
      { name: 'Supreme People\'s Procuratorate', desc: 'Supreme Procuratorate', url: 'https://www.spp.gov.cn' },
    ],
  },
  {
    category: 'Administrative',
    sites: [
      { name: 'Ministry of Justice', desc: 'Ministry of Justice', url: 'https://www.moj.gov.cn' },
      { name: 'State Administration for Market Regulation', desc: 'Market supervision', url: 'https://www.samr.gov.cn' },
      { name: 'Ministry of Commerce', desc: 'Ministry of Commerce', url: 'https://www.mofcom.gov.cn' },
      { name: 'China National Intellectual Property Administration', desc: 'Patent & trademark', url: 'https://www.cnipa.gov.cn' },
      { name: 'General Administration of Customs', desc: 'General Customs', url: 'https://www.customs.gov.cn' },
      { name: 'State Taxation Administration', desc: 'State Taxation', url: 'https://www.chinatax.gov.cn' },
    ],
  },
  {
    category: 'Financial',
    sites: [
      { name: 'People\'s Bank of China', desc: "People's Bank of China", url: 'https://www.pbc.gov.cn' },
      { name: 'State Administration of Foreign Exchange', desc: 'FX administration', url: 'https://www.safe.gov.cn' },
      { name: 'China Securities Regulatory Commission', desc: 'Securities regulator', url: 'https://www.csrc.gov.cn' },
      { name: 'National Financial Regulatory Administration', desc: 'Financial regulator', url: 'https://www.nfra.gov.cn' },
    ],
  },
  {
    category: 'Investment',
    sites: [
      { name: 'National Development and Reform Commission', desc: 'NDRC', url: 'https://www.ndrc.gov.cn' },
      { name: 'China Association of Foreign Investment Enterprises', desc: 'CAEFI', url: 'https://www.caefi.org.cn' },
      { name: 'State-owned Assets Supervision and Administration Commission', desc: 'State Assets', url: 'https://www.sasac.gov.cn' },
    ],
  },
];

function App() {
  const [activeView, setActiveView] = useState('mcp');
  const [toolsGroupOpen, setToolsGroupOpen] = useState(true);
  const [intelligenceGroupOpen, setIntelligenceGroupOpen] = useState(true);
  const [websitesGroupOpen, setWebsitesGroupOpen] = useState(true);
  const [sessionStore, setSessionStore] = useState(() => initializeSessionStore());
  const [question, setQuestion] = useState('');
  const [entityType, setEntityType] = useState('All / Unspecified');
  const [region, setRegion] = useState('All / Unspecified');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [faruiQuestion, setFaruiQuestion] = useState('');
  const [faruiLoading, setFaruiLoading] = useState(false);
  const [faruiError, setFaruiError] = useState('');
  const [faruiDeepThink, setFaruiDeepThink] = useState(true);
  const [faruiOnlineSearch, setFaruiOnlineSearch] = useState(true);
  const [historySearch, setHistorySearch] = useState('');
  const [historyTypeFilter, setHistoryTypeFilter] = useState('all'); // 'all' | 'mcp' | 'farui'
  const [selectedTurnId, setSelectedTurnId] = useState(null);
  const [selectedTurnIds, setSelectedTurnIds] = useState([]);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionStore));
  }, [sessionStore]);

  useEffect(() => {
    // Build flat turns sorted by createdAt to auto-select most recent
    const turns = [];
    sessionStore.sessions.forEach((session) => {
      const msgs = session.messages || [];
      for (let i = 0; i + 1 < msgs.length; i += 2) {
        const u = msgs[i], a = msgs[i + 1];
        if (u?.role === 'user' && a?.role === 'assistant') {
          turns.push({ id: a.id, createdAt: u.createdAt || session.createdAt });
        }
      }
    });
    turns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    if (!turns.length) {
      setSelectedTurnId(null);
      return;
    }
    if (!selectedTurnId || !turns.some((t) => t.id === selectedTurnId)) {
      setSelectedTurnId(turns[0].id);
    }
  }, [selectedTurnId, sessionStore.sessions]);

  useEffect(() => {
    setSelectedTurnIds((prev) => {
      if (!prev.length) return prev;
      const validIds = new Set();
      sessionStore.sessions.forEach((session) =>
        (session.messages || []).forEach((m) => {
          if (m.role === 'assistant') validIds.add(m.id);
        })
      );
      return prev.filter((id) => validIds.has(id));
    });
  }, [sessionStore.sessions]);

  const currentMcpSession = useMemo(
    () => getSessionById(sessionStore.sessions, sessionStore.currentSessionIds.mcp),
    [sessionStore]
  );
  const currentFaruiSession = useMemo(
    () => getSessionById(sessionStore.sessions, sessionStore.currentSessionIds.farui),
    [sessionStore]
  );
  const currentMcpAssistantMessage = useMemo(
    () => getLatestAssistantMessage(currentMcpSession),
    [currentMcpSession]
  );
  const currentFaruiAssistantMessage = useMemo(
    () => getLatestAssistantMessage(currentFaruiSession),
    [currentFaruiSession]
  );
  const mcpHistory = useMemo(
    () => getConversationHistory(currentMcpSession),
    [currentMcpSession]
  );
  const faruiHistory = useMemo(
    () => getConversationHistory(currentFaruiSession),
    [currentFaruiSession]
  );
  const promptPreview = useMemo(() => {
    const parts = [];
    if (entityType !== 'All / Unspecified') {
      parts.push(`Entity type: ${entityType}`);
    }
    if (region !== 'All / Unspecified') {
      parts.push(`Region: ${region}`);
    }
    return parts.join(' | ');
  }, [entityType, region]);

  const lastAnswer = currentMcpAssistantMessage?.content || DEFAULT_MCP_ANSWER;
  const relatedDocuments =
    currentMcpAssistantMessage?.metadata?.relatedDocuments || [];

  const faruiAnswer = currentFaruiAssistantMessage?.content || DEFAULT_FARUI_ANSWER;
  const faruiReferences =
    currentFaruiAssistantMessage?.metadata?.references || {
      laws: [],
      cases: [],
      search: [],
    };
  const faruiUsage = currentFaruiAssistantMessage?.metadata?.usage || null;
  const faruiMeta = currentFaruiAssistantMessage?.metadata?.meta || null;
  const faruiReasoning = currentFaruiAssistantMessage?.metadata?.reasoning || '';
  const faruiWarnings = currentFaruiAssistantMessage?.metadata?.warnings || [];

  const flatTurns = useMemo(() => {
    const turns = [];
    sessionStore.sessions.forEach((session) => {
      const msgs = session.messages || [];
      for (let i = 0; i + 1 < msgs.length; i += 2) {
        const u = msgs[i], a = msgs[i + 1];
        if (u?.role === 'user' && a?.role === 'assistant') {
          turns.push({
            id: a.id,
            sessionId: session.id,
            sessionType: session.type,
            question: u.content || '',
            answer: a.content || '',
            answerMetadata: a.metadata || null,
            createdAt: u.createdAt || session.createdAt,
          });
        }
      }
    });
    return turns.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }, [sessionStore.sessions]);

  const filteredTurns = useMemo(() => {
    const query = historySearch.trim().toLowerCase();
    return flatTurns.filter((turn) => {
      if (historyTypeFilter !== 'all' && turn.sessionType !== historyTypeFilter) return false;
      if (!query) return true;
      return (
        turn.question.toLowerCase().includes(query) ||
        turn.answer.toLowerCase().includes(query)
      );
    });
  }, [historySearch, historyTypeFilter, flatTurns]);

  const selectedTurn = useMemo(
    () => flatTurns.find((t) => t.id === selectedTurnId) || null,
    [flatTurns, selectedTurnId]
  );
  const allFilteredSelected =
    filteredTurns.length > 0 &&
    filteredTurns.every((turn) => selectedTurnIds.includes(turn.id));

  function createFreshSession(type) {
    const nextSession = createSession(type);
    setSessionStore((prev) => ({
      sessions: [nextSession, ...prev.sessions],
      currentSessionIds: {
        ...prev.currentSessionIds,
        [type]: nextSession.id,
      },
    }));
    setError('');
    setFaruiError('');
    if (type === 'mcp') {
      setQuestion('');
      setActiveView('mcp');
    } else {
      setFaruiQuestion('');
      setActiveView('farui');
    }
  }

  function handleTurnExport(turn, format) {
    if (!turn) return;
    const shortQ = turn.question.slice(0, 50).replace(/[^\w\d-_]+/g, '_') || 'qa';
    if (format === 'markdown') {
      const lines = [
        `# ${turn.question}`,
        `Tool: ${SESSION_LABELS[turn.sessionType] || turn.sessionType}`,
        `Date: ${formatDate(turn.createdAt)}`,
        '',
        '## User Question',
        turn.question,
        '',
        '## AI Answer',
        turn.answer,
      ];
      downloadFile(`${shortQ}.md`, lines.join('\n\n'), 'text/markdown;charset=utf-8');
    } else {
      downloadFile(`${shortQ}.json`, JSON.stringify(turn, null, 2), 'application/json;charset=utf-8');
    }
  }

  function removeTurns(turnIds) {
    if (!turnIds.length) return;
    const idSet = new Set(turnIds);
    setSessionStore((prev) => {
      const updated = prev.sessions.map((session) => {
        const msgs = session.messages || [];
        const kept = [];
        for (let i = 0; i + 1 < msgs.length; i += 2) {
          const u = msgs[i], a = msgs[i + 1];
          if (u?.role === 'user' && a?.role === 'assistant' && idSet.has(a.id)) continue;
          kept.push(u, a);
        }
        if (msgs.length % 2 === 1) kept.push(msgs[msgs.length - 1]);
        return { ...session, messages: kept };
      });
      return ensureSessions(updated, prev.currentSessionIds);
    });
    setSelectedTurnIds((prev) => prev.filter((id) => !idSet.has(id)));
    if (selectedTurnId && idSet.has(selectedTurnId)) setSelectedTurnId(null);
  }

  function toggleTurnSelection(turnId) {
    setSelectedTurnIds((prev) =>
      prev.includes(turnId)
        ? prev.filter((id) => id !== turnId)
        : [...prev, turnId]
    );
  }

  function toggleSelectAllFiltered() {
    const visibleIds = filteredTurns.map((turn) => turn.id);
    const allVisibleSelected =
      visibleIds.length > 0 && visibleIds.every((id) => selectedTurnIds.includes(id));
    setSelectedTurnIds((prev) => {
      if (allVisibleSelected) return prev.filter((id) => !visibleIds.includes(id));
      const next = new Set(prev);
      visibleIds.forEach((id) => next.add(id));
      return [...next];
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion || loading || !currentMcpSession) {
      return;
    }

    setLoading(true);
    setError('');

    const enhancedQuestion = promptPreview
      ? `${trimmedQuestion}\n\nAdditional context: ${promptPreview}`
      : trimmedQuestion;

    try {
      const response = await fetch(`${API_BASE_URL}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: enhancedQuestion,
          history: mcpHistory,
        }),
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const fallbackText = data?.error || `Request failed: HTTP ${response.status}`;
        throw new Error(fallbackText);
      }

      const reply = data?.reply || 'No valid answer was returned.';

      setSessionStore((prev) => ({
        ...prev,
        sessions: appendExchangeToSession(prev.sessions, currentMcpSession.id, {
          type: 'mcp',
          userMessage: enhancedQuestion,
          assistantMessage: reply,
          assistantMetadata: {
            relatedDocuments: data?.relatedDocuments || [],
          },
        }),
      }));
      setQuestion('');
    } catch (err) {
      setError(err.message || 'The service is temporarily unavailable.');
    } finally {
      setLoading(false);
    }
  }

  async function handleFaruiSubmit(event) {
    event.preventDefault();
    const trimmedQuestion = faruiQuestion.trim();
    if (!trimmedQuestion || faruiLoading || !currentFaruiSession) {
      return;
    }

    // Limit input length to prevent API errors (Tongyi FaRui limit is 14000 characters)
    const MAX_INPUT_LENGTH = 13000;
    let safeMessage = trimmedQuestion;
    let safeHistory = faruiHistory;

    // If the question itself is too long, truncate it
    if (safeMessage.length > MAX_INPUT_LENGTH) {
      safeMessage = safeMessage.substring(0, MAX_INPUT_LENGTH);
    } else {
      // Calculate total length including history
      let totalLength = safeMessage.length;
      
      // Filter and limit history to fit within the limit
      const limitedHistory = [];
      for (let i = safeHistory.length - 1; i >= 0; i--) {
        const item = safeHistory[i];
        const itemLength = (item.content || '').length;
        if (totalLength + itemLength <= MAX_INPUT_LENGTH) {
          limitedHistory.unshift(item);
          totalLength += itemLength;
        } else {
          break;
        }
      }
      safeHistory = limitedHistory;
    }

    setFaruiLoading(true);
    setFaruiError('');

    try {
      const response = await fetch(`${API_BASE_URL}/farui/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          message: safeMessage,
          history: safeHistory,
          deepThink: faruiDeepThink,
          onlineSearch: faruiOnlineSearch,
        }),
      });

      let data = null;
      try {
        data = await response.json();
      } catch {
        data = null;
      }

      if (!response.ok) {
        const fallbackText = data?.error || `Request failed: HTTP ${response.status}`;
        throw new Error(fallbackText);
      }

      const reply = data?.reply || 'No valid answer was returned.';

      setSessionStore((prev) => ({
        ...prev,
        sessions: appendExchangeToSession(prev.sessions, currentFaruiSession.id, {
          type: 'farui',
          userMessage: trimmedQuestion,
          assistantMessage: reply,
          assistantMetadata: {
            references: data?.references || { laws: [], cases: [], search: [] },
            usage: data?.usage || null,
            meta: {
              mode: data?.mode || '',
              requestId: data?.requestId || '',
              status: data?.status || '',
            },
            reasoning: data?.reasoning || '',
            warnings: data?.warnings || [],
          },
        }),
      }));
      setFaruiQuestion('');
    } catch (err) {
      setFaruiError(err.message || 'Legal consultation service is temporarily unavailable.');
    } finally {
      setFaruiLoading(false);
    }
  }

  const currentLoading =
    activeView === 'mcp' ? loading : activeView === 'farui' ? faruiLoading : false;
  // partner-intel panel manages its own loading state internally

  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="brand-block">
          <div className="brand-eyebrow">QG Group Legal AI</div>
          <div className="brand-title">Legal Q&amp;A Workspace</div>
          <div className="brand-subtitle">
            Chinese law retrieval · Legal consultation · Contract review · Partner Intelligence
          </div>
        </div>
        <div className="header-right">
          <Clock />
          <StatusBadge
            loading={currentLoading}
            idleText="Ready"
            busyText="Working"
          />
        </div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          {/* Collapsible AI tools group */}
          <div className="sidebar-acc-group">
            <button
              type="button"
              className="sidebar-acc-toggle"
              onClick={() => setToolsGroupOpen((v) => !v)}
            >
              <span>Legal Consultation</span>
              <span className={`sidebar-chevron${toolsGroupOpen ? ' open' : ''}`}>›</span>
            </button>
            {toolsGroupOpen && (
              <div className="sidebar-acc-items">
                <SidebarButton
                  active={activeView === 'mcp'}
                  title="Law Search"
                  subtitle="Retrieve Chinese-law materials"
                  onClick={() => setActiveView('mcp')}
                />
                <SidebarButton
                  active={activeView === 'farui'}
                  title="Legal Consultation"
                  subtitle="AI-powered Q&amp;A and opinion"
                  onClick={() => setActiveView('farui')}
                />
                <SidebarButton
                  active={activeView === 'contract'}
                  title="Contract Review"
                  subtitle="Clause-by-clause risk analysis"
                  onClick={() => setActiveView('contract')}
                />
                <SidebarButton
                  active={activeView === 'history'}
                  title="Conversation History"
                  subtitle="Search and export saved records"
                  onClick={() => setActiveView('history')}
                />
              </div>
            )}
          </div>

          <div className="sidebar-divider" />

          {/* Collapsible Business Intelligence group */}
          <div className="sidebar-acc-group">
            <button
              type="button"
              className="sidebar-acc-toggle"
              onClick={() => setIntelligenceGroupOpen((v) => !v)}
            >
              <span>Business Intelligence</span>
              <span className={`sidebar-chevron${intelligenceGroupOpen ? ' open' : ''}`}>›</span>
            </button>
            {intelligenceGroupOpen && (
              <div className="sidebar-acc-items">
                <SidebarButton
                  active={activeView === 'partner-intel'}
                  title="Partner Intelligence"
                  subtitle="Discover · Deep-dive · Unified scoring"
                  onClick={() => setActiveView('partner-intel')}
                />
                <SidebarButton
                  active={activeView === 'news'}
                  title="Daily Tech News"
                  subtitle="Auto-fetched · AI-categorised by sector"
                  onClick={() => setActiveView('news')}
                />
              </div>
            )}
          </div>

          <div className="sidebar-divider" />

          {/* Collapsible Official Websites group */}
          <div className="sidebar-acc-group">
            <button
              type="button"
              className="sidebar-acc-toggle"
              onClick={() => setWebsitesGroupOpen((v) => !v)}
            >
              <span>Official Websites</span>
              <span className={`sidebar-chevron${websitesGroupOpen ? ' open' : ''}`}>›</span>
            </button>
            {websitesGroupOpen && (
              <div className="sidebar-acc-items">
                <SidebarButton
                  active={activeView === 'websites'}
                  title="Gov &amp; Judicial Portals"
                  subtitle="China regulatory &amp; court links"
                  onClick={() => setActiveView('websites')}
                />
              </div>
            )}
          </div>
        </aside>
        <main className="stage">
          {activeView === 'mcp' ? (
            <section className="panel">
              <div className="panel-hero">
                <div>
                  <div className="panel-kicker">Feature One</div>
                  <h1>Law Search</h1>
                  <p>
                    Ask legal questions and receive structured English answers
                    grounded in retrieved Chinese-law materials.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => createFreshSession('mcp')}
                  >
                    New Conversation
                  </button>
                </div>
              </div>

              <ToolSelector onModuleSelect={(moduleId) => {
                setQuestion(prev => `${prev}${prev ? ' ' : ''}[Focus: ${moduleId}]`);
              }} />

              <form className="qa-form" onSubmit={handleSubmit}>
                <label className="field-block">
                  <span className="field-label">Question</span>
                  <textarea
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    placeholder="Ask about foreign investment, joint ventures, market access, company governance, or other China-law issues"
                    rows={6}
                  />
                </label>

                <div className="field-grid">
                  <label className="field-block">
                    <span className="field-label">Entity Type</span>
                    <select
                      value={entityType}
                      onChange={(event) => setEntityType(event.target.value)}
                    >
                      {ENTITY_TYPES.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field-block">
                    <span className="field-label">Region</span>
                    <select
                      value={region}
                      onChange={(event) => setRegion(event.target.value)}
                    >
                      {REGIONS.map((item) => (
                        <option key={item} value={item}>
                          {item}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="action-row">
                  <button
                    className="primary-button"
                    type="submit"
                    disabled={loading || !question.trim()}
                  >
                    {loading ? 'Generating...' : 'Generate answer'}
                  </button>
                </div>
              </form>

              <section className="answer-card">
                <div className="section-heading">
                  <h2>Answer Summary</h2>
                  <span className="section-chip">English output</span>
                </div>

                <InfoBanner>
                  The answer is generated from retrieved evidence and constrained by
                  prompt and tool outputs. It is not legal advice.
                </InfoBanner>

                {error ? <InfoBanner tone="danger">{error}</InfoBanner> : null}

                <MarkdownBlock content={lastAnswer} />
              </section>

              <RelatedDocuments documents={relatedDocuments} />
            </section>
          ) : null}

          {activeView === 'farui' ? (
            <section className="panel">
              <div className="panel-hero">
                <div>
                  <div className="panel-kicker">Feature Two</div>
                  <h1>Legal Consultation</h1>
                  <p>
                    Submit investment and legal questions for AI-powered analysis,
                    with supporting references and detailed opinions.
                  </p>
                </div>
                <div className="hero-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => createFreshSession('farui')}
                  >
                    New Conversation
                  </button>
                </div>
              </div>

              <form className="qa-form" onSubmit={handleFaruiSubmit}>
                <label className="field-block">
                  <span className="field-label">Question</span>
                  <textarea
                    value={faruiQuestion}
                    onChange={(event) => setFaruiQuestion(event.target.value)}
                    placeholder="Ask about Saudi investment, compliance, market entry, governance, contracts, or other legal issues"
                    rows={6}
                  />
                </label>

                <div className="toggle-grid">
                  <ToggleField
                    checked={faruiDeepThink}
                    onChange={setFaruiDeepThink}
                    label="Deep Thinking"
                    hint="Use a more thorough reasoning path"
                  />
                  <ToggleField
                    checked={faruiOnlineSearch}
                    onChange={setFaruiOnlineSearch}
                    label="Online Search"
                    hint="Allow web references when supported"
                  />
                </div>

                <div className="action-row left">
                  <button
                    className="primary-button warm"
                    type="submit"
                    disabled={faruiLoading || !faruiQuestion.trim()}
                  >
                    {faruiLoading ? 'Generating...' : 'Submit Question'}
                  </button>
                </div>
              </form>

              <section className="answer-card">
                <div className="section-heading">
                  <h2>Answer</h2>
                  <span className="section-chip">
                    {faruiMeta?.mode === 'farui_model_fallback'
                      ? 'Model fallback'
                      : 'Application API'}
                  </span>
                </div>

                <InfoBanner>
                  This feature provides legal information for reference only and
                  does not constitute formal legal advice.
                </InfoBanner>

                {faruiWarnings.map((warning, index) => (
                  <InfoBanner key={index} tone="warning">
                    {warning}
                  </InfoBanner>
                ))}

                {faruiError ? (
                  <InfoBanner tone="danger">{faruiError}</InfoBanner>
                ) : null}

                {faruiMeta ? (
                  <div className="meta-strip">
                    {faruiMeta.requestId ? (
                      <span className="meta-pill">Request ID: {faruiMeta.requestId}</span>
                    ) : null}
                    {faruiMeta.status ? (
                      <span className="meta-pill">Status: {faruiMeta.status}</span>
                    ) : null}
                    {faruiUsage?.totalTokens ? (
                      <span className="meta-pill">
                        Tokens: {faruiUsage.totalTokens}
                      </span>
                    ) : null}
                  </div>
                ) : null}

                <MarkdownBlock content={faruiAnswer} />
              </section>

              {faruiReasoning ? (
                <section className="answer-card subtle">
                  <div className="section-heading">
                    <h2>Reasoning Summary</h2>
                    <span className="section-chip">Deep Think</span>
                  </div>
                  <div className="reasoning-copy">{faruiReasoning}</div>
                </section>
              ) : null}

              <FaruiReferences references={faruiReferences} />
            </section>
          ) : null}

          {activeView === 'history' ? (
            <section className="panel">
              <div className="panel-hero">
                <div>
                  <div className="panel-kicker">Third Feature</div>
                  <h1>Conversation History</h1>
                  <p>
                    Each question and answer is saved as an individual record.
                    Search, filter by tool, or export any entry.
                  </p>
                </div>
                <div className="hero-chip">Saved locally</div>
              </div>

              <div className="history-layout">
                <section className="history-sidebar">
                  <div className="history-toolbar">
                    <input
                      className="history-search"
                      value={historySearch}
                      onChange={(event) => setHistorySearch(event.target.value)}
                      placeholder="Search questions &amp; answers…"
                    />
                    <div className="history-type-filter">
                      {[
                        { key: 'all',   label: 'All' },
                        { key: 'mcp',   label: 'Search' },
                        { key: 'farui', label: 'Consult' },
                      ].map(({ key, label }) => (
                        <button
                          key={key}
                          type="button"
                          className={`filter-pill${historyTypeFilter === key ? ' active' : ''}`}
                          onClick={() => setHistoryTypeFilter(key)}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="history-bulk-actions">
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={toggleSelectAllFiltered}
                      disabled={!filteredTurns.length}
                    >
                      {allFilteredSelected ? 'Unselect All' : 'Select All'}
                    </button>
                    <button
                      type="button"
                      className="danger-button"
                      onClick={() => removeTurns(selectedTurnIds)}
                      disabled={!selectedTurnIds.length}
                    >
                      Delete ({selectedTurnIds.length})
                    </button>
                  </div>

                  <div className="history-list">
                    {filteredTurns.length ? (
                      filteredTurns.map((turn) => (
                        <div
                          key={turn.id}
                          data-type={turn.sessionType}
                          className={`history-item${selectedTurnId === turn.id ? ' active' : ''}`}
                        >
                          <label
                            className="history-check"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              checked={selectedTurnIds.includes(turn.id)}
                              onChange={() => toggleTurnSelection(turn.id)}
                            />
                          </label>
                          <button
                            type="button"
                            className="history-item-main"
                            onClick={() => setSelectedTurnId(turn.id)}
                          >
                            <span className="history-item-title">
                              {turn.question.length > 72
                                ? `${turn.question.slice(0, 72)}…`
                                : turn.question}
                            </span>
                            <span className="history-item-meta">
                              <span className={`tool-badge tool-badge-${turn.sessionType}`}>
                                {turn.sessionType === 'mcp' ? 'Search' : 'Consult'}
                              </span>
                              {formatDate(turn.createdAt)}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="history-delete"
                            onClick={() => removeTurns([turn.id])}
                            aria-label="Delete this record"
                            title="Delete"
                          >
                            ×
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="history-empty">
                        No records match the current filter.
                      </div>
                    )}
                  </div>
                </section>

                <section className="history-detail">
                  {selectedTurn ? (
                    <>
                      <div className="history-detail-header">
                        <div className="history-detail-meta">
                          <span className={`tool-badge tool-badge-${selectedTurn.sessionType}`}>
                            {selectedTurn.sessionType === 'mcp' ? 'Search' : 'Consult'}
                          </span>
                          {SESSION_LABELS[selectedTurn.sessionType]}
                          {' · '}
                          {formatDate(selectedTurn.createdAt)}
                        </div>
                        <div className="history-export-row">
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleTurnExport(selectedTurn, 'markdown')}
                          >
                            Export MD
                          </button>
                          <button
                            type="button"
                            className="secondary-button"
                            onClick={() => handleTurnExport(selectedTurn, 'json')}
                          >
                            Export JSON
                          </button>
                        </div>
                      </div>

                      <div className="transcript">
                        <article className="transcript-message user">
                          <div className="transcript-role">User Question</div>
                          <div className="transcript-content">
                            <MarkdownBlock content={selectedTurn.question} />
                          </div>
                        </article>
                        <article className="transcript-message assistant">
                          <div className="transcript-role">AI Answer</div>
                          <div className="transcript-content">
                            <MarkdownBlock content={selectedTurn.answer} />
                          </div>
                        </article>
                      </div>
                    </>
                  ) : (
                    <div className="history-empty large">
                      Select a record on the left to view it here.
                    </div>
                  )}
                </section>
              </div>
            </section>
          ) : null}

          <div
            style={{ display: activeView === 'contract' ? 'block' : 'none' }}
            aria-hidden={activeView !== 'contract'}
          >
            <ContractPanel />
          </div>

          <div
            style={{ display: activeView === 'partner-intel' ? 'block' : 'none' }}
            aria-hidden={activeView !== 'partner-intel'}
          >
            <PartnerIntelPanel />
          </div>

          <div
            style={{ display: activeView === 'news' ? 'block' : 'none' }}
            aria-hidden={activeView !== 'news'}
          >
            <NewsPanel />
          </div>

          {activeView === 'websites' ? (
            <section className="panel">
              <div className="panel-hero">
                <div>
                  <div className="panel-kicker">Reference</div>
                  <h1>Official Websites</h1>
                  <p>
                    Direct links to Chinese government, judicial, and regulatory
                    portals — organised by authority type.
                  </p>
                </div>
              </div>

              <div className="websites-grid">
                {OFFICIAL_WEBSITES.map((group) => (
                  <div key={group.category} className="websites-category">
                    <div className="websites-category-title">{group.category}</div>
                    <div className="websites-list">
                      {group.sites.map((site) => (
                        <a
                          key={site.url}
                          href={site.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="website-card"
                        >
                          <span className="website-name">{site.name}</span>
                          <span className="website-desc">{site.desc}</span>
                          <span className="website-domain">
                            {new URL(site.url).hostname}
                          </span>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          ) : null}
        </main>
      </div>
    </div>
  );
}

export default App;
