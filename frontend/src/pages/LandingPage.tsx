import React from 'react';
import { Link } from 'react-router-dom';
import { Map, Camera, ArrowRight, MapPin, Sprout, Maximize } from 'lucide-react';
import type { GridMetadata } from '../types';

interface LandingPageProps {
  metadata?: GridMetadata | null;
}

export const LandingPage: React.FC<LandingPageProps> = ({ metadata }) => {
  const bbox = metadata?.aoi_bbox_4326;
  const lat = bbox ? ((bbox[1] + bbox[3]) / 2).toFixed(4) : null;
  const lon = bbox ? ((bbox[0] + bbox[2]) / 2).toFixed(4) : null;

  return (
    <div className="cs-landing">
      <div className="cs-landing-hero">
        <h1>Smart Crop Field Intelligence</h1>
        <p>
          Inspect your agricultural land using satellite imagery and terrain data,
          or upload a crop image to diagnose potential stresses with AI-assisted investigation.
        </p>
      </div>

      <div className="cs-landing-cards">
        {/* Land Inspection */}
        <Link to="/land" className="cs-inspect-card">
          <div className="cs-inspect-icon land">
            <Map size={26} />
          </div>
          <h2>Land Inspection</h2>
          <p>
            Explore your field health through 3D terrain visualization,
            NDVI vegetation mapping, grid-cell analysis, and stress distribution overlays.
          </p>
          <span className="cs-card-cta">
            Open viewer <ArrowRight size={15} />
          </span>
        </Link>

        {/* Crop Inspection */}
        <Link to="/crop" className="cs-inspect-card">
          <div className="cs-inspect-icon crop">
            <Camera size={26} />
          </div>
          <h2>Crop Inspection</h2>
          <p>
            Upload a leaf or plant image to get an AI-powered preliminary assessment,
            then answer follow-up questions for a detailed diagnosis.
          </p>
          <span className="cs-card-cta">
            Start diagnosis <ArrowRight size={15} />
          </span>
        </Link>
      </div>

      {/* Farm chips — only when real data is available */}
      {metadata && (
        <div className="cs-farm-overview">
          {lat && lon && (
            <div className="cs-farm-chip">
              <MapPin size={14} style={{ color: '#16803D' }} />
              <strong>{lat}°N, {lon}°E</strong>
            </div>
          )}
          <div className="cs-farm-chip">
            <Sprout size={14} style={{ color: '#16803D' }} />
            Crop: <strong>Tomato</strong>
          </div>
          {metadata.valid_cells != null && (
            <div className="cs-farm-chip">
              <Maximize size={14} style={{ color: '#16803D' }} />
              <strong>{metadata.valid_cells.toLocaleString()}</strong> grid cells
            </div>
          )}
        </div>
      )}
    </div>
  );
};
