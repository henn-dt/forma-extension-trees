/**
 * Tree Placement Component
 * 
 * Places detected trees in Forma using Instance Mode for optimal performance.
 * Uses per-tree scaling based on detected crown diameter.
 */

import { useState, useMemo } from 'react';
import { Forma } from 'forma-embedded-view-sdk/auto';
import { getTreeBlobId } from '../services/treeBlob.service';

// ========================================
// CONFIGURATION CONSTANTS
// ========================================
const MAX_TREES = 3000;                    // Maximum trees that can be placed at once
const SMALL_CLUSTER_THRESHOLD = 5;         // Clusters with < 5 trees are "small"
const GLB_HEIGHT_M = 12;                   // treeModel_12m.glb is 12m tall (real scale)
const HEIGHT_MULTIPLIER = 1.5;             // Tree height = diameter × 1.5 (matches Python backend)
const DEFAULT_SCALE = 1.0;                 // Fallback scale if diameter not available

interface TreePlacementTesterProps {
  treesWithElevation: Array<{
    x: number;
    y: number;
    z?: number;
    tree_id?: number;
    type?: string;
    estimatedDiameterM?: number;
    centroid_m?: [number, number];
    [key: string]: unknown;
  }> | null;
  /** When true, disables the Tree Density slider and Place Trees button (for extended tile mode) */
  disablePlacement?: boolean;
}

/**
 * Compute per-tree scale based on detected crown diameter
 * Formula: desiredHeight = diameter × 1.5, scale = desiredHeight / GLB_HEIGHT_M
 */
function computeInstanceScale(estimatedDiameterM?: number): number {
  if (typeof estimatedDiameterM === 'number' && estimatedDiameterM > 0) {
    const desiredHeight = estimatedDiameterM * HEIGHT_MULTIPLIER;
    // Clamp to reasonable range [0.05, 6.0] to avoid absurdly tiny/huge models
    return Math.max(0.05, Math.min(6.0, desiredHeight / GLB_HEIGHT_M));
  }
  return DEFAULT_SCALE;
}

