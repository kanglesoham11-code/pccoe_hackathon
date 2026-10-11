import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  Plus, Mic, MicOff, Send, X, Camera, AlertTriangle,
  Shield, MessageSquare, BarChart3, HelpCircle, ArrowRight, Loader2,
  GitCompare, FlaskConical, CheckCircle2, XCircle, UploadCloud,
  MessagesSquare, Volume2, VolumeX, Globe
} from 'lucide-react';
import { WavRecorder } from '../utils/wavRecorder';

/* ── Types ──────────────────────────────────────────────────────────── */

interface PredictionResult {
  prediction: string;
  confidence: number;
  breakdown: Record<string, number>;
  warning?: string;
}

interface QuestionData {
  id: string;
  text: string;
  category: string;
  response_options: string[];
  cost: number;
}

interface Hypothesis {
  hypothesis: string;
  probability: number;
  description: string;
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
  evidence: any[];
  next_question: QuestionData | null;
  candidate_questions: any[];
  questions_used: number;
  question_budget: number;
  contradictions: string[];
  latest_contradiction?: string | null;
  diagnosis: string | null;
  confidence: number | null;
  strategy: string;
  expert_review_reason: string | null;
  advisory?: Advisory;
  diagnosis_description?: string;
}

interface CompareStrategyResult {
  diagnosis: string | null;
  confidence: number | null;
  questions_used: number;
  questions_asked: string[];
  status: string;
  contradictions: string[];
}

interface TestCaseResult {
  case_id: string;
  description: string;
  demonstrates: string;
  expected_diagnosis: string | null;
  information_gain: CompareStrategyResult;
  fixed_order: CompareStrategyResult;
  ig_correct: boolean;
  fixed_correct: boolean;
}

type ChatMessage =
  | { type: 'user-image'; imageUrl: string; context: string }
  | { type: 'loading' }
  | { type: 'prediction'; data: PredictionResult }
  | { type: 'question'; data: QuestionData; qNum: number; budget: number }
  | { type: 'user-answer'; question: string; answer: string }
  | { type: 'evidence-update'; hypotheses: Hypothesis[]; contradictions: string[] }
  | { type: 'diagnosis'; data: InvestigationResponse }
  | { type: 'advisory'; data: Advisory }
  | { type: 'expert-review'; reason: string }
  | { type: 'error'; message: string }
  | { type: 'system-text'; text: string }
  | { type: 'compare-result'; data: Record<string, CompareStrategyResult> }
  | { type: 'test-cases-result'; data: TestCaseResult[] }
  | { type: 'action-buttons' }
  | { type: 'post-diagnosis-options' }
  | { type: 'user-text'; text: string }
  | { type: 'ai-reply'; text: string; language: string };

/* ── Helpers ─────────────────────────────────────────────────────────── */

const COLORS: Record<string, string> = {
  bacterial_spot: '#EA580C', early_blight: '#9333EA', late_blight: '#DC2626',
  septoria_leaf_spot: '#CA8A04', nutrient_deficiency: '#0891B2', water_stress: '#2563EB',
  healthy: '#16803D', disease_stress: '#EA580C', nutrients_stress: '#0891B2',
};
const LABELS: Record<string, string> = {
  bacterial_spot: 'Bacterial Spot', early_blight: 'Early Blight', late_blight: 'Late Blight',
  septoria_leaf_spot: 'Septoria Leaf Spot', nutrient_deficiency: 'Nutrient Deficiency',
  water_stress: 'Water Stress', healthy: 'Healthy', disease_stress: 'Disease Stress',
  nutrients_stress: 'Nutrient Stress', uncertain: 'Uncertain',
};

const DEMO_LABELS: Record<string, { text: string; color: string }> = {
  ambiguous_symptom_resolved: { text: 'ambiguous symptom resolved', color: '#16803D' },
  contradictory_context: { text: 'contradictory context', color: '#EA580C' },
  unresolved_case: { text: 'unresolved case', color: '#CA8A04' },
  poor_quality_image: { text: 'poor quality image', color: '#9333EA' },
  useful_followup_answer: { text: 'useful follow-up answer', color: '#2563EB' },
};

function label(k: string) { return LABELS[k] || k.replace(/_/g, ' '); }
function color(k: string) { return COLORS[k] || '#647067'; }

/* ── TTS helper ──────────────────────────────────────────────────────── */
async function speak(text: string, lang: string = 'en') {
  // Use Sarvam AI TTS via backend for high-quality Indic voice
  try {
    const res = await fetch('/api/tts', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text.slice(0, 1500), language: lang }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data.audio_base64) {
        const audioBytes = Uint8Array.from(atob(data.audio_base64), c => c.charCodeAt(0));
        const blob = new Blob([audioBytes], { type: data.content_type || 'audio/wav' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);
        audio.onended = () => URL.revokeObjectURL(url);
        audio.play();
        return;
      }
    }
  } catch (err) {
    console.warn('Sarvam TTS failed, falling back to browser:', err);
  }
  // Fallback: browser speechSynthesis
  if ('speechSynthesis' in window) {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    const langMap: Record<string, string> = { en: 'en-IN', hi: 'hi-IN', mr: 'mr-IN' };
    utter.lang = langMap[lang] || 'en-IN';
    utter.rate = 0.95;
    window.speechSynthesis.speak(utter);
  }
}

