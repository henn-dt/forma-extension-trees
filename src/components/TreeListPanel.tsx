/**
 * Tree List Panel - Table of detected trees with download buttons
 * 
 * Uses relative URLs (/api/*) which work in both:
 * - Development: Vite proxy forwards to localhost:3001
 * - Production: nginx proxy forwards to backend container
 */

import { useState } from 'react';
import type { TreeDetectionResult } from '../types/treeDetection.types';

// Use relative URL (empty string) - automatically uses /api/* paths
// This works in both development and production:
// - Dev: Vite proxy (in vite.config.ts) forwards /api/* → localhost:3001
// - Prod: nginx forwards /api/* → backend container on port 8012
// By using relative URLs, the same build works everywhere without env var changes
const API_BASE_URL = '';

// Height multiplier matching Python backend
const HEIGHT_MULTIPLIER = 1.5;

interface TreeListPanelProps {
  detectionResult: TreeDetectionResult;
  treesWithElevation?: Array<{
    x: number;
    y: number;
    z?: number;
    tree_id?: number;
    type?: string;
    [key: string]: unknown;
  }> | null;
}

/**
 * Calculate tree height from diameter (same formula as Python backend)
 */
function calculateTreeHeight(diameterM: number): number {
  return diameterM * HEIGHT_MULTIPLIER;
}

