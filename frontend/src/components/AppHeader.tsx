import React, { useState, useRef, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  Sprout, Map, Camera, Info, Palette, CloudRain, Globe,
  ChevronDown, MapPin, Maximize, Droplets, Thermometer
} from 'lucide-react';
import type { GridMetadata } from '../types';

interface AppHeaderProps {
  metadata?: GridMetadata | null;
  satelliteLoaded?: boolean;
}

/* ── Dropdown hook ──────────────────────────────────────────────────── */
function useDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const timeout = useRef<ReturnType<typeof setTimeout>>();

  const enter = () => { clearTimeout(timeout.current); setOpen(true); };
  const leave = () => { timeout.current = setTimeout(() => setOpen(false), 200); };
  const toggle = () => setOpen(o => !o);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return { open, ref, enter, leave, toggle };
}

/* ── Sub-components ─────────────────────────────────────────────────── */

const FarmDropdown: React.FC<{ meta: GridMetadata | null | undefined }> = ({ meta }) => {
  const dd = useDropdown();
  const bbox = meta?.aoi_bbox_4326;
  const lat = bbox ? ((bbox[1] + bbox[3]) / 2).toFixed(5) : 'Not available';
  const lon = bbox ? ((bbox[0] + bbox[2]) / 2).toFixed(5) : 'Not available';
  const w = bbox ? Math.round((bbox[2] - bbox[0]) * 111320 * Math.cos(((bbox[1] + bbox[3]) / 2) * Math.PI / 180)) : null;
  const h = bbox ? Math.round((bbox[3] - bbox[1]) * 111320) : null;

  return (
    <div className="cs-dropdown-wrap" ref={dd.ref} onMouseEnter={dd.enter} onMouseLeave={dd.leave}>
      <button className={`cs-dropdown-trigger ${dd.open ? 'open' : ''}`} onClick={dd.toggle}>
        <Info size={15} /> Farm <ChevronDown size={13} />
      </button>
      {dd.open && (
        <div className="cs-dropdown-card">
          <div className="cs-dropdown-title">Farm Information</div>
          <div className="cs-info-row"><span className="cs-info-label"><MapPin size={14} /> Latitude</span><span className="cs-info-value">{lat}</span></div>
          <div className="cs-info-row"><span className="cs-info-label"><MapPin size={14} /> Longitude</span><span className="cs-info-value">{lon}</span></div>
          <div className="cs-info-row"><span className="cs-info-label"><Sprout size={14} /> Crop</span><span className="cs-info-value">Tomato</span></div>
          <div className="cs-info-row"><span className="cs-info-label"><Maximize size={14} /> Area</span><span className="cs-info-value">{w && h ? `${w} × ${h} m` : 'Not available'}</span></div>
          <div className="cs-info-row"><span className="cs-info-label"><Map size={14} /> Location</span><span className="cs-info-value">Maharashtra, India</span></div>
        </div>
      )}
    </div>
  );
};