/* ── Component ──────────────────────────────────────────────────────── */

export const CropInspectionPage: React.FC = () => {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [inputText, setInputText] = useState('');
  const [sending, setSending] = useState(false);
  const [recording, setRecording] = useState(false);

  // Investigation state
  const [investigationId, setInvestigationId] = useState<string | null>(null);
  const [currentQuestion, setCurrentQuestion] = useState<QuestionData | null>(null);
  const [qUsed, setQUsed] = useState(0);
  const [qBudget, setQBudget] = useState(6);
  const [predictionResult, setPredictionResult] = useState<PredictionResult | null>(null);
  const [concluded, setConcluded] = useState(false);
  const [compareRunning, setCompareRunning] = useState(false);
  const [testCasesRunning, setTestCasesRunning] = useState(false);

  // Post-diagnosis chat mode
  const [chatMode, setChatMode] = useState<'investigation' | 'free-chat'>('investigation');
  const [ttsEnabled, setTtsEnabled] = useState(true);
  const [selectedLang, setSelectedLang] = useState('en');

  // Audio recording via WavRecorder (16kHz mono WAV for Sarvam AI STT)
  const wavRecorderRef = useRef<WavRecorder | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-resize textarea
  const handleInputResize = useCallback(() => {
    if (textRef.current) {
      textRef.current.style.height = 'auto';
      textRef.current.style.height = Math.min(textRef.current.scrollHeight, 120) + 'px';
    }
  }, []);

  const push = (...msgs: ChatMessage[]) => setMessages(prev => [...prev, ...msgs]);
  const replaceLast = (msg: ChatMessage) => setMessages(prev => [...prev.slice(0, -1), msg]);

  /* ── File handling ──────────────────────────────────────────────── */
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.type.startsWith('image/')) { alert('Please select an image file.'); return; }
    if (f.size > 10 * 1024 * 1024) { alert('Image must be under 10 MB.'); return; }
    setFile(f);
    setPreviewUrl(URL.createObjectURL(f));
  };
  const clearFile = () => { setFile(null); setPreviewUrl(null); if (fileRef.current) fileRef.current.value = ''; };

  /* ── Send free chat query to Groq LLM with Sarvam Voice Response ── */
  const sendChatMessage = async (msgText: string, langToUse?: string) => {
    const text = msgText.trim();
    if (!text || sending) return;
    const lang = langToUse || selectedLang;
    setSending(true);
    setInputText('');

    push({ type: 'user-text', text });
    push({ type: 'loading' });

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: text,
          investigation_id: investigationId || '',
          language: lang,
        }),
      });
      if (!res.ok) throw new Error('Chat failed');
      const data = await res.json();
      const replyLang = data.language || lang;
      replaceLast({ type: 'ai-reply', text: data.reply, language: replyLang });

      // Speak response using Sarvam AI Bulbul v4 TTS
      if (ttsEnabled) {
        speak(data.reply, replyLang);
      }
    } catch (err: any) {
      replaceLast({ type: 'error', message: err.message });
    } finally {
      setSending(false);
    }
  };

  /* ── Multilingual voice recording (Sarvam AI Saaras v4 STT) ─────── */
  const toggleMic = async () => {
    if (recording) {
      // Stop recording
      setRecording(false);
      try {
        if (!wavRecorderRef.current) return;
        const wavBlob = await wavRecorderRef.current.stop();
        wavRecorderRef.current = null;

        if (wavBlob.size < 1500) {
          console.warn('Audio too short, skipping transcription');
          return;
        }

        // Show transcribing indicator
        setSending(true);
        push({ type: 'system-text', text: '🎙️ Transcribing your voice with Sarvam AI...' });

        // Send 16kHz WAV to backend
        const fd = new FormData();
        fd.append('file', wavBlob, 'recording.wav');
        fd.append('language', selectedLang);

        const res = await fetch('/api/transcribe', { method: 'POST', body: fd });
        // Remove transcribing message
        setMessages(prev => prev.filter(m => !(m.type === 'system-text' && 'text' in m && m.text.includes('Transcribing'))));

        if (res.ok) {
          const data = await res.json();
          const text = (data.text || '').trim();
          if (text) {
            const detectedLang = (data.language && ['en', 'hi', 'mr'].includes(data.language)) ? data.language : selectedLang;
            setSelectedLang(detectedLang);

            // If an image is waiting in preview, append to input context
            if (file) {
              setInputText(prev => prev + (prev ? ' ' : '') + text);
              handleInputResize();
            } else {
              // Otherwise, directly send as chat question with Sarvam AI voice answer!
              await sendChatMessage(text, detectedLang);
            }
          } else {
            push({ type: 'system-text', text: '⚠️ No speech detected. Please speak clearly in English, Hindi, or Marathi.' });
          }
        } else {
          const errData = await res.json().catch(() => ({}));
          console.error('Transcription error:', errData);
          push({ type: 'system-text', text: '⚠️ Voice transcription error. Please try typing your message.' });
        }
      } catch (err: any) {
        console.error('Transcription failed:', err);
        push({ type: 'system-text', text: '⚠️ Could not transcribe audio. Please try again.' });
      } finally {
        setSending(false);
      }
      return;
    }

    try {
      const recorder = new WavRecorder();
      await recorder.start();
      wavRecorderRef.current = recorder;
      setRecording(true);
    } catch (err: any) {
      console.error('Mic error:', err);
      alert('Microphone access denied or not available. Please allow microphone access in your browser settings.');
    }
  };

  /* ── Submit image + context OR chat message ──────────────────────── */
  const handleSubmit = async () => {
    // Case 1: An image is attached -> run ML prediction and diagnostic investigation
    if (file) {
      if (sending) return;
      setSending(true);
      setConcluded(false);

      const imgUrl = previewUrl!;
      const ctx = inputText.trim();
      push({ type: 'user-image', imageUrl: imgUrl, context: ctx });
      setInputText('');
      clearFile();
      push({ type: 'loading' });

      try {
        // Step 1: predict stress with ML model
        const fd = new FormData();
        fd.append('file', file);
        const predRes = await fetch('/api/predict-stress', { method: 'POST', body: fd });
        if (!predRes.ok) throw new Error(`Prediction failed: ${predRes.statusText}`);
        const pred: PredictionResult = await predRes.json();
        setPredictionResult(pred);
        replaceLast({ type: 'prediction', data: pred });

        // Step 2: start diagnostic investigation
        const invRes = await fetch('/api/investigation/start', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            image_analysis: pred,
            field_context: { crop: 'tomato', location: 'Maharashtra, India', season: 'Kharif', user_context: ctx },
            question_budget: 6,
            strategy: 'information_gain',
          }),
        });
        if (!invRes.ok) throw new Error(`Investigation start failed`);
        const inv: InvestigationResponse = await invRes.json();
        setInvestigationId(inv.investigation_id);
        setQUsed(inv.questions_used);
        setQBudget(inv.question_budget);

        push({ type: 'evidence-update', hypotheses: inv.sorted_hypotheses, contradictions: [] });

        if (inv.next_question) {
          setCurrentQuestion(inv.next_question);
          push({ type: 'question', data: inv.next_question, qNum: 1, budget: inv.question_budget });
        }
      } catch (err: any) {
        replaceLast({ type: 'error', message: err.message });
      } finally {
        setSending(false);
      }
      return;
    }

    // Case 2: No image, but text is typed -> send as free chat question
    if (inputText.trim()) {
      await sendChatMessage(inputText.trim(), selectedLang);
      return;
    }
  };

  /* ── Answer a follow-up question ────────────────────────────────── */
  const handleAnswer = async (questionId: string, answerIndex: number, answerText: string) => {
    if (!investigationId || sending) return;
    setSending(true);
    setCurrentQuestion(null);

    push({ type: 'user-answer', question: currentQuestion?.text || '', answer: answerText });
    push({ type: 'loading' });

    try {
      const res = await fetch('/api/investigation/answer', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ investigation_id: investigationId, question_id: questionId, answer_index: answerIndex }),
      });
      if (!res.ok) throw new Error('Answer submission failed');
      const inv: InvestigationResponse = await res.json();
      setQUsed(inv.questions_used);

      replaceLast({ type: 'evidence-update', hypotheses: inv.sorted_hypotheses, contradictions: inv.contradictions });

      if (inv.latest_contradiction) {
        push({ type: 'system-text', text: `⚠️ Contradiction: ${inv.latest_contradiction}` });
      }

      if (inv.status === 'active' && inv.next_question) {
        setCurrentQuestion(inv.next_question);
        push({ type: 'question', data: inv.next_question, qNum: inv.questions_used + 1, budget: inv.question_budget });
      } else {
        await concludeInvestigation(inv);
      }
    } catch (err: any) {
      replaceLast({ type: 'error', message: err.message });
    } finally {
      setSending(false);
    }
  };

  /* ── Conclude ───────────────────────────────────────────────────── */
  const concludeInvestigation = async (latestInv?: InvestigationResponse) => {
    if (!investigationId || concluded) return;
    setSending(true);
    push({ type: 'loading' });

    try {
      const res = await fetch(`/api/investigation/conclude/${investigationId}`, { method: 'POST' });
      if (!res.ok) throw new Error('Conclude failed');
      const inv: InvestigationResponse = await res.json();
      setConcluded(true);
      setCurrentQuestion(null);

      replaceLast({ type: 'diagnosis', data: inv });
      if (inv.advisory) push({ type: 'advisory', data: inv.advisory });
      if (inv.status === 'expert_review') push({ type: 'expert-review', reason: inv.expert_review_reason || 'Expert review is recommended.' });
      push({ type: 'action-buttons' });
      push({ type: 'post-diagnosis-options' });
    } catch (err: any) {
      replaceLast({ type: 'error', message: err.message });
    } finally {
      setSending(false);
    }
  };

  const handleSkipAndConclude = () => {
    if (investigationId && !concluded) concludeInvestigation();
  };

  /* ── Run Strategy Comparison ─────────────────────────────────────── */
  const handleRunComparison = async () => {
    if (!predictionResult || compareRunning) return;
    setCompareRunning(true);
    push({ type: 'loading' });

    try {
      const defaultAnswers: Record<string, number> = {};
      const qIds = ['q_lesion_shape', 'q_lesion_color', 'q_mold_presence', 'q_spread_speed', 'q_fruit_symptoms',
        'q_recent_weather', 'q_watering', 'q_fertilization', 'q_affected_leaves', 'q_leaf_curl'];
      qIds.forEach(id => { defaultAnswers[id] = 0; });

      const res = await fetch('/api/investigation/compare', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_analysis: predictionResult,
          field_context: { crop: 'tomato', location: 'Maharashtra, India', season: 'Kharif' },
          simulated_answers: defaultAnswers,
          question_budget: 6,
        }),
      });
      if (!res.ok) throw new Error('Comparison failed');
      const data = await res.json();
      replaceLast({ type: 'compare-result', data });
      // Always provide the two options to the farmer: Upload Another Image OR Chat About Diagnosis!
      push({ type: 'post-diagnosis-options' });
    } catch (err: any) {
      replaceLast({ type: 'error', message: err.message });
    } finally {
      setCompareRunning(false);
    }
  };

  /* ── Run Test Cases ──────────────────────────────────────────────── */
  const handleRunTestCases = async () => {
    if (testCasesRunning) return;
    setTestCasesRunning(true);
    push({ type: 'loading' });

    try {
      const res = await fetch('/api/investigation/test-cases/run');
      if (!res.ok) throw new Error('Test cases failed');
      const data: TestCaseResult[] = await res.json();
      replaceLast({ type: 'test-cases-result', data });
      // After test cases, show post-diagnosis options
      push({ type: 'post-diagnosis-options' });
    } catch (err: any) {
      replaceLast({ type: 'error', message: err.message });
    } finally {
      setTestCasesRunning(false);
    }
  };

  /* ── Post-diagnosis option handlers ──────────────────────────────── */
  const handleNewInvestigation = () => {
    // Reset for next crop photo
    setConcluded(false);
    setInvestigationId(null);
    setCurrentQuestion(null);
    setPredictionResult(null);
    setQUsed(0);
    clearFile();
    push({ type: 'system-text', text: '📸 Ready for next crop image! Select or snap a photo of the leaf or plant below.' });
    setTimeout(() => fileRef.current?.click(), 250);
  };

  const handleStartFreeChat = () => {
    push({ type: 'system-text', text: '💬 Chat mode active! Ask any follow-up questions about the diagnosis, fungicides, fertilizer, or prevention tips in English, Hindi, or Marathi.' });
    setTimeout(() => textRef.current?.focus(), 250);
  };

  /* ── Key handling ───────────────────────────────────────────────── */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if ((file || inputText.trim()) && !sending) {
        handleSubmit();
      }
    }
  };

  /* ── Render messages ────────────────────────────────────────────── */
  const renderMessage = (msg: ChatMessage, i: number) => {
    switch (msg.type) {
      case 'user-image':
        return (
          <div className="cs-msg user" key={i}>
            <div className="cs-msg-bubble">
              <img src={msg.imageUrl} alt="Crop" className="cs-msg-image" />
              {msg.context && <div style={{ marginTop: '0.25rem' }}>{msg.context}</div>}
            </div>
            <div className="cs-msg-avatar user-av">👤</div>
          </div>
        );

      case 'loading':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div className="cs-msg-bubble"><div className="cs-loading-dots"><span /><span /><span /></div></div>
          </div>
        );

      case 'prediction':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div className="cs-prediction-card">
                <div className="cs-prediction-label">Preliminary Assessment</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem' }}>
                  <div className="cs-prediction-name" style={{ color: color(msg.data.prediction) }}>{label(msg.data.prediction)}</div>
                  <div className="cs-prediction-conf" style={{ color: color(msg.data.prediction) }}>{(msg.data.confidence * 100).toFixed(1)}%</div>
                </div>
                <div className="cs-bar-track">
                  <div className="cs-bar-fill" style={{ width: `${msg.data.confidence * 100}%`, background: color(msg.data.prediction) }} />
                </div>
                {msg.data.warning && (
                  <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'center', padding: '0.4rem 0.6rem', background: '#FEF9C3', border: '1px solid #FDE047', borderRadius: 6, marginTop: '0.5rem', fontSize: '0.8rem', color: '#92400E' }}>
                    <AlertTriangle size={14} /> {msg.data.warning}
                  </div>
                )}
                <div style={{ marginTop: '0.65rem' }}>
                  <div className="cs-prediction-label" style={{ marginBottom: '0.3rem' }}>All Factors</div>
                  {Object.entries(msg.data.breakdown).sort(([, a], [, b]) => b - a).map(([name, score]) => (
                    <div className="cs-breakdown-item" key={name}>
                      <span className="cs-breakdown-name">{label(name)}</span>
                      <div className="cs-bar-track" style={{ flex: 1 }}>
                        <div className="cs-bar-fill" style={{ width: `${score * 100}%`, background: color(name) }} />
                      </div>
                      <span className="cs-breakdown-val">{(score * 100).toFixed(1)}%</span>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ fontSize: '0.78rem', color: '#647067', marginTop: '0.5rem', lineHeight: 1.5 }}>
                I'll now ask a few follow-up questions to narrow down the diagnosis. Answer based on what you observe in the field.
              </div>
            </div>
          </div>
        );

      case 'question':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div className="cs-question-card">
                <div className="cs-question-header">
                  <MessageSquare size={14} /> Follow-up Question {msg.qNum} of {msg.budget}
                </div>
                <div className="cs-question-text">{msg.data.text}</div>
                <div className="cs-question-options">
                  {msg.data.response_options.map((opt, idx) => (
                    <button
                      key={idx}
                      className="cs-question-opt"
                      onClick={() => handleAnswer(msg.data.id, idx, opt)}
                      disabled={sending || currentQuestion?.id !== msg.data.id}
                    >
                      <ArrowRight size={13} style={{ opacity: 0.4, flexShrink: 0 }} /> {opt}
                    </button>
                  ))}
                </div>
                <div className="cs-question-budget">
                  <HelpCircle size={13} /> {msg.budget - msg.qNum + 1} questions remaining
                  {msg.qNum > 1 && !concluded && (
                    <button
                      onClick={handleSkipAndConclude}
                      style={{ marginLeft: 'auto', fontSize: '0.72rem', color: '#16803D', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', fontFamily: 'inherit' }}
                    >
                      Skip & get advisory
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );

      case 'user-answer':
        return (
          <div className="cs-msg user" key={i}>
            <div className="cs-msg-bubble">{msg.answer}</div>
            <div className="cs-msg-avatar user-av">👤</div>
          </div>
        );

      case 'evidence-update':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div className="cs-evidence-card">
                <div className="cs-evidence-title"><BarChart3 size={13} style={{ display: 'inline', verticalAlign: 'middle' }} /> Updated Probability Distribution</div>
                {msg.hypotheses.slice(0, 5).map(h => (
                  <div className="cs-posterior-row" key={h.hypothesis}>
                    <span className="cs-posterior-name" style={{ color: color(h.hypothesis) }}>{label(h.hypothesis)}</span>
                    <div className="cs-bar-track" style={{ flex: 1 }}>
                      <div className="cs-bar-fill" style={{ width: `${h.probability * 100}%`, background: color(h.hypothesis) }} />
                    </div>
                    <span className="cs-breakdown-val" style={{ color: h.probability > 0.3 ? color(h.hypothesis) : '#647067' }}>{(h.probability * 100).toFixed(1)}%</span>
                  </div>
                ))}
              </div>
              {msg.contradictions.length > 0 && msg.contradictions.map((c, ci) => (
                <div className="cs-contradiction" key={ci} style={{ marginTop: '0.5rem' }}>
                  <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} /> {c}
                </div>
              ))}
            </div>
          </div>
        );

      case 'diagnosis':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div className="cs-prediction-card" style={{ borderLeft: `4px solid ${color(msg.data.diagnosis || '')}` }}>
                <div className="cs-prediction-label">
                  {msg.data.status === 'resolved' ? '✅ Diagnosis' : msg.data.status === 'unresolved' ? '❓ Unresolved' : '⚠️ Expert Review Needed'}
                </div>
                {msg.data.diagnosis && (
                  <>
                    <div className="cs-prediction-name" style={{ color: color(msg.data.diagnosis), marginBottom: '0.25rem' }}>{label(msg.data.diagnosis)}</div>
                    {msg.data.diagnosis_description && <div style={{ fontSize: '0.82rem', color: '#647067', lineHeight: 1.5, marginBottom: '0.4rem' }}>{msg.data.diagnosis_description}</div>}
                    {msg.data.confidence != null && (
                      <div className="cs-prediction-conf" style={{ color: color(msg.data.diagnosis) }}>Confidence: {(msg.data.confidence * 100).toFixed(1)}%</div>
                    )}
                  </>
                )}
                <div style={{ fontSize: '0.78rem', color: '#647067', marginTop: '0.3rem' }}>
                  Based on {msg.data.questions_used} of {msg.data.question_budget} questions answered.
                </div>
              </div>
            </div>
          </div>
        );

      case 'advisory':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div className="cs-advisory-card">
                <h4><Shield size={16} /> Field Advisory</h4>
                <p>{msg.data.summary}</p>
                <p style={{ fontSize: '0.8rem', color: '#647067', fontStyle: 'italic' }}>{msg.data.confidence_assessment}</p>
                {msg.data.recommendations.length > 0 && (
                  <>
                    <div className="cs-evidence-title" style={{ marginTop: '0.5rem' }}>Recommendations</div>
                    <ul className="cs-rec-list">
                      {msg.data.recommendations.map((r, ri) => (
                        <li className="cs-rec-item" key={ri}><span className="cs-rec-num">{ri + 1}.</span> {r}</li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>
          </div>
        );

      case 'expert-review':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div className="cs-expert-card">
                <AlertTriangle size={20} className="icon" />
                <div>
                  <h4>Expert Review Recommended</h4>
                  <p>{msg.reason}</p>
                  <p style={{ marginTop: '0.4rem' }}>Please consult your local agricultural extension officer for a definitive diagnosis.</p>
                </div>
              </div>
            </div>
          </div>
        );

      case 'action-buttons':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
                <button className="cs-action-btn compare" onClick={handleRunComparison} disabled={compareRunning}>
                  <GitCompare size={16} />
                  {compareRunning ? 'Running...' : 'Run Strategy Comparison'}
                </button>
                <button className="cs-action-btn testcases" onClick={handleRunTestCases} disabled={testCasesRunning}>
                  <FlaskConical size={16} />
                  {testCasesRunning ? 'Running...' : 'Run All Test Cases'}
                </button>
              </div>
              <div style={{ fontSize: '0.72rem', color: '#647067', marginTop: '0.4rem', lineHeight: 1.5 }}>
                Compare the information-gain strategy against fixed question order, or run all labeled test cases to evaluate diagnostic performance.
              </div>
            </div>
          </div>
        );

      /* ── Strategy Comparison Result ──────────────────────────────── */
      case 'compare-result': {
        const ig = msg.data.information_gain;
        const fo = msg.data.fixed_order;
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div className="cs-evidence-card">
                <div className="cs-evidence-title"><GitCompare size={13} style={{ display: 'inline', verticalAlign: 'middle' }} /> Strategy Comparison</div>
                <div className="cs-strategy-card ig">
                  <div className="cs-strategy-header"><span className="cs-strategy-badge ig">🧠 Information Gain</span></div>
                  <div className="cs-strategy-stats">
                    <div className="cs-strategy-stat"><span className="cs-strategy-stat-label">Diagnosis</span><span className="cs-strategy-stat-value" style={{ color: color(ig.diagnosis || '') }}>{label(ig.diagnosis || 'None')}</span></div>
                    <div className="cs-strategy-stat"><span className="cs-strategy-stat-label">Confidence</span><span className="cs-strategy-stat-value">{ig.confidence != null ? (ig.confidence * 100).toFixed(1) + '%' : 'N/A'}</span></div>
                    <div className="cs-strategy-stat"><span className="cs-strategy-stat-label">Questions</span><span className="cs-strategy-stat-value">{ig.questions_used}</span></div>
                  </div>
                  <div className="cs-strategy-order">Order: {ig.questions_asked.map(q => q.replace('q_', '')).join(' → ')}</div>
                </div>
                <div className="cs-strategy-card fo">
                  <div className="cs-strategy-header"><span className="cs-strategy-badge fo">📋 Fixed Order</span></div>
                  <div className="cs-strategy-stats">
                    <div className="cs-strategy-stat"><span className="cs-strategy-stat-label">Diagnosis</span><span className="cs-strategy-stat-value" style={{ color: color(fo.diagnosis || '') }}>{label(fo.diagnosis || 'None')}</span></div>
                    <div className="cs-strategy-stat"><span className="cs-strategy-stat-label">Confidence</span><span className="cs-strategy-stat-value">{fo.confidence != null ? (fo.confidence * 100).toFixed(1) + '%' : 'N/A'}</span></div>
                    <div className="cs-strategy-stat"><span className="cs-strategy-stat-label">Questions</span><span className="cs-strategy-stat-value">{fo.questions_used}</span></div>
                  </div>
                  <div className="cs-strategy-order">Order: {fo.questions_asked.map(q => q.replace('q_', '')).join(' → ')}</div>
                </div>
              </div>
            </div>
          </div>
        );
      }

      /* ── Test Cases Result ───────────────────────────────────────── */
      case 'test-cases-result':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div className="cs-evidence-card">
                <div className="cs-evidence-title"><FlaskConical size={13} style={{ display: 'inline', verticalAlign: 'middle' }} /> Labeled Test Cases — Comparison Results</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem', marginTop: '0.4rem' }}>
                  {msg.data.map(tc => {
                    const demo = DEMO_LABELS[tc.demonstrates] || { text: tc.demonstrates, color: '#647067' };
                    return (
                      <div className="cs-testcase-card" key={tc.case_id}>
                        <div className="cs-tc-header">
                          <div className="cs-tc-title">{tc.case_id}</div>
                          <span className="cs-tc-badge" style={{ background: demo.color + '18', color: demo.color, borderColor: demo.color + '40' }}>{demo.text}</span>
                        </div>
                        <div className="cs-tc-desc">{tc.description}</div>
                        <div className="cs-tc-results">
                          <div className={`cs-tc-result ${tc.ig_correct ? 'correct' : 'incorrect'}`}>
                            <span className="cs-tc-strat">🧠 IG:</span>
                            {tc.ig_correct ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            <span>{label(tc.information_gain.diagnosis || 'None')}({tc.information_gain.questions_used}Q)</span>
                          </div>
                          <div className={`cs-tc-result ${tc.fixed_correct ? 'correct' : 'incorrect'}`}>
                            <span className="cs-tc-strat">📋 Fixed:</span>
                            {tc.fixed_correct ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                            <span>{label(tc.fixed_order.diagnosis || 'None')}({tc.fixed_order.questions_used}Q)</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="cs-tc-summary">
                  <div className="cs-tc-summary-item"><span>🧠 Information Gain</span><strong>{msg.data.filter(tc => tc.ig_correct).length}/{msg.data.length} correct</strong></div>
                  <div className="cs-tc-summary-item"><span>📋 Fixed Order</span><strong>{msg.data.filter(tc => tc.fixed_correct).length}/{msg.data.length} correct</strong></div>
                </div>
              </div>
            </div>
          </div>
        );

      /* ── Post-diagnosis option cards ──────────────────────────────── */
      case 'post-diagnosis-options':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div style={{ fontSize: '0.85rem', color: '#17251B', fontWeight: 600, marginBottom: '0.5rem' }}>What would you like to do next?</div>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                <button className="cs-post-option-btn upload" onClick={handleNewInvestigation}>
                  <UploadCloud size={20} />
                  <div>
                    <div className="cs-post-option-title">Upload New Image</div>
                    <div className="cs-post-option-desc">Analyze another crop image with the ML model</div>
                  </div>
                </button>
                <button className="cs-post-option-btn chat" onClick={handleStartFreeChat}>
                  <MessagesSquare size={20} />
                  <div>
                    <div className="cs-post-option-title">Chat About Diagnosis</div>
                    <div className="cs-post-option-desc">Ask follow-up questions in English, Hindi, or Marathi</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        );

      /* ── Free chat messages ──────────────────────────────────────── */
      case 'user-text':
        return (
          <div className="cs-msg user" key={i}>
            <div className="cs-msg-bubble">{msg.text}</div>
            <div className="cs-msg-avatar user-av">👤</div>
          </div>
        );

      case 'ai-reply':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div style={{ maxWidth: '90%' }}>
              <div className="cs-msg-bubble" style={{ fontSize: '0.88rem', lineHeight: 1.6, position: 'relative' }}>
                {msg.text}
                <button
                  className="cs-tts-btn"
                  onClick={() => speak(msg.text, msg.language)}
                  title="Read aloud"
                >
                  <Volume2 size={14} />
                </button>
              </div>
            </div>
          </div>
        );

      case 'system-text':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av">🌱</div>
            <div className="cs-msg-bubble" style={{ fontSize: '0.82rem' }}>{msg.text}</div>
          </div>
        );

      case 'error':
        return (
          <div className="cs-msg system" key={i}>
            <div className="cs-msg-avatar sys-av" style={{ background: '#FEF2F2', color: '#DC2626' }}>⚠️</div>
            <div className="cs-msg-bubble" style={{ background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B' }}>
              Error: {msg.message}. Please try again.
            </div>
          </div>
        );

      default: return null;
    }
  };

  /* ── Main render ────────────────────────────────────────────────── */
  const hasStarted = messages.length > 0;
  const canSend = !!file || inputText.trim().length > 0;

  return (
    <div className="cs-crop-page">
      {/* Chat area */}
      <div className="cs-chat-area">
        {!hasStarted && (
          <div className="cs-chat-empty">
            <div className="cs-chat-empty-icon"><Camera size={32} /></div>
            <h2>Inspect your crop</h2>
            <p>Upload a photo of your crop leaf or plant to receive an AI-powered assessment, or ask any crop health question freely using voice or text.</p>
            <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.85rem', justifyContent: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                className={`cs-lang-chip ${selectedLang === 'en' ? 'active' : ''}`}
                onClick={() => setSelectedLang('en')}
                style={{ cursor: 'pointer', border: selectedLang === 'en' ? '2px solid #2D6A4F' : '1px solid #D8E2DC', background: selectedLang === 'en' ? '#E8F5E9' : '#fff', fontWeight: selectedLang === 'en' ? 600 : 400, borderRadius: '20px', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                🇬🇧 English
              </button>
              <button
                type="button"
                className={`cs-lang-chip ${selectedLang === 'hi' ? 'active' : ''}`}
                onClick={() => setSelectedLang('hi')}
                style={{ cursor: 'pointer', border: selectedLang === 'hi' ? '2px solid #2D6A4F' : '1px solid #D8E2DC', background: selectedLang === 'hi' ? '#E8F5E9' : '#fff', fontWeight: selectedLang === 'hi' ? 600 : 400, borderRadius: '20px', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                🇮🇳 हिंदी
              </button>
              <button
                type="button"
                className={`cs-lang-chip ${selectedLang === 'mr' ? 'active' : ''}`}
                onClick={() => setSelectedLang('mr')}
                style={{ cursor: 'pointer', border: selectedLang === 'mr' ? '2px solid #2D6A4F' : '1px solid #D8E2DC', background: selectedLang === 'mr' ? '#E8F5E9' : '#fff', fontWeight: selectedLang === 'mr' ? 600 : 400, borderRadius: '20px', padding: '0.35rem 0.75rem', fontSize: '0.8rem' }}
              >
                🇮🇳 मराठी
              </button>
            </div>
          </div>
        )}
        {messages.map((msg, i) => renderMessage(msg, i))}
        <div ref={chatEndRef} />
      </div>

      {/* Composer */}
      <div className="cs-composer">
        {/* Image preview */}
        {previewUrl && (
          <div className="cs-composer-preview">
            <img src={previewUrl} alt="Preview" />
            <span style={{ fontSize: '0.82rem', color: '#647067', flex: 1 }}>{file?.name}</span>
            <button className="remove-btn" onClick={clearFile} title="Remove image"><X size={16} /></button>
          </div>
        )}

        {/* Multilingual Voice & Chat Toolbar */}
        <div className="cs-chat-mode-bar" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.35rem 0.75rem', background: '#F1F5F2', borderRadius: '8px', marginBottom: '0.45rem', fontSize: '0.78rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: '#2D6A4F', fontWeight: 600 }}>
            <Globe size={14} />
            <span>Voice & Chat:</span>
            <select
              className="cs-lang-mini-select"
              value={selectedLang}
              onChange={e => setSelectedLang(e.target.value)}
              style={{ padding: '0.2rem 0.45rem', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '0.78rem', background: '#fff', cursor: 'pointer' }}
            >
              <option value="en">🇬🇧 English</option>
              <option value="hi">🇮🇳 हिंदी (Hindi)</option>
              <option value="mr">🇮🇳 मराठी (Marathi)</option>
            </select>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button
              type="button"
              className="cs-tts-toggle"
              onClick={() => setTtsEnabled(!ttsEnabled)}
              title={ttsEnabled ? 'Sarvam AI voice enabled' : 'Sarvam AI voice muted'}
              style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', background: ttsEnabled ? '#DCFCE7' : '#F3F4F6', color: ttsEnabled ? '#15803D' : '#6B7280', border: '1px solid ' + (ttsEnabled ? '#86EFAC' : '#E5E7EB'), borderRadius: '6px', padding: '0.2rem 0.5rem', fontSize: '0.75rem', cursor: 'pointer' }}
            >
              {ttsEnabled ? <Volume2 size={13} /> : <VolumeX size={13} />}
              <span>{ttsEnabled ? 'Voice: ON' : 'Voice: Muted'}</span>
            </button>
          </div>
        </div>

        <div className="cs-composer-row">
          <input type="file" ref={fileRef} accept="image/jpeg,image/png,image/webp" style={{ display: 'none' }} onChange={handleFileSelect} />
          <button
            type="button"
            className="cs-composer-btn"
            onClick={() => fileRef.current?.click()}
            title="Attach crop leaf image"
            disabled={sending}
          >
            <Plus size={19} />
          </button>

          <textarea
            ref={textRef}
            className="cs-composer-input"
            placeholder={
              file
                ? 'Add symptom observations or field context for the image...'
                : 'Ask anything about crop disease, care, or farming advice (or click mic to speak)...'
            }
            value={inputText}
            onChange={e => { setInputText(e.target.value); handleInputResize(); }}
            onKeyDown={handleKeyDown}
            rows={1}
          />

          <button
            type="button"
            className={`cs-composer-btn ${recording ? 'recording' : ''}`}
            onClick={toggleMic}
            title={recording ? 'Stop recording (transcribe with Sarvam AI)' : 'Speak in English, Hindi, or Marathi (Sarvam AI)'}
          >
            {recording ? <MicOff size={18} /> : <Mic size={18} />}
          </button>

          <button
            type="button"
            className="cs-composer-btn send"
            onClick={handleSubmit}
            disabled={!canSend || sending}
            title="Send"
          >
            {sending ? <Loader2 size={18} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={18} />}
          </button>
        </div>
      </div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
};
