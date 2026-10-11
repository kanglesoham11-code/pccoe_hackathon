import React, { useState, useRef, useEffect } from 'react';
import {
  Search, ChevronDown, ChevronUp, Send, AlertTriangle, CheckCircle,
  XCircle, HelpCircle, BarChart3, MessageSquare, FileWarning, Shield,
  Zap, Clock, Eye, Beaker, ArrowRight, RotateCcw, Play
} from 'lucide-react';

/* ── Types ──────────────────────────────────────────────────────────── */

interface Hypothesis {
  hypothesis: string;
  probability: number;
  description: string;
}

interface CandidateQuestion {
  id: string;
  text: string;
  category: string;
  expected_information_gain: number;
  cost: number;
}

interface QuestionData {
  id: string;
  text: string;
  category: string;
  response_options: string[];
  cost: number;
}

interface EvidenceItem {
  question_id: string;
  question_text: string;
  answer: string;
  answer_index: number;
  timestamp: number;
  contradicts_image: boolean;
}

interface Advisory {
  summary: string;
  confidence_assessment: string;
  recommendations: string[];
  needs_expert_review: boolean;
  expert_review_reason: string | null;
}

interface InvestigationResponse {
  investigation_id: string;
  status: 'active' | 'resolved' | 'unresolved' | 'expert_review';
  posteriors: Record<string, number>;
  sorted_hypotheses: Hypothesis[];
  evidence: EvidenceItem[];
  next_question: QuestionData | null;
  candidate_questions: CandidateQuestion[];
  questions_used: number;
  question_budget: number;
  contradictions: string[];
  latest_contradiction?: string | null;
  diagnosis: string | null;
  confidence: number | null;
  strategy: string;
  expert_review_reason: string | null;
  advisory?: Advisory;
  investigation_trace?: any[];
  diagnosis_description?: string;
}

interface ComparisonResult {
  information_gain: {
    diagnosis: string;
    confidence: number;
    questions_used: number;
    questions_asked: string[];
    status: string;
  };
  fixed_order: {
    diagnosis: string;
    confidence: number;
    questions_used: number;
    questions_asked: string[];
    status: string;
  };
}

interface TestCaseResult {
  case_id: string;
  description: string;
  demonstrates: string;
  expected_diagnosis: string | null;
  information_gain: any;
  fixed_order: any;
  ig_correct: boolean;
  fixed_correct: boolean;
}

interface PredictionResult {
  prediction: string;
  confidence: number;
  breakdown: Record<string, number>;
  warning?: string;
}

/* ── Component Props ────────────────────────────────────────────────── */

interface DiagnosticInvestigationPanelProps {
  predictionResult: PredictionResult | null;
  previewUrl: string | null;
}

/* ── Helper Functions ───────────────────────────────────────────────── */

const getHypothesisColor = (h: string): string => {
  const colors: Record<string, string> = {
    bacterial_spot: '#f97316',
    early_blight: '#a855f7',
    late_blight: '#ef4444',
    septoria_leaf_spot: '#eab308',
    nutrient_deficiency: '#06b6d4',
    water_stress: '#3b82f6',
    healthy: '#22c55e',
  };
  return colors[h] || '#94a3b8';
};

const getHypothesisLabel = (h: string): string => {
  const labels: Record<string, string> = {
    bacterial_spot: 'Bacterial Spot',
    early_blight: 'Early Blight',
    late_blight: 'Late Blight',
    septoria_leaf_spot: 'Septoria Leaf Spot',
    nutrient_deficiency: 'Nutrient Deficiency',
    water_stress: 'Water Stress',
    healthy: 'Healthy',
  };
  return labels[h] || h.replace(/_/g, ' ');
};

const getHypothesisEmoji = (h: string): string => {
  const emojis: Record<string, string> = {
    bacterial_spot: '🦠',
    early_blight: '🍂',
    late_blight: '💀',
    septoria_leaf_spot: '🔴',
    nutrient_deficiency: '🧪',
    water_stress: '💧',
    healthy: '✅',
  };
  return emojis[h] || '❓';
};

const getCategoryIcon = (cat: string) => {
  switch (cat) {
    case 'visual': return <Eye size={12} />;
    case 'environmental': return <Beaker size={12} />;
    case 'management': return <Shield size={12} />;
    case 'temporal': return <Clock size={12} />;
    default: return <HelpCircle size={12} />;
  }
};