export function TreePlacementTester({ treesWithElevation, disablePlacement = false }: TreePlacementTesterProps) {
  const [status, setStatus] = useState('');
  const [progress, setProgress] = useState(0);
  const [isPlacing, setIsPlacing] = useState(false);
  const [treeDensity, setTreeDensity] = useState(100); // Percentage of trees to place

  // Calculate available trees and max allowed density
  const availableTrees = treesWithElevation?.filter(tree => tree.z !== undefined).length || 0;
  const maxAllowedDensity = useMemo(() => {
    if (availableTrees === 0) return 100;
    if (availableTrees <= MAX_TREES) return 100;
    return Math.floor((MAX_TREES / availableTrees) * 100);
  }, [availableTrees]);

  // Calculate how many trees will be placed
  const estimatedTreeCount = useMemo(() => {
    return Math.min(
      Math.round((availableTrees * treeDensity) / 100),
      MAX_TREES
    );
  }, [availableTrees, treeDensity]);

  // ========================================
  // TREE SELECTION FUNCTIONS
  // ========================================

  /**
   * Group trees by their centroid (cluster identifier)
   */
  function groupTreesByCentroid(trees: typeof treesWithElevation): {
    clusters: Map<string, typeof trees>;
    individuals: typeof trees;
  } {
    if (!trees) return { clusters: new Map(), individuals: [] };

    const clusters = new Map<string, typeof trees>();
    const individuals: typeof trees = [];

    trees.forEach(tree => {
      if (tree.type === 'cluster' && tree.centroid_m && Array.isArray(tree.centroid_m)) {
        const key = `${tree.centroid_m[0]}_${tree.centroid_m[1]}`;
        if (!clusters.has(key)) {
          clusters.set(key, []);
        }
        clusters.get(key)!.push(tree);
      } else {
        individuals.push(tree);
      }
    });

    return { clusters, individuals };
  }

  /**
   * Categorize clusters by size
   */
  function categorizeClustersBySize(clusters: Map<string, NonNullable<typeof treesWithElevation>>) {
    const largeClusters = new Map<string, NonNullable<typeof treesWithElevation>>();
    const smallClusters = new Map<string, NonNullable<typeof treesWithElevation>>();

    clusters.forEach((trees, key) => {
      if (trees && trees.length >= SMALL_CLUSTER_THRESHOLD) {
        largeClusters.set(key, trees);
      } else if (trees) {
        smallClusters.set(key, trees);
      }
    });

    return { largeClusters, smallClusters };
  }

  /**
   * Select trees based on density percentage
   */
  function selectTreesByDensity(
    trees: typeof treesWithElevation,
    densityPercent: number
  ): NonNullable<typeof treesWithElevation> {
    if (!trees || trees.length === 0) return [];
    if (densityPercent >= 100) return [...trees].sort(() => Math.random() - 0.5);

    const { clusters, individuals } = groupTreesByCentroid(trees);
    const { largeClusters, smallClusters } = categorizeClustersBySize(clusters);
    const selected: NonNullable<typeof treesWithElevation> = [];

    // 1. Process LARGE clusters (≥5 trees)
    largeClusters.forEach(clusterTrees => {
      if (!clusterTrees) return;
      const targetCount = Math.max(1, Math.round(clusterTrees.length * (densityPercent / 100)));
      const shuffled = [...clusterTrees].sort(() => Math.random() - 0.5);
      selected.push(...shuffled.slice(0, targetCount));
    });

    // 2. Process SMALL clusters (<5 trees)
    const sortedSmallClusters = Array.from(smallClusters.entries())
      .filter(([, trees]) => trees !== null)
      .sort((a, b) => (b[1]?.length || 0) - (a[1]?.length || 0));

    const targetSmallClusters = Math.max(
      0,
      Math.round(sortedSmallClusters.length * (densityPercent / 100))
    );

    sortedSmallClusters.slice(0, targetSmallClusters).forEach(([, clusterTrees]) => {
      if (!clusterTrees || clusterTrees.length === 0) return;
      const randomTree = clusterTrees[Math.floor(Math.random() * clusterTrees.length)];
      selected.push(randomTree);
    });

    // 3. Process INDIVIDUAL trees
    if (individuals && individuals.length > 0) {
      const targetIndividuals = Math.round(individuals.length * (densityPercent / 100));
      const shuffledIndividuals = [...individuals].sort(() => Math.random() - 0.5);
      selected.push(...shuffledIndividuals.slice(0, targetIndividuals));
    }

    return selected.sort(() => Math.random() - 0.5);
  }

  // ========================================
  // PLACEMENT FUNCTION (Instance Mode with Per-Tree Scaling)
  // ========================================

  const placeTrees = async () => {
    if (!treesWithElevation || treesWithElevation.length === 0) {
      setStatus('No trees with elevation data available');
      return;
    }

    setIsPlacing(true);
    setProgress(0);
    setStatus('Starting tree placement...');

    try {
      // 1. Get project metadata
      const projectId = await Forma.getProjectId();
      console.log('Project ID:', projectId);

      // 2. Check edit access
      setStatus('Checking permissions...');
      const canEdit = await Forma.getCanEdit();
      if (!canEdit) {
        setStatus('You need edit access to place trees');
        setIsPlacing(false);
        return;
      }

      // 3. Get terrain bounds
      setStatus('Getting terrain bounds...');
      const terrainBbox = await Forma.terrain.getBbox();
      const terrainOffsetX = terrainBbox.min.x;
      const terrainOffsetY = terrainBbox.min.y;
      console.log(`Terrain offset: (${terrainOffsetX.toFixed(2)}, ${terrainOffsetY.toFixed(2)})`);

      // 4. Get tree model blobId
      setStatus('Loading tree model...');
      const { blobId } = await getTreeBlobId();
      console.log('Tree model ready, blobId:', blobId);

      // 5. Select trees based on density (filter out invalid elevations)
      const filteredTrees = treesWithElevation.filter(tree =>
        tree.z !== undefined && tree.z !== null && !isNaN(tree.z) && tree.z !== 0
      );
      const invalidCount = treesWithElevation.length - filteredTrees.length;
      if (invalidCount > 0) {
        console.warn(`⚠️ Filtered out ${invalidCount} trees with invalid elevation (NaN or z=0)`);
      }
      const selectedTrees = selectTreesByDensity(filteredTrees, treeDensity);
      const testTrees = selectedTrees ? selectedTrees.slice(0, MAX_TREES) : [];

      if (testTrees.length === 0) {
        setStatus('No trees with elevation data found');
        setIsPlacing(false);
        return;
      }

      console.log(`Placing ${testTrees.length} trees with per-tree scaling...`);

      // ========================================
      // BATCH PLACEMENT via updateElements
      // ========================================
      setStatus(`Creating tree definition...`);
      console.log('Using BATCH mode with updateElements for fast placement...');

      const startTime = performance.now();

      // STEP 1: Create ONE single tree definition
      const { urn: parentUrn } = await Forma.integrateElements.createElementV2({
        properties: {
          category: 'vegetation',
          name: 'Tree'
        },
        representations: {
          volumeMesh: {
            type: "linked" as const,
            blobId
          }
        }
      });
      console.log('Created tree definition:', parentUrn);

      // STEP 2: Build all operations upfront
      setStatus(`Building placement data for ${testTrees.length} trees...`);

      const operations: Array<{
        type: "add";
        urn: string;
        name: string;
        transform: number[];
      }> = testTrees.map((tree, i) => {
        const correctedX = terrainOffsetX + tree.x;
        const correctedY = terrainOffsetY + tree.y;
        const correctedZ = tree.z || 0;
        const instanceScale = computeInstanceScale(tree.estimatedDiameterM);

        if (i < 5) {
          const height = tree.estimatedDiameterM
            ? (tree.estimatedDiameterM * HEIGHT_MULTIPLIER).toFixed(1)
            : 'default';
          console.log(`Tree ${i + 1}: diameter=${tree.estimatedDiameterM?.toFixed(1) || 'N/A'}m, height=${height}m, scale=${instanceScale.toFixed(3)}`);
        }

        return {
          type: "add" as const,
          urn: parentUrn,
          name: `Tree ${i + 1}`,
          transform: [
            instanceScale, 0, 0, 0,
            0, instanceScale, 0, 0,
            0, 0, instanceScale, 0,
            correctedX, correctedY, correctedZ, 1
          ]
        };
      });

      // STEP 3: Send in batches of 500 (avoid oversized single requests)
      const BATCH_SIZE = 500;
      let totalPlaced = 0;
      let totalFailed = 0;

      for (let start = 0; start < operations.length; start += BATCH_SIZE) {
        const batch = operations.slice(start, start + BATCH_SIZE);
        const batchNum = Math.floor(start / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(operations.length / BATCH_SIZE);

        setStatus(`Placing batch ${batchNum}/${totalBatches} (${batch.length} trees)...`);
        setProgress(Math.round((start / operations.length) * 100));

        try {
          const results = await Forma.proposal.updateElements({ operations: batch });
          const succeeded = results.filter(r => r !== null).length;
          totalPlaced += succeeded;
          totalFailed += batch.length - succeeded;
          console.log(`Batch ${batchNum}/${totalBatches}: ${succeeded}/${batch.length} placed`);
        } catch (batchError) {
          console.error(`Batch ${batchNum} failed:`, batchError);
          totalFailed += batch.length;
        }
      }

      const totalTime = (performance.now() - startTime) / 1000;
      console.log(`\nPlacement complete! Placed: ${totalPlaced}/${testTrees.length} (${totalFailed} failed)`);
      console.log(`Total time: ${totalTime.toFixed(1)}s, Rate: ${(totalPlaced / totalTime).toFixed(0)} trees/sec`);

      if (totalPlaced === 0) {
        setStatus('No trees were placed successfully');
        setIsPlacing(false);
        return;
      }

      setProgress(100);
      setStatus(`Successfully placed ${totalPlaced} trees with per-tree scaling!`);

      setTimeout(() => {
        setStatus('');
        setProgress(0);
      }, 5000);

    } catch (error) {
      console.error('Placement error:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      setStatus(`Error: ${errorMessage}`);
      setTimeout(() => setStatus(''), 5000);
    } finally {
      setIsPlacing(false);
    }
  };

  return (
    <div className="section" style={{ marginTop: '10px' }}>
      <h3 style={{ marginBottom: '10px', display: 'flex', alignItems: 'center', gap: '8px' }}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 2L8 8h8L12 2z"/>
          <path d="M12 8L7 16h10L12 8z"/>
          <path d="M12 16v6"/>
        </svg>
        Tree Placement
      </h3>

      {/* Tree Density Slider */}
      <div style={{ marginBottom: '15px' }}>
        <label style={{ display: 'block', marginBottom: '5px', fontSize: '14px' }}>
          Tree Density: <strong>{treeDensity}%</strong>
          {availableTrees > MAX_TREES && (
            <span style={{ fontSize: '12px', color: '#dc3545', marginLeft: '8px' }}>
              (Max {maxAllowedDensity}% = {MAX_TREES} trees)
            </span>
          )}
        </label>
        <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
          <input
            type="range"
            min="10"
            max={maxAllowedDensity}
            step="10"
            value={Math.min(treeDensity, maxAllowedDensity)}
            onChange={(e) => setTreeDensity(parseInt(e.target.value))}
            disabled={isPlacing || disablePlacement}
            style={{ flex: 1 }}
          />
          <input
            type="number"
            min="10"
            max={maxAllowedDensity}
            step="10"
            value={Math.min(treeDensity, maxAllowedDensity)}
            onChange={(e) => setTreeDensity(Math.min(parseInt(e.target.value) || 100, maxAllowedDensity))}
            disabled={isPlacing || disablePlacement}
            style={{
              width: '70px',
              padding: '6px',
              fontSize: '13px',
              borderRadius: '4px',
              border: '1px solid #ccc'
            }}
          />
        </div>
        <div style={{ fontSize: '11px', color: '#6c757d', marginTop: '5px' }}>
          Will place ~<strong>{estimatedTreeCount}</strong> trees (homogeneous random sampling)
        </div>
        {/* Quick presets */}
        <div style={{ display: 'flex', gap: '5px', marginTop: '8px' }}>
          {[25, 50, 75, Math.min(100, maxAllowedDensity)].map(preset => (
            <button
              key={preset}
              onClick={() => setTreeDensity(preset)}
              disabled={isPlacing || disablePlacement}
              style={{
                padding: '4px 12px',
                fontSize: '12px',
                backgroundColor: treeDensity === preset ? '#007bff' : '#6c757d',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: (!isPlacing && !disablePlacement) ? 'pointer' : 'not-allowed',
                opacity: disablePlacement ? 0.5 : 1
              }}
            >
              {preset === Math.min(100, maxAllowedDensity) ? 'MAX' : `${preset}%`}
            </button>
          ))}
        </div>
      </div>

      {/* Place Trees Button */}
      <button
        onClick={placeTrees}
        disabled={!treesWithElevation || availableTrees === 0 || isPlacing || disablePlacement}
        style={{
          padding: '12px 24px',
          fontSize: '14px',
          backgroundColor: disablePlacement ? '#6c757d' : (isPlacing ? '#ffc107' : (availableTrees > 0 ? '#007bff' : '#6c757d')),
          color: 'white',
          border: 'none',
          borderRadius: '4px',
          cursor: (availableTrees > 0 && !isPlacing && !disablePlacement) ? 'pointer' : 'not-allowed',
          width: '100%',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          opacity: disablePlacement ? 0.5 : 1
        }}
      >
        {/* Progress bar */}
        {isPlacing && progress > 0 && (
          <div style={{
            position: 'absolute',
            left: 0,
            top: 0,
            height: '100%',
            width: `${progress}%`,
            backgroundColor: 'rgba(255, 255, 255, 0.3)',
            transition: 'width 0.3s ease',
            zIndex: 0
          }} />
        )}

        {/* Button content */}
        <span style={{ position: 'relative', zIndex: 1, display: 'flex', alignItems: 'center', gap: '8px' }}>
          {isPlacing ? (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ animation: 'spin 1s linear infinite' }}>
                <circle cx="12" cy="12" r="10" strokeDasharray="32" strokeDashoffset="8"/>
              </svg>
              Placing... {progress}%
            </>
          ) : (
            <>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2L8 8h8L12 2z"/>
                <path d="M12 8L7 16h10L12 8z"/>
                <path d="M12 16v6"/>
              </svg>
              Place {estimatedTreeCount} Trees in Forma
            </>
          )}
        </span>
      </button>

      {/* Status Message */}
      {status && (
        <div style={{
          marginTop: '10px',
          padding: '10px',
          backgroundColor: status.includes('Error') || status.includes('need') ? '#f8d7da' :
            status.includes('Successfully') ? '#d4edda' : '#d1ecf1',
          color: status.includes('Error') || status.includes('need') ? '#721c24' :
            status.includes('Successfully') ? '#155724' : '#0c5460',
          borderRadius: '4px',
          fontSize: '13px',
          border: `1px solid ${status.includes('Error') || status.includes('need') ? '#f5c6cb' :
            status.includes('Successfully') ? '#c3e6cb' : '#bee5eb'}`
        }}>
          {status}
        </div>
      )}

      {/* Info Footer */}
      <div style={{
        marginTop: '10px',
        fontSize: '12px',
        color: '#6c757d',
        lineHeight: '1.4'
      }}>
        <p style={{ margin: '5px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/>
            <path d="M12 16v-4"/>
            <path d="M12 8h.01"/>
          </svg>
          Available trees: <strong>{availableTrees}</strong>
        </p>
        <p style={{ margin: '5px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 2L8 8h8L12 2z"/>
            <path d="M12 8L7 16h10L12 8z"/>
            <path d="M12 16v6"/>
          </svg>
          Tree height: <strong>diameter × 1.5</strong> (auto-scaled)
        </p>
        <p style={{ margin: '5px 0', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/>
          </svg>
          Using Batch Mode for fast placement
        </p>
      </div>

      <style>{`
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}
