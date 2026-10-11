import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import type { GridData, TerrainDataPayload } from './types';
import { AppHeader } from './components/AppHeader';
import { LandingPage } from './pages/LandingPage';
import { LandInspectionPage } from './pages/LandInspectionPage';
import { CropInspectionPage } from './pages/CropInspectionPage';
import { LoadingState } from './components/LoadingState';
import { ErrorState } from './components/ErrorState';
import './styles/theme.css'; // The new green-and-white theme

export const App: React.FC = () => {
  const [gridData, setGridData] = useState<GridData | null>(null);
  const [terrainData, setTerrainData] = useState<TerrainDataPayload | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [satelliteLoaded, setSatelliteLoaded] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const [gridRes, terrainRes] = await Promise.all([
        fetch('/api/grid'),
        fetch('/api/terrain')
      ]);

      if (!gridRes.ok) throw new Error(`Grid API failed: ${gridRes.status}`);
      if (!terrainRes.ok) throw new Error(`Terrain API failed: ${terrainRes.status}`);

      const gridJson: GridData = await gridRes.json();
      const terrainJson: TerrainDataPayload = await terrainRes.json();

      setGridData(gridJson);
      setTerrainData(terrainJson);
      setLoading(false);
    } catch (err: any) {
      console.error('Error loading data:', err);
      setError(err.message || 'Failed to load data from backend API');
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  if (loading) {
    return <LoadingState message="Loading live Sentinel-2 satellite data and Copernicus DEM terrain..." />;
  }

  if (error || !gridData || !terrainData) {
    return <ErrorState error={error || 'Data unavailable'} onRetry={fetchData} />;
  }

  return (
    <BrowserRouter>
      <div className="cs-page" style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
        <AppHeader metadata={gridData.metadata} satelliteLoaded={satelliteLoaded} />
        <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<LandingPage metadata={gridData.metadata} />} />
            <Route 
              path="/land" 
              element={
                <LandInspectionPage 
                  initialGridData={gridData} 
                  initialTerrainData={terrainData} 
                  onSatelliteStatus={(loaded) => setSatelliteLoaded(loaded)}
                />
              } 
            />
            <Route path="/crop" element={<CropInspectionPage />} />
          </Routes>
        </div>
      </div>
    </BrowserRouter>
  );
};

export default App;
