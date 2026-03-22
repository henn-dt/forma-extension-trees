import './App.css'
import { useState } from 'react';

// Hook imports - Phase 1.7 Refactoring + Phase 2.3 Tree Pipeline
import { useFormaProject } from './hooks/useFormaProject';
import { useMapboxTile } from './hooks/useMapboxTile';
import { useTreePipeline } from './hooks/useTreePipeline';

// Component imports - Phase 1.8 Refactoring
import { StatusBar } from './components/StatusBar';
import { ActionButtons } from './components/ActionButtons';
import { ProjectInfoPanel } from './components/ProjectInfoPanel';
import { TerrainBoundsPanel } from './components/TerrainBoundsPanel';
import { MapboxTilePanel } from './components/MapboxTilePanel';
import { ExtendProjectPanel } from './components/ExtendProjectPanel';
import { UserMenu } from './components/UserMenu';
import { MyProjectsPanel } from './components/MyProjectsPanel';

// Component imports - Phase 2.4 Tree Detection UI
import { HSVControlPanel } from './components/HSVControlPanel';
import { DetectionParametersPanel } from './components/DetectionParametersPanel';
import { TreeDetectionPreview } from './components/TreeDetectionPreview';
import { TreeListPanel } from './components/TreeListPanel';
import { ModelResultPanel } from './components/ModelResultPanel';
import { TreePlacementTester } from './components/TreePlacementTester';

// Utility imports for copyJSON function
import { calculateArea, calculateDimensions } from './utils/geometry.utils';

