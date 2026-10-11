import React, { useState } from 'react';
import type { GridData, GridCell, VisualizationMode, TerrainDataPayload, StressType } from '../types';
import { Header } from '../components/Header';
import { InfoPanel } from '../components/InfoPanel';
import { LayerToggle } from '../components/LayerToggle';
import { CellInspector } from '../components/CellInspector';
import { Legend } from '../components/Legend';
import { ThreeCanvas } from '../components/ThreeCanvas';
import { StressAnalysisPanel } from '../components/StressAnalysisPanel';

interface LandInspectionPageProps {
  initialGridData: GridData;
  initialTerrainData: TerrainDataPayload;
  onSatelliteStatus: (loaded: boolean) => void;
}

export const LandInspectionPage: React.FC<LandInspectionPageProps> = ({ 
  initialGridData, 
  initialTerrainData,
  onSatelliteStatus 
}) => {
  const [mode, setMode] = useState<VisualizationMode>('satellite');
  const [activeStressType, setActiveStressType] = useState<StressType>('none');
  const [selectedCell, setSelectedCell] = useState<GridCell | null>(null);
  const [focusedCell, setFocusedCell] = useState<GridCell | null>(null);
  const [resetViewTrigger, setResetViewTrigger] = useState<number>(0);
  const [exaggeration, setExaggeration] = useState<number>(1.5);

  const [satelliteLoaded, setSatelliteLoaded] = useState(false);
  const [satelliteFailed, setSatelliteFailed] = useState(false);

  const showSatellite = mode === 'satellite' || mode === 'satellite-ndvi';
  const showNDVI = mode === 'ndvi' || mode === 'satellite-ndvi';
  const [showCrops, setShowCrops] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [showBoundary, setShowBoundary] = useState(true);

  const handleResetView = () => setResetViewTrigger(prev => prev + 1);
  const handleSatelliteStatus = (loaded: boolean, failed: boolean) => {
    setSatelliteLoaded(loaded);
    setSatelliteFailed(failed);
    onSatelliteStatus(loaded);
  };
  
  const handleSelectCellFromPanel = (cell: GridCell) => {
    setFocusedCell(cell);
    setSelectedCell(cell);
  };

  return (
    <div className="app-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', width: '100%', overflow: 'hidden', background: '#090d16', color: '#f8fafc' }}>
      <Header
        onResetView={handleResetView}
        mode={mode}
        onModeChange={setMode}
        satelliteLoaded={satelliteLoaded}
        satelliteFailed={satelliteFailed}
      />

      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>
        <div style={{ flex: 1, position: 'relative', height: '100%' }}>
          <ThreeCanvas
            terrainData={initialTerrainData}
            gridData={initialGridData}
            showNDVI={showNDVI}
            showSatellite={showSatellite}
            activeStressType={activeStressType}
            showCrops={showCrops}
            showGrid={showGrid}
            showBoundary={showBoundary}
            exaggeration={exaggeration}
            focusedCell={focusedCell}
            onSelectCell={setSelectedCell}
            onSatelliteStatus={handleSatelliteStatus}
            resetViewTrigger={resetViewTrigger}
          />
        </div>

        <div className="side-panel">
          <div className="side-panel-content custom-scrollbar">
            <StressAnalysisPanel
              gridData={initialGridData}
              activeStressType={activeStressType}
              onStressTypeChange={setActiveStressType}
              onSelectCell={handleSelectCellFromPanel}
            />

            <LayerToggle
              mode={mode}
              onModeChange={setMode}
              showCrops={showCrops} onToggleCrops={() => setShowCrops(v => !v)}
              showGrid={showGrid} onToggleGrid={() => setShowGrid(v => !v)}
              showBoundary={showBoundary} onToggleBoundary={() => setShowBoundary(v => !v)}
              exaggeration={exaggeration}
              onExaggerationChange={setExaggeration}
              metadata={initialGridData.metadata}
            />

            <CellInspector
              selectedCell={selectedCell}
              sentinelDate={initialGridData.metadata.sentinel2_datetime}
            />

            <Legend mode={mode} metadata={initialGridData.metadata} />

            <InfoPanel metadata={initialGridData.metadata} satelliteLoaded={satelliteLoaded} />
          </div>
        </div>
      </div>
    </div>
  );
};