const getStatusColor = (status: string): string => {
  switch (status) {
    case 'active': return '#38bdf8';
    case 'resolved': return '#22c55e';
    case 'unresolved': return '#f59e0b';
    case 'expert_review': return '#ef4444';
    default: return '#94a3b8';
  }
};

const getStatusLabel = (status: string): string => {
  switch (status) {
    case 'active': return '🔬 Investigating';
    case 'resolved': return '✅ Resolved';
    case 'unresolved': return '❓ Unresolved';
    case 'expert_review': return '⚠️ Expert Review Needed';
    default: return status;
  }
};

/* ── Main Component ─────────────────────────────────────────────────── */

export const DiagnosticInvestigationPanel: React.FC<DiagnosticInvestigationPanelProps> = ({
  predictionResult,
  previewUrl,
}) => {
  const [expanded, setExpanded] = useState(true);
  const [activeTab, setActiveTab] = useState<'investigate' | 'compare' | 'cases'>('investigate');

  // Investigation state
  const [investigation, setInvestigation] = useState<InvestigationResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [concluding, setConcluding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [questionBudget, setQuestionBudget] = useState(6);
  const [strategy, setStrategy] = useState<string>('information_gain');

  // Field context
  const [fieldContext, setFieldContext] = useState({
    crop: 'tomato',
    location: 'Maharashtra, India',
    season: 'Kharif',
    growth_stage: 'fruiting',
  });

  // Show candidate questions panel
  const [showCandidates, setShowCandidates] = useState(false);

  // Comparison results
  const [comparisonResult, setComparisonResult] = useState<ComparisonResult | null>(null);
  const [comparingLoading, setComparingLoading] = useState(false);

  // Test case results
  const [testResults, setTestResults] = useState<TestCaseResult[] | null>(null);
  const [testLoading, setTestLoading] = useState(false);

  const traceRef = useRef<HTMLDivElement>(null);

  // Auto-scroll trace
  useEffect(() => {
    if (traceRef.current) {
      traceRef.current.scrollTop = traceRef.current.scrollHeight;
    }
  }, [investigation?.evidence]);

  /* ── API Calls ────────────────────────────────────────────────────── */

  const startInvestigation = async () => {
    if (!predictionResult) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/investigation/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_analysis: predictionResult,
          field_context: fieldContext,
          question_budget: questionBudget,
          strategy,
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
      const data: InvestigationResponse = await res.json();
      setInvestigation(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const submitAnswer = async (questionId: string, answerIndex: number) => {
    if (!investigation) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/investigation/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          investigation_id: investigation.investigation_id,
          question_id: questionId,
          answer_index: answerIndex,
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
      const data: InvestigationResponse = await res.json();
      setInvestigation(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const concludeInvestigation = async () => {
    if (!investigation) return;
    setConcluding(true);
    setError(null);
    try {
      const res = await fetch(`/api/investigation/conclude/${investigation.investigation_id}`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
      const data: InvestigationResponse = await res.json();
      setInvestigation(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setConcluding(false);
    }
  };

  const runTestCases = async () => {
    setTestLoading(true);
    try {
      const res = await fetch('/api/investigation/test-cases/run');
      if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
      const data: TestCaseResult[] = await res.json();
      setTestResults(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setTestLoading(false);
    }
  };

  const runComparison = async () => {
    if (!predictionResult) return;
    setComparingLoading(true);
    try {
      // Use first available answers as simulated
      const simulatedAnswers: Record<string, number> = {};
      if (investigation?.evidence) {
        investigation.evidence.forEach((ev) => {
          simulatedAnswers[ev.question_id] = ev.answer_index;
        });
      }
      const res = await fetch('/api/investigation/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_analysis: predictionResult,
          field_context: fieldContext,
          simulated_answers: simulatedAnswers,
          question_budget: questionBudget,
        }),
      });
      if (!res.ok) throw new Error(`Failed: ${res.statusText}`);
      const data: ComparisonResult = await res.json();
      setComparisonResult(data);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setComparingLoading(false);
    }
  };

  const resetInvestigation = () => {
    setInvestigation(null);
    setComparisonResult(null);
    setError(null);
  };

  /* ── Render Helpers ───────────────────────────────────────────────── */

  const renderPosteriorBars = (hypotheses: Hypothesis[]) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      {hypotheses.map((h) => (
        <div key={h.hypothesis} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <span style={{ fontSize: '0.6rem', width: '5.5rem', color: '#94a3b8', flexShrink: 0, display: 'flex', alignItems: 'center', gap: '0.2rem' }}>
            <span>{getHypothesisEmoji(h.hypothesis)}</span>
            <span style={{ textTransform: 'capitalize', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {getHypothesisLabel(h.hypothesis)}
            </span>
          </span>
          <div style={{ flex: 1, height: '5px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' }}>
            <div
              style={{
                width: `${h.probability * 100}%`,
                height: '100%',
                background: `linear-gradient(90deg, ${getHypothesisColor(h.hypothesis)}88, ${getHypothesisColor(h.hypothesis)})`,
                borderRadius: '3px',
                transition: 'width 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)',
              }}
            />
          </div>
          <span style={{
            fontSize: '0.62rem', fontFamily: 'monospace', color: h.probability > 0.4 ? getHypothesisColor(h.hypothesis) : '#64748b',
            width: '2.5rem', textAlign: 'right', flexShrink: 0, fontWeight: h.probability > 0.4 ? 700 : 400,
          }}>
            {(h.probability * 100).toFixed(1)}%
          </span>
        </div>
      ))}
    </div>
  );

  const renderQuestionCard = (q: QuestionData) => (
    <div style={{
      background: 'rgba(56, 189, 248, 0.05)',
      border: '1px solid rgba(56, 189, 248, 0.2)',
      borderRadius: '0.5rem',
      padding: '0.6rem',
      animation: 'fadeIn 0.4s ease',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', marginBottom: '0.4rem' }}>
        {getCategoryIcon(q.category)}
        <span style={{ fontSize: '0.6rem', color: '#38bdf8', textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 600 }}>
          {q.category}
        </span>
        <span style={{ fontSize: '0.55rem', color: '#475569', marginLeft: 'auto' }}>
          Cost: {q.cost}
        </span>
      </div>
      <p style={{ fontSize: '0.72rem', color: '#e2e8f0', marginBottom: '0.5rem', lineHeight: 1.5 }}>
        {q.text}
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
        {q.response_options.map((opt, idx) => (
          <button
            key={idx}
            onClick={() => submitAnswer(q.id, idx)}
            disabled={loading}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.35rem',
              padding: '0.35rem 0.5rem', fontSize: '0.65rem',
              background: 'rgba(255,255,255,0.04)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: '0.3rem', color: '#cbd5e1',
              cursor: loading ? 'not-allowed' : 'pointer',
              transition: 'all 0.2s',
              textAlign: 'left', width: '100%',
            }}
            onMouseEnter={(e) => {
              if (!loading) {
                e.currentTarget.style.background = 'rgba(56, 189, 248, 0.15)';
                e.currentTarget.style.borderColor = 'rgba(56, 189, 248, 0.4)';
                e.currentTarget.style.color = '#f8fafc';
              }
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'rgba(255,255,255,0.04)';
              e.currentTarget.style.borderColor = 'rgba(255,255,255,0.1)';
              e.currentTarget.style.color = '#cbd5e1';
            }}
          >
            <ArrowRight size={10} style={{ flexShrink: 0, opacity: 0.5 }} />
            {opt}
          </button>
        ))}
      </div>
    </div>
  );

  const renderEvidence = (evidence: EvidenceItem[]) => (
    <div ref={traceRef} style={{ maxHeight: '140px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem' }} className="custom-scrollbar">
      {evidence.map((ev, idx) => (
        <div key={idx} style={{
          padding: '0.35rem 0.45rem',
          background: ev.contradicts_image ? 'rgba(239, 68, 68, 0.08)' : 'rgba(255,255,255,0.03)',
          border: `1px solid ${ev.contradicts_image ? 'rgba(239, 68, 68, 0.25)' : 'rgba(255,255,255,0.06)'}`,
          borderRadius: '0.3rem',
          fontSize: '0.62rem',
        }}>
          <div style={{ color: '#94a3b8', marginBottom: '0.15rem', display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <MessageSquare size={10} />
            Q{idx + 1}: {ev.question_text}
          </div>
          <div style={{ color: '#e2e8f0', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
            <Send size={10} style={{ color: '#38bdf8' }} />
            {ev.answer}
            {ev.contradicts_image && (
              <span style={{ color: '#ef4444', fontSize: '0.55rem', fontWeight: 700, marginLeft: 'auto' }}>
                ⚠ CONTRADICTS IMAGE
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const renderContradictions = (contradictions: string[]) => {
    if (contradictions.length === 0) return null;
    return (
      <div style={{
        background: 'rgba(239, 68, 68, 0.08)',
        border: '1px solid rgba(239, 68, 68, 0.25)',
        borderRadius: '0.4rem',
        padding: '0.5rem',
      }}>
        <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#ef4444', marginBottom: '0.3rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
          <FileWarning size={13} /> Contradictions Detected
        </div>
        {contradictions.map((c, i) => (
          <div key={i} style={{ fontSize: '0.6rem', color: '#fca5a5', marginBottom: '0.15rem', paddingLeft: '0.5rem', borderLeft: '2px solid rgba(239, 68, 68, 0.3)' }}>
            {c}
          </div>
        ))}
      </div>
    );
  };

  const renderAdvisory = (advisory: Advisory) => (
    <div style={{
      background: 'rgba(16, 185, 129, 0.06)',
      border: '1px solid rgba(16, 185, 129, 0.2)',
      borderRadius: '0.5rem',
      padding: '0.6rem',
    }}>
      <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#34d399', marginBottom: '0.4rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
        <Shield size={14} /> Field Advisory (AI-Generated)
      </div>
      <p style={{ fontSize: '0.65rem', color: '#e2e8f0', lineHeight: 1.5, marginBottom: '0.4rem' }}>
        {advisory.summary}
      </p>
      <p style={{ fontSize: '0.6rem', color: '#94a3b8', lineHeight: 1.4, marginBottom: '0.5rem', fontStyle: 'italic' }}>
        {advisory.confidence_assessment}
      </p>
      <div style={{ fontSize: '0.6rem', color: '#10b981', fontWeight: 600, marginBottom: '0.25rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Recommendations
      </div>
      {advisory.recommendations.map((r, i) => (
        <div key={i} style={{
          fontSize: '0.62rem', color: '#cbd5e1', padding: '0.25rem 0.4rem',
          background: 'rgba(255,255,255,0.03)', borderRadius: '0.2rem',
          marginBottom: '0.2rem', display: 'flex', alignItems: 'flex-start', gap: '0.3rem',
        }}>
          <span style={{ color: '#10b981', fontWeight: 700 }}>{i + 1}.</span> {r}
        </div>
      ))}
      {advisory.needs_expert_review && (
        <div style={{
          marginTop: '0.4rem', padding: '0.35rem 0.5rem',
          background: 'rgba(245, 158, 11, 0.1)',
          border: '1px solid rgba(245, 158, 11, 0.3)',
          borderRadius: '0.3rem', fontSize: '0.6rem', color: '#fcd34d',
        }}>
          ⚠️ Expert Review Recommended: {advisory.expert_review_reason || 'Please consult a specialist.'}
        </div>
      )}
    </div>
  );

  /* ── Main Render ──────────────────────────────────────────────────── */

  return (
    <div className="card" style={{ marginTop: '0.5rem' }}>
      <div className="card-header card-header-clickable" onClick={() => setExpanded(!expanded)}>
        <span className="card-title">
          <Search className="icon-sm" style={{ color: '#a855f7' }} /> Diagnostic Investigation
        </span>
        {expanded ? <ChevronUp className="icon-xs" /> : <ChevronDown className="icon-xs" />}
      </div>

      {expanded && (
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>

          {/* Tab Selector */}
          <div style={{ display: 'flex', gap: '0.25rem' }}>
            {(['investigate', 'compare', 'cases'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                style={{
                  flex: 1, padding: '0.3rem', fontSize: '0.62rem', fontWeight: activeTab === tab ? 700 : 500,
                  background: activeTab === tab ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.04)',
                  border: `1px solid ${activeTab === tab ? 'rgba(168, 85, 247, 0.5)' : 'rgba(255,255,255,0.08)'}`,
                  borderRadius: '0.3rem', color: activeTab === tab ? '#c084fc' : '#64748b',
                  cursor: 'pointer', transition: 'all 0.2s',
                }}
              >
                {tab === 'investigate' && '🔬 Investigate'}
                {tab === 'compare' && '📊 Compare'}
                {tab === 'cases' && '🧪 Test Cases'}
              </button>
            ))}
          </div>

          {/* ── INVESTIGATE TAB ─────────────────────────────────────── */}
          {activeTab === 'investigate' && (
            <>
              {!predictionResult && (
                <div style={{ fontSize: '0.65rem', color: '#64748b', textAlign: 'center', padding: '0.8rem', fontStyle: 'italic' }}>
                  Upload a crop image above first to start a diagnostic investigation.
                </div>
              )}

              {predictionResult && !investigation && (
                <>
                  {/* Config */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.6rem', color: '#94a3b8', width: '5rem' }}>Strategy</span>
                      <select
                        value={strategy}
                        onChange={(e) => setStrategy(e.target.value)}
                        style={{
                          flex: 1, padding: '0.25rem 0.35rem', fontSize: '0.62rem',
                          background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                          borderRadius: '0.25rem', color: '#e2e8f0', outline: 'none',
                        }}
                      >
                        <option value="information_gain">🧠 Information Gain (Adaptive)</option>
                        <option value="fixed_order">📋 Fixed Order (Baseline)</option>
                      </select>
                    </div>
                    <div style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                      <span style={{ fontSize: '0.6rem', color: '#94a3b8', width: '5rem' }}>Budget</span>
                      <input
                        type="range" min={2} max={10} value={questionBudget}
                        onChange={(e) => setQuestionBudget(parseInt(e.target.value))}
                        style={{ flex: 1, accentColor: '#a855f7' }}
                      />
                      <span style={{ fontSize: '0.65rem', color: '#c084fc', fontWeight: 700, fontFamily: 'monospace', width: '1.5rem', textAlign: 'center' }}>
                        {questionBudget}
                      </span>
                    </div>
                  </div>
                  <button
                    onClick={startInvestigation}
                    disabled={loading}
                    style={{
                      padding: '0.45rem 0.7rem', fontSize: '0.7rem', fontWeight: 700,
                      background: 'linear-gradient(135deg, #a855f7, #7c3aed)',
                      border: 'none', borderRadius: '0.4rem', color: '#fff',
                      cursor: loading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.4rem',
                      boxShadow: '0 4px 12px rgba(168, 85, 247, 0.3)',
                      transition: 'all 0.2s',
                    }}
                  >
                    {loading ? (
                      <><span style={{ display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', border: '2px solid #fff', borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' }} /> Starting...</>
                    ) : (
                      <><Zap size={14} /> Start Diagnostic Investigation</>
                    )}
                  </button>
                </>
              )}

              {investigation && (
                <>
                  {/* Status Bar */}
                  <div style={{
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    padding: '0.35rem 0.5rem',
                    background: `${getStatusColor(investigation.status)}10`,
                    border: `1px solid ${getStatusColor(investigation.status)}30`,
                    borderRadius: '0.35rem',
                  }}>
                    <span style={{ fontSize: '0.65rem', fontWeight: 700, color: getStatusColor(investigation.status) }}>
                      {getStatusLabel(investigation.status)}
                    </span>
                    <span style={{ fontSize: '0.6rem', color: '#94a3b8', fontFamily: 'monospace' }}>
                      Q: {investigation.questions_used}/{investigation.question_budget} | {investigation.strategy === 'information_gain' ? '🧠 IG' : '📋 Fixed'}
                    </span>
                  </div>

                  {/* Posterior Distribution */}
                  <div>
                    <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                      <BarChart3 size={12} /> Stress Probability Distribution
                    </div>
                    {renderPosteriorBars(investigation.sorted_hypotheses)}
                  </div>

                  {/* Contradictions */}
                  {renderContradictions(investigation.contradictions)}

                  {/* Evidence Trail */}
                  {investigation.evidence.length > 0 && (
                    <div>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                        Evidence Trail ({investigation.evidence.length})
                      </div>
                      {renderEvidence(investigation.evidence)}
                    </div>
                  )}

                  {/* Next Question */}
                  {investigation.status === 'active' && investigation.next_question && (
                    <div>
                      <div style={{ fontSize: '0.6rem', fontWeight: 700, color: '#38bdf8', marginBottom: '0.3rem', textTransform: 'uppercase', letterSpacing: '0.05em', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                        <MessageSquare size={12} /> Follow-Up Question #{investigation.questions_used + 1}
                      </div>
                      {renderQuestionCard(investigation.next_question)}
                    </div>
                  )}

                  {/* Candidate Questions (toggle) */}
                  {investigation.status === 'active' && investigation.candidate_questions.length > 0 && (
                    <div>
                      <button
                        onClick={() => setShowCandidates(!showCandidates)}
                        style={{
                          fontSize: '0.6rem', color: '#64748b', background: 'none', border: 'none',
                          cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.25rem',
                          padding: '0.2rem 0',
                        }}
                      >
                        {showCandidates ? <ChevronUp size={10} /> : <ChevronDown size={10} />}
                        {showCandidates ? 'Hide' : 'Show'} Candidate Questions ({investigation.candidate_questions.length})
                      </button>
                      {showCandidates && (
                        <div style={{ maxHeight: '100px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.15rem', marginTop: '0.2rem' }} className="custom-scrollbar">
                          {investigation.candidate_questions.map((cq) => (
                            <div key={cq.id} style={{
                              display: 'flex', alignItems: 'center', gap: '0.3rem',
                              padding: '0.2rem 0.35rem', background: 'rgba(255,255,255,0.02)',
                              borderRadius: '0.2rem', fontSize: '0.58rem',
                            }}>
                              {getCategoryIcon(cq.category)}
                              <span style={{ flex: 1, color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {cq.text}
                              </span>
                              <span style={{ color: '#a855f7', fontFamily: 'monospace', fontWeight: 700, flexShrink: 0 }}>
                                EIG: {cq.expected_information_gain.toFixed(3)}
                              </span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Concluded State */}
                  {investigation.status !== 'active' && (
                    <>
                      {investigation.diagnosis && (
                        <div style={{
                          padding: '0.5rem', borderRadius: '0.4rem',
                          background: `${getHypothesisColor(investigation.diagnosis)}10`,
                          borderLeft: `3px solid ${getHypothesisColor(investigation.diagnosis)}`,
                        }}>
                          <div style={{ fontSize: '0.7rem', fontWeight: 700, color: '#e2e8f0', marginBottom: '0.2rem' }}>
                            {getHypothesisEmoji(investigation.diagnosis)} Diagnosis: {getHypothesisLabel(investigation.diagnosis)}
                          </div>
                          {investigation.diagnosis_description && (
                            <div style={{ fontSize: '0.6rem', color: '#94a3b8', lineHeight: 1.4 }}>
                              {investigation.diagnosis_description}
                            </div>
                          )}
                          {investigation.confidence !== null && (
                            <div style={{ fontSize: '0.65rem', color: getHypothesisColor(investigation.diagnosis), fontWeight: 700, marginTop: '0.2rem', fontFamily: 'monospace' }}>
                              Confidence: {(investigation.confidence * 100).toFixed(1)}%
                            </div>
                          )}
                        </div>
                      )}

                      {investigation.advisory && renderAdvisory(investigation.advisory)}

                      {investigation.expert_review_reason && investigation.status === 'expert_review' && (
                        <div style={{
                          padding: '0.45rem 0.5rem', background: 'rgba(239, 68, 68, 0.08)',
                          border: '1px solid rgba(239, 68, 68, 0.25)', borderRadius: '0.35rem',
                          fontSize: '0.62rem', color: '#fca5a5', display: 'flex', alignItems: 'flex-start', gap: '0.3rem',
                        }}>
                          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: '0.1rem' }} />
                          <span>{investigation.expert_review_reason}</span>
                        </div>
                      )}
                    </>
                  )}

                  {/* Action Buttons */}
                  <div style={{ display: 'flex', gap: '0.3rem' }}>
                    {investigation.status === 'active' && (
                      <button
                        onClick={concludeInvestigation}
                        disabled={concluding}
                        style={{
                          flex: 1, padding: '0.35rem', fontSize: '0.62rem', fontWeight: 600,
                          background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)',
                          borderRadius: '0.3rem', color: '#34d399', cursor: concluding ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem',
                        }}
                      >
                        {concluding ? 'Generating Advisory...' : <><CheckCircle size={12} /> Conclude & Get Advisory</>}
                      </button>
                    )}
                    {investigation.status !== 'active' && !investigation.advisory && (
                      <button
                        onClick={concludeInvestigation}
                        disabled={concluding}
                        style={{
                          flex: 1, padding: '0.35rem', fontSize: '0.62rem', fontWeight: 600,
                          background: 'rgba(56, 189, 248, 0.15)', border: '1px solid rgba(56, 189, 248, 0.3)',
                          borderRadius: '0.3rem', color: '#38bdf8', cursor: concluding ? 'not-allowed' : 'pointer',
                          display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.25rem',
                        }}
                      >
                        {concluding ? 'Generating...' : <><Shield size={12} /> Generate AI Advisory</>}
                      </button>
                    )}
                    <button
                      onClick={resetInvestigation}
                      style={{
                        padding: '0.35rem 0.5rem', fontSize: '0.62rem', fontWeight: 600,
                        background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                        borderRadius: '0.3rem', color: '#94a3b8', cursor: 'pointer',
                        display: 'flex', alignItems: 'center', gap: '0.25rem',
                      }}
                    >
                      <RotateCcw size={11} /> Reset
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {/* ── COMPARE TAB ─────────────────────────────────────────── */}
          {activeTab === 'compare' && (
            <>
              {!predictionResult && (
                <div style={{ fontSize: '0.65rem', color: '#64748b', textAlign: 'center', padding: '0.8rem', fontStyle: 'italic' }}>
                  Upload an image and complete an investigation first to compare strategies.
                </div>
              )}
              {predictionResult && (
                <>
                  <button
                    onClick={runComparison}
                    disabled={comparingLoading}
                    style={{
                      padding: '0.4rem 0.6rem', fontSize: '0.65rem', fontWeight: 600,
                      background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
                      border: 'none', borderRadius: '0.35rem', color: '#fff',
                      cursor: comparingLoading ? 'not-allowed' : 'pointer',
                      display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                    }}
                  >
                    {comparingLoading ? 'Running...' : <><BarChart3 size={13} /> Run Strategy Comparison</>}
                  </button>

                  {comparisonResult && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                      {(['information_gain', 'fixed_order'] as const).map((strat) => {
                        const r = comparisonResult[strat];
                        return (
                          <div key={strat} style={{
                            padding: '0.5rem', borderRadius: '0.4rem',
                            background: strat === 'information_gain' ? 'rgba(168, 85, 247, 0.06)' : 'rgba(255,255,255,0.03)',
                            border: `1px solid ${strat === 'information_gain' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(255,255,255,0.08)'}`,
                          }}>
                            <div style={{ fontSize: '0.65rem', fontWeight: 700, color: strat === 'information_gain' ? '#c084fc' : '#94a3b8', marginBottom: '0.3rem' }}>
                              {strat === 'information_gain' ? '🧠 Information Gain' : '📋 Fixed Order'}
                            </div>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.3rem', fontSize: '0.6rem' }}>
                              <div>
                                <div style={{ color: '#64748b' }}>Diagnosis</div>
                                <div style={{ color: '#e2e8f0', fontWeight: 600, fontSize: '0.62rem' }}>
                                  {r.diagnosis ? getHypothesisLabel(r.diagnosis) : 'N/A'}
                                </div>
                              </div>
                              <div>
                                <div style={{ color: '#64748b' }}>Confidence</div>
                                <div style={{ color: '#e2e8f0', fontWeight: 700, fontFamily: 'monospace' }}>
                                  {r.confidence ? `${(r.confidence * 100).toFixed(1)}%` : 'N/A'}
                                </div>
                              </div>
                              <div>
                                <div style={{ color: '#64748b' }}>Questions</div>
                                <div style={{ color: '#e2e8f0', fontWeight: 700, fontFamily: 'monospace' }}>
                                  {r.questions_used}
                                </div>
                              </div>
                            </div>
                            <div style={{ fontSize: '0.55rem', color: '#475569', marginTop: '0.2rem' }}>
                              Order: {r.questions_asked?.map((qid: string) => qid.replace('q_', '')).join(' → ')}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}
            </>
          )}

          {/* ── TEST CASES TAB ──────────────────────────────────────── */}
          {activeTab === 'cases' && (
            <>
              <button
                onClick={runTestCases}
                disabled={testLoading}
                style={{
                  padding: '0.4rem 0.6rem', fontSize: '0.65rem', fontWeight: 600,
                  background: 'linear-gradient(135deg, #f59e0b, #d97706)',
                  border: 'none', borderRadius: '0.35rem', color: '#fff',
                  cursor: testLoading ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.3rem',
                }}
              >
                {testLoading ? 'Running all cases...' : <><Play size={13} /> Run All Test Cases</>}
              </button>

              {testResults && (
                <div style={{ maxHeight: '250px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.3rem' }} className="custom-scrollbar">
                  {testResults.map((tc) => (
                    <div key={tc.case_id} style={{
                      padding: '0.45rem 0.5rem', borderRadius: '0.35rem',
                      background: 'rgba(255,255,255,0.03)',
                      border: '1px solid rgba(255,255,255,0.08)',
                    }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                        <span style={{ fontSize: '0.62rem', fontWeight: 700, color: '#e2e8f0' }}>
                          {tc.case_id}
                        </span>
                        <span style={{
                          fontSize: '0.55rem', padding: '0.1rem 0.3rem', borderRadius: '0.2rem',
                          background: tc.demonstrates === 'ambiguous_symptom_resolved' ? 'rgba(168, 85, 247, 0.15)' :
                            tc.demonstrates === 'contradictory_context' ? 'rgba(239, 68, 68, 0.15)' :
                              tc.demonstrates === 'unresolved_case' ? 'rgba(245, 158, 11, 0.15)' :
                                tc.demonstrates === 'poor_quality_image' ? 'rgba(100, 116, 139, 0.15)' : 'rgba(34, 197, 94, 0.15)',
                          color: tc.demonstrates === 'ambiguous_symptom_resolved' ? '#c084fc' :
                            tc.demonstrates === 'contradictory_context' ? '#fca5a5' :
                              tc.demonstrates === 'unresolved_case' ? '#fcd34d' :
                                tc.demonstrates === 'poor_quality_image' ? '#94a3b8' : '#86efac',
                        }}>
                          {tc.demonstrates.replace(/_/g, ' ')}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.58rem', color: '#94a3b8', marginBottom: '0.3rem' }}>
                        {tc.description}
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.25rem' }}>
                        <div style={{
                          padding: '0.2rem 0.3rem', borderRadius: '0.2rem', fontSize: '0.55rem',
                          background: tc.ig_correct ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          border: `1px solid ${tc.ig_correct ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                        }}>
                          <span style={{ fontWeight: 700, color: tc.ig_correct ? '#22c55e' : '#ef4444' }}>
                            🧠 IG: {tc.ig_correct ? '✓' : '✗'}
                          </span>
                          <span style={{ color: '#94a3b8', marginLeft: '0.3rem' }}>
                            {tc.information_gain.diagnosis ? getHypothesisLabel(tc.information_gain.diagnosis) : 'None'}
                            ({tc.information_gain.questions_used}Q)
                          </span>
                        </div>
                        <div style={{
                          padding: '0.2rem 0.3rem', borderRadius: '0.2rem', fontSize: '0.55rem',
                          background: tc.fixed_correct ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                          border: `1px solid ${tc.fixed_correct ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                        }}>
                          <span style={{ fontWeight: 700, color: tc.fixed_correct ? '#22c55e' : '#ef4444' }}>
                            📋 Fixed: {tc.fixed_correct ? '✓' : '✗'}
                          </span>
                          <span style={{ color: '#94a3b8', marginLeft: '0.3rem' }}>
                            {tc.fixed_order.diagnosis ? getHypothesisLabel(tc.fixed_order.diagnosis) : 'None'}
                            ({tc.fixed_order.questions_used}Q)
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Summary stats */}
                  <div style={{
                    padding: '0.5rem', borderRadius: '0.35rem',
                    background: 'rgba(168, 85, 247, 0.06)',
                    border: '1px solid rgba(168, 85, 247, 0.2)',
                    marginTop: '0.2rem',
                  }}>
                    <div style={{ fontSize: '0.65rem', fontWeight: 700, color: '#c084fc', marginBottom: '0.3rem' }}>
                      Summary
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem', fontSize: '0.6rem' }}>
                      <div>
                        <span style={{ color: '#94a3b8' }}>🧠 Info Gain Accuracy: </span>
                        <span style={{ color: '#e2e8f0', fontWeight: 700 }}>
                          {testResults.filter(t => t.ig_correct).length}/{testResults.length}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: '#94a3b8' }}>📋 Fixed Order Accuracy: </span>
                        <span style={{ color: '#e2e8f0', fontWeight: 700 }}>
                          {testResults.filter(t => t.fixed_correct).length}/{testResults.length}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <div style={{ fontSize: '0.6rem', color: '#ef4444', padding: '0.3rem 0.4rem', background: 'rgba(239,68,68,0.08)', borderRadius: '0.25rem' }}>
              ❌ {error}
            </div>
          )}
        </div>
      )}

      <style>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