const LegendDropdown: React.FC<{ meta: GridMetadata | null | undefined }> = ({ meta }) => {
  const dd = useDropdown();
  return (
    <div className="cs-dropdown-wrap" ref={dd.ref} onMouseEnter={dd.enter} onMouseLeave={dd.leave}>
      <button className={`cs-dropdown-trigger ${dd.open ? 'open' : ''}`} onClick={dd.toggle}>
        <Palette size={15} /> Legend <ChevronDown size={13} />
      </button>
      {dd.open && (
        <div className="cs-dropdown-card" style={{ minWidth: 320 }}>
          <div className="cs-dropdown-title">Map Legend</div>
          <div style={{ fontSize: '0.78rem', fontWeight: 600, color: '#17251B', marginBottom: '0.4rem' }}>NDVI — Vegetation Index</div>
          <div style={{ height: 8, borderRadius: 4, background: 'linear-gradient(to right, #8c510a, #d8b365, #f6e8c3, #a1d99b, #41ab5d, #005a32)', marginBottom: '0.3rem' }} />
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: '#647067' }}>
            <span>-0.2</span><span>0.0</span><span>0.2</span><span>0.4</span><span>0.6</span><span>0.8</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', marginTop: '0.6rem', fontSize: '0.78rem' }}>
            {[
              ['#8c5114', '< 0.1 — Bare soil / non-vegetated'],
              ['#e6d94d', '0.1–0.3 — Sparse / stressed'],
              ['#339926', '0.3–0.6 — Moderate vegetation'],
              ['#0d6b1a', '> 0.6 — Dense healthy vegetation'],
            ].map(([c, t]) => (
              <div key={t} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: c, flexShrink: 0 }} />
                <span style={{ color: '#17251B' }}>{t}</span>
              </div>
            ))}
          </div>
          {meta?.elevation_range_m && (
            <div style={{ marginTop: '0.6rem', paddingTop: '0.5rem', borderTop: '1px solid #DCE7DE', fontSize: '0.78rem', color: '#647067' }}>
              <strong style={{ color: '#17251B' }}>Elevation:</strong> {meta.elevation_range_m[0].toFixed(0)} – {meta.elevation_range_m[1].toFixed(0)} m
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const WeatherDropdown: React.FC<{ meta: GridMetadata | null | undefined }> = ({ meta }) => {
  const dd = useDropdown();
  const w = meta?.weather_summary;
  return (
    <div className="cs-dropdown-wrap" ref={dd.ref} onMouseEnter={dd.enter} onMouseLeave={dd.leave}>
      <button className={`cs-dropdown-trigger ${dd.open ? 'open' : ''}`} onClick={dd.toggle}>
        <CloudRain size={15} /> Weather <ChevronDown size={13} />
      </button>
      {dd.open && (
        <div className="cs-dropdown-card">
          <div className="cs-dropdown-title">Past 7 Days Weather</div>
          {w ? (
            <>
              <div className="cs-info-row"><span className="cs-info-label"><Droplets size={14} /> Precipitation</span><span className="cs-info-value">{w.past_7d_precip_mm} mm</span></div>
              <div className="cs-info-row"><span className="cs-info-label"><Thermometer size={14} /> Evapotranspiration</span><span className="cs-info-value">{w.past_7d_et0_mm} mm</span></div>
              <div className="cs-info-row">
                <span className="cs-info-label">💧 Water Deficit</span>
                <span className="cs-info-value" style={{ color: w.water_deficit_mm > 10 ? '#DC2626' : '#16803D' }}>
                  {w.water_deficit_mm > 0 ? '-' : '+'}{Math.abs(w.water_deficit_mm)} mm
                </span>
              </div>
              {w.avg_tmax_c != null && (
                <div className="cs-info-row"><span className="cs-info-label"><Thermometer size={14} /> Avg Max Temp</span><span className="cs-info-value">{w.avg_tmax_c}°C</span></div>
              )}
              <div style={{ fontSize: '0.7rem', color: '#647067', marginTop: '0.5rem', fontStyle: 'italic' }}>Source: Open-Meteo</div>
            </>
          ) : (
            <div style={{ fontSize: '0.85rem', color: '#647067', padding: '0.5rem 0' }}>Weather data not available.</div>
          )}
        </div>
      )}
    </div>
  );
};

/* ── Main Header ────────────────────────────────────────────────────── */
export const AppHeader: React.FC<AppHeaderProps> = ({ metadata, satelliteLoaded }) => {
  const location = useLocation();
  const [lang, setLang] = useState('en');

  const isLand = location.pathname === '/land';
  const isCrop = location.pathname === '/crop';

  return (
    <header className="cs-header">
      <div className="cs-header-left">
        <Link to="/" className="cs-logo">
          <Sprout size={24} /> CropSense
        </Link>
        <nav className="cs-nav">
          <Link to="/land" className={`cs-nav-btn ${isLand ? 'active' : ''}`}>
            <Map size={16} /> <span>Land Inspection</span>
          </Link>
          <Link to="/crop" className={`cs-nav-btn ${isCrop ? 'active' : ''}`}>
            <Camera size={16} /> <span>Crop Inspection</span>
          </Link>
        </nav>
      </div>

      <div className="cs-header-right">
        <FarmDropdown meta={metadata} />
        <LegendDropdown meta={metadata} />
        <WeatherDropdown meta={metadata} />
        <select
          className="cs-lang-select"
          value={lang}
          onChange={e => setLang(e.target.value)}
          title="Language"
        >
          <option value="en">🌐 EN</option>
          <option value="hi">🌐 HI</option>
          <option value="mr">🌐 MR</option>
        </select>
      </div>
    </header>
  );
};