function App() {
  // Projects panel overlay state
  const [showProjectsPanel, setShowProjectsPanel] = useState(false);

  // Tab state - Phase 2.5
  const [activeTab, setActiveTab] = useState<'project' | 'extend' | 'trees'>('project');

  // Tile selection state for tree detection
  const [useExtendedTile, setUseExtendedTile] = useState(false);

  // Extension tracking state - for displaying extension amounts in Tab 2
  const [appliedExtensions, setAppliedExtensions] = useState<{
    north: number;
    east: number;
    west: number;
    south: number;
  }>({ north: 0, east: 0, west: 0, south: 0 });

  // Use custom hooks - Phase 1.7 Refactoring + Phase 2.3
  const formaProject = useFormaProject();
  const mapboxTile = useMapboxTile();
  const treePipeline = useTreePipeline();

  // Combine status from all hooks
  const status = formaProject.status || mapboxTile.status || treePipeline.status;

  const copyJSON = async () => {
    if (!formaProject.bbox) return;

    const dimensions = calculateDimensions(formaProject.bbox);
    const exportData = {
      geographicLocation: formaProject.location ? {
        latitude: parseFloat(formaProject.location[0].toFixed(6)),
        longitude: parseFloat(formaProject.location[1].toFixed(6))
      } : null,
      projectDetails: formaProject.projectData ? {
        id: formaProject.projectId,
        name: formaProject.projectData.name,
        countryCode: formaProject.projectData.countryCode,
        srid: formaProject.projectData.srid,
        timezone: formaProject.projectData.timezone,
        refPoint: formaProject.projectData.refPoint,
        projString: formaProject.projectData.projString
      } : null,
      terrainBounds: {
        west: parseFloat(formaProject.bbox.west.toFixed(6)),
        south: parseFloat(formaProject.bbox.south.toFixed(6)),
        east: parseFloat(formaProject.bbox.east.toFixed(6)),
        north: parseFloat(formaProject.bbox.north.toFixed(6)),
        dimensions: {
          width: parseFloat(dimensions.width.toFixed(2)),
          length: parseFloat(dimensions.length.toFixed(2))
        },
        area: parseFloat(calculateArea(formaProject.bbox).toFixed(2))
      }
    };

    await navigator.clipboard.writeText(JSON.stringify(exportData, null, 2));
    formaProject.setStatus("JSON copied to clipboard ✔");
    setTimeout(() => formaProject.setStatus(""), 1200);
  };

  const handleFetchTile = () => {
    if (formaProject.bbox && formaProject.projectData) {
      mapboxTile.fetchTile(formaProject.bbox, formaProject.projectData);
    }
  };

  const copyMapboxJSON = async () => {
    if (!mapboxTile.mapboxData) return;

    const safeData = {
      center: mapboxTile.mapboxData.center,
      zoom: typeof mapboxTile.mapboxData.zoom === 'number' 
        ? parseFloat(mapboxTile.mapboxData.zoom.toFixed(2)) 
        : mapboxTile.mapboxData.zoom,
      style: mapboxTile.mapboxData.style,
      size: mapboxTile.mapboxData.size,
      bbox: mapboxTile.mapboxData.bbox
    };

    await navigator.clipboard.writeText(JSON.stringify(safeData, null, 2));
    mapboxTile.setStatus("Mapbox JSON copied to clipboard ✔");
    setTimeout(() => mapboxTile.setStatus(""), 1200);
  };

  return (
    <>
      {/* User Menu - Top Left */}
      <UserMenu
        onShowProjects={() => setShowProjectsPanel(true)}
      />

      {/* Projects Panel Overlay */}
      {showProjectsPanel && (
        <MyProjectsPanel onClose={() => setShowProjectsPanel(false)} />
      )}

      <div className="panel">
      <h2>Forma Tree Detection</h2>

      {/* Tab Navigation */}
      <div className="tabs">
        <button 
          className={activeTab === 'project' ? 'active' : ''}
          onClick={() => setActiveTab('project')}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
            <circle cx="12" cy="12" r="10"/>
            <path d="M2 12h20"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          Project Tile
        </button>
        <button 
          className={activeTab === 'extend' ? 'active' : ''}
          onClick={() => setActiveTab('extend')}
          disabled={!formaProject.bbox || !formaProject.projectData}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
            <circle cx="12" cy="12" r="10"/>
            <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
          </svg>
          Extend Project
        </button>
        <button 
          className={activeTab === 'trees' ? 'active' : ''}
          onClick={() => setActiveTab('trees')}
          disabled={!mapboxTile.mapboxData}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ marginRight: '6px', verticalAlign: 'middle' }}>
            <path d="M12 2L8 8h8L12 2z"/>
            <path d="M12 8L7 16h10L12 8z"/>
            <path d="M12 16v6"/>
          </svg>
          Tree Detection
        </button>
      </div>

      <div className="box">
        <StatusBar status={status} />

        {/* Project Tile Tab (renamed from Satellite) */}
        {activeTab === 'project' && (
          <>
            <ActionButtons
              onGetProjectInfo={formaProject.fetchProjectInfo}
              onFetchTile={handleFetchTile}
              bbox={formaProject.bbox}
              location={formaProject.location}
              projectData={formaProject.projectData}
              isLoadingInfo={formaProject.isLoadingProjectInfo}
              isLoadingTile={mapboxTile.isFetchingTile}
            />

            {mapboxTile.mapboxData ? (
              <div className="content-grid">
                <div className="content-left">
                  <ProjectInfoPanel
                    projectId={formaProject.projectId}
                    projectData={formaProject.projectData}
                    location={formaProject.location}
                  />

                  {formaProject.bbox && (
                    <TerrainBoundsPanel bbox={formaProject.bbox} onCopyJSON={copyJSON} />
                  )}
                </div>

                <div className="content-right">
                  <div className="section">
                    <h3>Mapbox Satellite Tile</h3>
                    
                    <MapboxTilePanel
                      mapboxData={mapboxTile.mapboxData}
                      onCopyJSON={copyMapboxJSON}
                      onDownloadTile={() => mapboxTile.downloadTileImage(formaProject.projectId)}
                    />
                    
                    <img 
                      src={mapboxTile.mapboxData.url} 
                      alt="Satellite tile" 
                      className="image-display"
                      style={{ marginTop: '8px' }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <>
                <ProjectInfoPanel
                  projectId={formaProject.projectId}
                  projectData={formaProject.projectData}
                  location={formaProject.location}
                />

                {formaProject.bbox && (
                  <TerrainBoundsPanel bbox={formaProject.bbox} onCopyJSON={copyJSON} />
                )}
              </>
            )}
          </>
        )}

        {/* Extend Project Tab - NEW */}
        {activeTab === 'extend' && (
          <>
            {mapboxTile.extendedTileData ? (
              <div className="content-grid">
                <div className="content-left">
                  <ExtendProjectPanel
                    bbox={formaProject.bbox}
                    projectData={formaProject.projectData}
                    onFetchExtended={(extensions) => {
                      setAppliedExtensions(extensions);
                      mapboxTile.fetchExtendedTile(formaProject.bbox!, formaProject.projectData!, extensions);
                    }}
                    isLoading={mapboxTile.isExtendedTileLoading}
                  />
                </div>

                <div className="content-right">
                  <div className="section">
                    <h3>Extended Tile Preview</h3>
                    
                    <div className="line">
                      <span className="label">Extended Dimensions:</span>
                      <span>
                        {(mapboxTile.extendedTileData.bbox.east - mapboxTile.extendedTileData.bbox.west).toFixed(0)}m × 
                        {(mapboxTile.extendedTileData.bbox.north - mapboxTile.extendedTileData.bbox.south).toFixed(0)}m
                      </span>
                    </div>
                    
                    {/* Display extension amounts */}
                    {(appliedExtensions.north > 0 || appliedExtensions.east > 0 || 
                      appliedExtensions.west > 0 || appliedExtensions.south > 0) && (
                      <div className="line">
                        <span className="label">Extensions Applied:</span>
                        <span>
                          {appliedExtensions.north > 0 && `North: +${appliedExtensions.north}m `}
                          {appliedExtensions.east > 0 && `East: +${appliedExtensions.east}m `}
                          {appliedExtensions.west > 0 && `West: +${appliedExtensions.west}m `}
                          {appliedExtensions.south > 0 && `South: +${appliedExtensions.south}m`}
                        </span>
                      </div>
                    )}
                    
                    <div className="line">
                      <span className="label">Image Size:</span>
                      <span>{mapboxTile.extendedTileData.size.width} × {mapboxTile.extendedTileData.size.height}</span>
                    </div>

                    <img 
                      src={mapboxTile.extendedTileData.url} 
                      alt="Extended satellite tile" 
                      className="image-display"
                      style={{ marginTop: '8px' }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <ExtendProjectPanel
                bbox={formaProject.bbox}
                projectData={formaProject.projectData}
                onFetchExtended={(extensions) => {
                  setAppliedExtensions(extensions);
                  mapboxTile.fetchExtendedTile(formaProject.bbox!, formaProject.projectData!, extensions);
                }}
                isLoading={mapboxTile.isExtendedTileLoading}
              />
            )}
          </>
        )}

        {/* Tree Detection Tab - Phase 2.5 */}
        {activeTab === 'trees' && (
          <>
            {(mapboxTile.mapboxData || mapboxTile.extendedTileData) && formaProject.bbox ? (
              <>
                {/* Tile Selector - NEW */}
                {mapboxTile.extendedTileData && (
                  <div className="section" style={{ background: '#e3f2fd', padding: '15px', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                      <span style={{ fontWeight: 'bold', fontSize: '1.05em', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        {useExtendedTile ? (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <circle cx="12" cy="12" r="10"/>
                              <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76"/>
                            </svg>
                            Using Extended Tile
                          </>
                        ) : (
                          <>
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
                              <line x1="3" y1="9" x2="21" y2="9"/>
                              <line x1="9" y1="21" x2="9" y2="9"/>
                            </svg>
                            Using Project Tile
                          </>
                        )}
                      </span>
                      
                      {/* Toggle Switch */}
                      <label style={{ 
                        position: 'relative', 
                        display: 'inline-block', 
                        width: '60px', 
                        height: '30px',
                        cursor: 'pointer'
                      }}>
                        <input 
                          type="checkbox" 
                          checked={useExtendedTile}
                          onChange={(e) => setUseExtendedTile(e.target.checked)}
                          style={{ opacity: 0, width: 0, height: 0 }}
                        />
                        <span style={{
                          position: 'absolute',
                          cursor: 'pointer',
                          top: 0,
                          left: 0,
                          right: 0,
                          bottom: 0,
                          backgroundColor: useExtendedTile ? '#2196F3' : '#ccc',
                          transition: '0.4s',
                          borderRadius: '30px',
                        }}>
                          <span style={{
                            position: 'absolute',
                            content: '""',
                            height: '22px',
                            width: '22px',
                            left: useExtendedTile ? '34px' : '4px',
                            bottom: '4px',
                            backgroundColor: 'white',
                            transition: '0.4s',
                            borderRadius: '50%',
                          }} />
                        </span>
                      </label>
                    </div>
                    
                    <p style={{ fontSize: '0.9em', color: '#555' }}>
                      {useExtendedTile 
                        ? `Extended tile: ${(mapboxTile.extendedTileData.bbox.east - mapboxTile.extendedTileData.bbox.west).toFixed(0)}m × ${(mapboxTile.extendedTileData.bbox.north - mapboxTile.extendedTileData.bbox.south).toFixed(0)}m`
                        : mapboxTile.mapboxData
                          ? `Project tile: ${(mapboxTile.mapboxData.bbox.east - mapboxTile.mapboxData.bbox.west).toFixed(0)}m × ${(mapboxTile.mapboxData.bbox.north - mapboxTile.mapboxData.bbox.south).toFixed(0)}m`
                          : 'No project tile available'
                      }
                    </p>
                  </div>
                )}

                {/* Get the selected tile data */}
                {(() => {
                  const selectedTile = useExtendedTile && mapboxTile.extendedTileData 
                    ? mapboxTile.extendedTileData 
                    : mapboxTile.mapboxData;
                  
                  if (!selectedTile) {
                    return (
                      <div className="section">
                        <p className="help-text">
                          ⬅️ Please fetch a tile first.
                        </p>
                      </div>
                    );
                  }

                  return (
                    <>
                      <HSVControlPanel
                        hsvThresholds={treePipeline.hsvThresholds}
                        onChange={treePipeline.setHsvThresholds}
                        disabled={treePipeline.isDetecting}
                      />

                      <TreeDetectionPreview
                        originalImageUrl={selectedTile.url}
                        detectionResult={treePipeline.detectionResult}
                        hsvThresholds={treePipeline.hsvThresholds}
                      />

                      <div style={{ display: 'flex', justifyContent: 'center', margin: '20px 0' }}>
                        <button
                          onClick={() => {
                            // Use the selected tile's bbox
                            const bboxToUse = useExtendedTile && mapboxTile.extendedTileData 
                              ? mapboxTile.extendedTileData.bbox 
                              : formaProject.bbox!;
                            
                            treePipeline.detectTreesInTile(selectedTile.url, bboxToUse);
                          }}
                          disabled={treePipeline.isDetecting}
                          className="btn btn-primary"
                          style={{ fontSize: '1.1em', padding: '12px 30px', display: 'flex', alignItems: 'center', gap: '8px' }}
                        >
                          {treePipeline.isDetecting ? (
                            <>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"/>
                              </svg>
                              Detecting Trees...
                            </>
                          ) : (
                            <>
                              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="11" cy="11" r="8"/>
                                <path d="M21 21l-4.35-4.35"/>
                              </svg>
                              Detect Trees
                            </>
                          )}
                        </button>
                      </div>

                      <DetectionParametersPanel
                        params={treePipeline.detectionParams}
                        onChange={treePipeline.setDetectionParams}
                        disabled={treePipeline.isDetecting}
                      />

                      {treePipeline.detectionResult && (
                        <>
                          <TreeListPanel
                            detectionResult={treePipeline.detectionResult}
                            treesWithElevation={treePipeline.treesWithElevation}
                          />
                          
                          {/* Tree Placement - shows when trees with elevation are ready */}
                          {treePipeline.treesWithElevation && treePipeline.treesWithElevation.length > 0 && (
                            <TreePlacementTester
                              treesWithElevation={treePipeline.treesWithElevation}
                              disablePlacement={useExtendedTile}
                            />
                          )}
                        </>
                      )}

                      {treePipeline.modelResult && (
                        <ModelResultPanel modelResult={treePipeline.modelResult} />
                      )}
                    </>
                  );
                })()}
              </>
            ) : (
              <div className="section">
                <p className="help-text">
                  Please fetch a satellite tile first using the "Project Tile" or "Extend Project" tab.
                </p>
              </div>
            )}
          </>
        )}
      </div>
      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
    </>
  );
}

export default App;