export function TreeListPanel({ 
  detectionResult,
  treesWithElevation
}: TreeListPanelProps) {
  const [isDownloadingOBJ, setIsDownloadingOBJ] = useState(false);
  const [isDownloadingJSON, setIsDownloadingJSON] = useState(false);
  
  // Build elevation lookup map for quick access
  const elevationMap = new Map<string, number>();
  if (treesWithElevation) {
    treesWithElevation.forEach((tree) => {
      const key = `${tree.x.toFixed(1)}-${tree.y.toFixed(1)}`;
      elevationMap.set(key, tree.z || 0);
    });
  }
  
  const allTrees = [
    ...detectionResult.individualTrees.map((tree, i) => {
      const key = `${tree.centroidM[0].toFixed(1)}-${tree.centroidM[1].toFixed(1)}`;
      return {
        id: `individual-${i}`,
        type: 'Individual' as const,
        position: tree.centroidM,
        diameter: tree.estimatedDiameterM,
        height: calculateTreeHeight(tree.estimatedDiameterM),
        area: tree.areaM2,
        elevation: elevationMap.get(key)
      };
    }),
    ...detectionResult.treeClusters.flatMap((cluster, ci) => 
      cluster.populatedTrees.map((tree, ti) => {
        const key = `${tree.positionM[0].toFixed(1)}-${tree.positionM[1].toFixed(1)}`;
        return {
          id: `cluster-${ci}-tree-${ti}`,
          type: 'Populated' as const,
          position: tree.positionM,
          diameter: tree.estimatedDiameterM,
          height: calculateTreeHeight(tree.estimatedDiameterM),
          area: 0,
          elevation: elevationMap.get(key)
        };
      })
    )
  ];

  const handleDownloadJSON = () => {
    setIsDownloadingJSON(true);
    try {
      // Create optimized JSON for Forma tree placement
      const treesForPlacement = allTrees.map((tree, index) => ({
        id: index + 1,
        type: tree.type,
        position: {
          x: tree.position[0], // Local X coordinate (meters from refPoint)
          y: tree.position[1], // Local Y coordinate (meters from refPoint)
          z: tree.elevation !== undefined ? tree.elevation : null // Elevation in meters above sea level
        },
        diameter: tree.diameter,
        area: tree.area > 0 ? tree.area : null,
        hasElevation: tree.elevation !== undefined
      }));

      // Summary statistics
      const treesWithElevationCount = treesForPlacement.filter(t => t.hasElevation).length;
      
      const exportData = {
        metadata: {
          exportDate: new Date().toISOString(),
          totalTrees: treesForPlacement.length,
          treesWithElevation: treesWithElevationCount,
          elevationCoverage: `${Math.round((treesWithElevationCount / treesForPlacement.length) * 100)}%`,
          coordinateSystem: "local", // Positions are relative to project refPoint
          units: {
            position: "meters",
            elevation: "meters above sea level",
            diameter: "meters",
            area: "square meters"
          }
        },
        summary: {
          individualTrees: detectionResult.summary.individualTreesCount,
          treeClusters: detectionResult.summary.treeClustersCount,
          populatedTrees: detectionResult.summary.totalPopulatedTrees
        },
        trees: treesForPlacement,
        // Include original detection result for reference
        originalDetectionResult: detectionResult
      };

      const jsonString = JSON.stringify(exportData, null, 2);
      
      // Create blob
      const blob = new Blob([jsonString], { type: 'application/json' });
      
      // Create download link
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      
      // Generate filename with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
      link.download = `trees_for_placement_${timestamp}.json`;
      
      // Trigger download
      document.body.appendChild(link);
      link.click();
      
      // Cleanup
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      console.log('✅ Tree placement JSON downloaded:', {
        totalTrees: treesForPlacement.length,
        withElevation: treesWithElevationCount
      });
    } finally {
      setIsDownloadingJSON(false);
    }
  };

  const handleDownloadOBJ = async () => {
    setIsDownloadingOBJ(true);
    try {
      console.log('📦 Requesting 3D model generation...');

      // Step 1: Generate model (Python saves to temp file, returns JSON metadata)
      const response = await fetch('api/generate-model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(detectionResult)
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ message: 'Unknown error' }));
        throw new Error(errorData.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success || !data.filename) {
        throw new Error('Model generation failed');
      }

      console.log(`✅ Model generated: ${data.filename} (${(data.fileSize / 1024 / 1024).toFixed(1)} MB)`);

      // Step 2: Trigger download via anchor tag pointing to download endpoint
      const link = document.createElement('a');
      link.href = `api/download-model/${encodeURIComponent(data.filename)}`;
      link.download = data.filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      console.log('📥 Download triggered');

    } catch (error) {
      console.error('❌ OBJ download failed:', error);
      alert(`Failed to download OBJ file: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setIsDownloadingOBJ(false);
    }
  };

  return (
    <div className="section">
      <div className="tree-list-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L8 8h8L12 2z"/>
            <path d="M12 8L7 16h10L12 8z"/>
            <path d="M12 16v6"/>
          </svg>
          Detected Trees ({allTrees.length})
        </h3>
        <div style={{ 
          display: 'flex', 
          gap: '0.5rem',
          alignItems: 'stretch',
          flexWrap: 'wrap'
        }}>
          <button
            onClick={handleDownloadOBJ}
            disabled={isDownloadingOBJ || allTrees.length === 0}
            className="btn btn-secondary"
            title="Download 3D model as OBJ file for Rhino, Blender, etc."
            style={{ 
              flex: '1',
              minWidth: '140px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            {isDownloadingOBJ ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"/>
                </svg>
                Downloading...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
                Download OBJ
              </>
            )}
          </button>
          <button
            onClick={handleDownloadJSON}
            disabled={isDownloadingJSON || allTrees.length === 0}
            className="btn btn-secondary"
            title="Download tree positions for Forma placement (includes elevation data)"
            style={{ 
              flex: '1',
              minWidth: '140px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '6px'
            }}
          >
            {isDownloadingJSON ? (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                  <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"/>
                </svg>
                Downloading...
              </>
            ) : (
              <>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Download JSON for Placement
              </>
            )}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="tree-list">
        <table>
          <thead>
            <tr>
              <th>Type</th>
              <th>Position (m)</th>
              <th>Diameter (m)</th>
              <th>Height (m)</th>
              <th>Elevation (m)</th>
            </tr>
          </thead>
          <tbody>
            {allTrees.map((tree) => (
              <tr key={tree.id}>
                <td>{tree.type}</td>
                <td>{tree.position[0].toFixed(1)}, {tree.position[1].toFixed(1)}</td>
                <td>{tree.diameter.toFixed(2)}</td>
                <td>
                  <span style={{ color: '#17a2b8', fontWeight: 'bold' }}>
                    {tree.height.toFixed(1)}
                  </span>
                </td>
                <td>
                  {tree.elevation !== undefined ? (
                    <span style={{ color: '#28a745', fontWeight: 'bold' }}>
                      {tree.elevation.toFixed(2)}
                    </span>
                  ) : (
                    <span style={{ color: '#6c757d' }}>-</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
