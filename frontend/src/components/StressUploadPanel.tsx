import React, { useState, useRef } from 'react';
import { UploadCloud, CheckCircle, AlertTriangle, Activity, HelpCircle } from 'lucide-react';

interface PredictionResult {
  prediction: string;
  confidence: number;
  breakdown: Record<string, number>;
  warning?: string;
}

interface StressUploadPanelProps {
  onPrediction?: (result: PredictionResult | null, previewUrl: string | null) => void;
}

export const StressUploadPanel: React.FC<StressUploadPanelProps> = ({ onPrediction }) => {
  const [expanded, setExpanded] = useState(true);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PredictionResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const selectedFile = e.target.files[0];
      setFile(selectedFile);
      const url = URL.createObjectURL(selectedFile);
      setPreviewUrl(url);
      setResult(null);
      setError(null);
      
      await predictImage(selectedFile, url);
    }
  };

  const predictImage = async (imageFile: File, imgUrl?: string) => {
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.append('file', imageFile);

    try {
      const response = await fetch('/api/predict-stress', {
        method: 'POST',
        body: formData,
      });

      if (!response.ok) {
        const detail = await response.json().catch(() => null);
        throw new Error(detail?.detail || `Error: ${response.statusText}`);
      }

      const data: PredictionResult = await response.json();
      setResult(data);
      const urlToUse = imgUrl || previewUrl;
      if (onPrediction) onPrediction(data, urlToUse);
    } catch (err: any) {
      setError(err.message || 'Failed to predict image');
    } finally {
      setLoading(false);
    }
  };

  const triggerUpload = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  const getColor = (pred: string) => {
    if (pred === 'healthy') return '#22c55e';
    if (pred === 'water_stress') return '#3b82f6';
    if (pred === 'heat_stress') return '#ef4444';
    if (pred === 'disease_stress') return '#f97316';
    if (pred === 'nutrients_stress') return '#eab308';
    if (pred === 'uncertain') return '#94a3b8';
    return '#94a3b8';
  };

  const getLabel = (pred: string) => {
    const labels: Record<string, string> = {
      'healthy': '✅ Healthy',
      'water_stress': '💧 Water Stress',
      'heat_stress': '🔥 Heat Stress',
      'disease_stress': '🦠 Disease Stress',
      'nutrients_stress': '🧪 Nutrients Stress',
      'uncertain': '❓ Uncertain',
    };
    return labels[pred] || pred.replace('_', ' ');
  };

  const getIcon = (pred: string) => {
    if (pred === 'healthy') return <CheckCircle size={16} color={getColor(pred)} />;
    if (pred === 'uncertain') return <HelpCircle size={16} color={getColor(pred)} />;
    return <AlertTriangle size={16} color={getColor(pred)} />;
  };

  // Sort breakdown by value descending
  const sortedBreakdown = result
    ? Object.entries(result.breakdown).sort(([, a], [, b]) => b - a)
    : [];

  return (
    <div className="card" style={{ marginTop: '0.5rem' }}>
      <div className="card-header card-header-clickable" onClick={() => setExpanded(!expanded)}>
        <span className="card-title">
          <Activity className="icon-sm" style={{ color: '#ec4899' }} /> ML Crop Stress Predictor
        </span>
      </div>
      
      {expanded && (
        <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          
          <input 
            type="file" 
            accept="image/*" 
            ref={fileInputRef} 
            style={{ display: 'none' }} 
            onChange={handleFileChange}
          />
          
          {!file && (
            <div 
              onClick={triggerUpload}
              style={{
                border: '1px dashed rgba(255,255,255,0.2)',
                borderRadius: '0.4rem',
                padding: '1rem',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                cursor: 'pointer',
                background: 'rgba(255,255,255,0.02)',
                transition: 'background 0.2s',
              }}
              onMouseEnter={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.05)'}
              onMouseLeave={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.02)'}
            >
              <UploadCloud size={24} color="#94a3b8" style={{ marginBottom: '0.5rem' }} />
              <span style={{ fontSize: '0.75rem', color: '#cbd5e1' }}>Upload leaf image to analyze</span>
              <span style={{ fontSize: '0.6rem', color: '#64748b', marginTop: '0.2rem' }}>Supports JPG, PNG, WEBP</span>
            </div>
          )}

          {previewUrl && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <img 
                src={previewUrl} 
                alt="Preview" 
                style={{ width: '60px', height: '60px', objectFit: 'cover', borderRadius: '0.3rem', border: '1px solid rgba(255,255,255,0.1)' }} 
              />
              <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', flex: 1 }}>
                <button 
                  onClick={triggerUpload}
                  style={{ 
                    background: 'rgba(255,255,255,0.1)', border: 'none', color: '#fff', 
                    padding: '0.25rem 0.5rem', borderRadius: '0.2rem', fontSize: '0.65rem',
                    cursor: 'pointer', width: 'fit-content', marginBottom: '0.3rem'
                  }}
                >
                  Change Photo
                </button>
                {loading && (
                  <span style={{ fontSize: '0.7rem', color: '#38bdf8', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{ 
                      display: 'inline-block', width: '8px', height: '8px', 
                      borderRadius: '50%', border: '2px solid #38bdf8', 
                      borderTopColor: 'transparent', animation: 'spin 0.8s linear infinite' 
                    }} />
                    Analyzing stress factors...
                  </span>
                )}
                {error && <span style={{ fontSize: '0.7rem', color: '#ef4444' }}>{error}</span>}
              </div>
            </div>
          )}

          {result && !loading && (
            <div style={{ 
              marginTop: '0.3rem', 
              padding: '0.6rem', 
              background: 'rgba(255,255,255,0.04)', 
              borderRadius: '0.4rem',
              borderLeft: `3px solid ${getColor(result.prediction)}`
            }}>
              {/* Main prediction */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.3rem' }}>
                {getIcon(result.prediction)}
                <span style={{ fontSize: '0.85rem', fontWeight: 600, color: '#f8fafc' }}>
                  {getLabel(result.prediction)}
                </span>
              </div>

              {/* Warning for uncertain */}
              {result.warning && (
                <div style={{ 
                  fontSize: '0.6rem', color: '#f59e0b', marginBottom: '0.4rem', 
                  padding: '0.3rem 0.4rem', background: 'rgba(245,158,11,0.1)', 
                  borderRadius: '0.2rem', lineHeight: 1.4 
                }}>
                  ⚠️ {result.warning}
                </div>
              )}
              
              {/* Confidence */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                <span style={{ fontSize: '0.65rem', color: '#94a3b8' }}>Confidence</span>
                <span style={{ fontSize: '0.75rem', fontWeight: 700, color: getColor(result.prediction), fontFamily: 'monospace' }}>
                  {(result.confidence * 100).toFixed(1)}%
                </span>
              </div>
              <div style={{ width: '100%', height: '4px', background: 'rgba(255,255,255,0.1)', borderRadius: '2px', overflow: 'hidden', marginBottom: '0.5rem' }}>
                <div style={{ width: `${result.confidence * 100}%`, height: '100%', background: getColor(result.prediction), transition: 'width 0.5s ease' }} />
              </div>

              {/* Full breakdown */}
              <div style={{ fontSize: '0.6rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.3rem', fontWeight: 700 }}>
                All Factors
              </div>
              {sortedBreakdown.map(([name, score]) => (
                <div key={name} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.25rem' }}>
                  <span style={{ fontSize: '0.62rem', color: '#94a3b8', width: '5.5rem', textTransform: 'capitalize', flexShrink: 0 }}>
                    {name.replace('_', ' ')}
                  </span>
                  <div style={{ flex: 1, height: '3px', background: 'rgba(255,255,255,0.08)', borderRadius: '2px', overflow: 'hidden' }}>
                    <div style={{ 
                      width: `${score * 100}%`, height: '100%', 
                      background: getColor(name), transition: 'width 0.5s ease' 
                    }} />
                  </div>
                  <span style={{ fontSize: '0.62rem', color: '#cbd5e1', fontFamily: 'monospace', width: '2.5rem', textAlign: 'right', flexShrink: 0 }}>
                    {(score * 100).toFixed(1)}%
                  </span>
                </div>
              ))}
            </div>
          )}

        </div>
      )}

      <style>{`
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
};
