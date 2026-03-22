/**
 * Tree detection pipeline hook - manages state and orchestration for tree detection workflow
 * Follows Phase 1 hook patterns: encapsulates state, provides actions, handles errors
 */

import { useState } from 'react';
import { Forma } from 'forma-embedded-view-sdk/auto';
import type { HSVThresholds, DetectionParameters, TreeDetectionResult } from '../types/treeDetection.types';
import { detectTrees } from '../services/treeDetection.service';
import { generate3DModelAndDownload } from '../services/modelGeneration.service';
import type { ModelDownloadResult } from '../services/modelGeneration.service';
import { getElevationsForTrees } from '../services/elevation.service';
import type { BBox } from '../types/geometry.types';

interface TreeWithElevation {
  x: number;
  y: number;
  z?: number;
  tree_id?: number;
  type?: string;
  estimatedDiameterM?: number;
  centroid_m?: [number, number];
  [key: string]: unknown;
}

// Default HSV values for green vegetation (from Python script)
const DEFAULT_HSV: HSVThresholds = {
  hue: { min: 25, max: 99 },
  saturation: { min: 40, max: 255 },
  value: { min: 40, max: 70 }
};

const DEFAULT_PARAMS: DetectionParameters = {
  minTreeDiameter: 2.0,    // meters
  maxTreeDiameter: 15.0,   // meters
  clusterThreshold: 15.0   // meters
};

/**
 * Custom hook for tree detection and 3D model generation pipeline
 * 
 * @returns State and actions for tree detection workflow
 */
export function useTreePipeline() {
  const [status, setStatus] = useState<string>("");
  const [hsvThresholds, setHsvThresholds] = useState<HSVThresholds>(DEFAULT_HSV);
  const [detectionParams, setDetectionParams] = useState<DetectionParameters>(DEFAULT_PARAMS);
  const [detectionResult, setDetectionResult] = useState<TreeDetectionResult | null>(null);
  const [modelResult, setModelResult] = useState<ModelDownloadResult | null>(null);
  const [isDetecting, setIsDetecting] = useState<boolean>(false);
  const [isGeneratingModel, setIsGeneratingModel] = useState<boolean>(false);
  const [treesWithElevation, setTreesWithElevation] = useState<TreeWithElevation[] | null>(null);

  /**
   * Detect trees in the current tile image
   * 
   * @param imageUrl - Data URL or blob URL of the satellite tile
   * @param bbox - Terrain bounding box for real-world dimensions
   */
  const detectTreesInTile = async (
    imageUrl: string,
    bbox: BBox
  ): Promise<void> => {
    setStatus("🔍 Detecting trees...");
    setDetectionResult(null);
    setTreesWithElevation(null);
    setIsDetecting(true);

    try {
      const realDimensions = {
        width: Math.abs(bbox.east - bbox.west),
        height: Math.abs(bbox.north - bbox.south)
      };

      console.log('Real-world dimensions:', realDimensions);

      // Step 1: Detect trees
      const result = await detectTrees(
        imageUrl,
        hsvThresholds,
        detectionParams,
        realDimensions
      );

      setDetectionResult(result);
      
      const totalTrees = result.summary.individualTreesCount + result.summary.totalPopulatedTrees;
      setStatus(`✅ Detected ${totalTrees} trees - fetching elevations...`);
      
      console.log('Detection completed:', result);

      // Step 2: Get terrain offset for elevation fetching
      const terrainBbox = await Forma.terrain.getBbox();
      const terrainOffsetX = terrainBbox.min.x;
      const terrainOffsetY = terrainBbox.min.y;

      // Step 3: Collect all trees and normalize to common format
      const allTrees = [
        ...result.individualTrees.map(t => ({ 
          x: t.centroidM[0], 
          y: t.centroidM[1],
          type: 'individual' as const,
          estimatedDiameterM: t.estimatedDiameterM
        })),
        ...result.treeClusters.flatMap(cluster => 
          cluster.populatedTrees.map(t => ({
            x: t.positionM[0],
            y: t.positionM[1],
            type: 'cluster' as const,
            centroid_m: cluster.centroidM,
            estimatedDiameterM: t.estimatedDiameterM
          }))
        )
      ];

      console.log(`📍 Fetching elevations for ${allTrees.length} trees...`);

      // Step 4: Fetch elevations automatically (smart strategy: direct or grid)
      const treesWithZ = await getElevationsForTrees(
        allTrees,
        terrainOffsetX,
        terrainOffsetY,
        (current, total, stage) => {
          setStatus(`${stage}: ${current}/${total} (${Math.round((current / total) * 100)}%)`);
        }
      );

      setTreesWithElevation(treesWithZ);
      
      const treesWithElevation = treesWithZ.filter(t => t.z !== undefined).length;
      setStatus(`✅ Ready: ${totalTrees} trees (${treesWithElevation} with elevation)`);
      
      console.log('Trees with elevations:', treesWithZ);
    } catch (err) {
      console.error("Tree detection failed:", err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setStatus(`❌ Detection failed: ${errorMessage}`);
    } finally {
      setIsDetecting(false);
    }
  };

  /**
   * Generate 3D model from detected trees
   * 
   * @param bbox - Terrain bounding box for model dimensions
   */
  const generateModel = async (): Promise<void> => {
    if (!detectionResult) {
      setStatus("❌ No detection results to generate model");
      return;
    }

    setStatus("🏗️ Generating 3D model...");
    setModelResult(null);
    setIsGeneratingModel(true);

    try {
      // Send the complete detection result JSON to the backend
      const result = await generate3DModelAndDownload(detectionResult as unknown as Record<string, unknown>);
      setModelResult(result);
      setStatus(`✅ Model downloaded: ${result.filename} (${result.totalTrees} trees, ${result.totalFaces} faces)`);

      console.log('Model generation completed:', result);
    } catch (err) {
      console.error("3D model generation failed:", err);
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      setStatus(`❌ Model generation failed: ${errorMessage}`);
    } finally {
      setIsGeneratingModel(false);
    }
  };

  /**
   * Reset detection and model results
   */
  const reset = (): void => {
    setDetectionResult(null);
    setModelResult(null);
    setTreesWithElevation(null);
    setStatus("");
    setIsDetecting(false);
    setIsGeneratingModel(false);
    console.log('Pipeline reset');
  };

  /**
   * Handle elevation detection results
   */
  const handleElevationsDetected = (trees: TreeWithElevation[]): void => {
    setTreesWithElevation(trees);
    console.log('Elevations updated in pipeline:', trees);
  };

  return {
    // State
    status,
    hsvThresholds,
    detectionParams,
    detectionResult,
    modelResult,
    isDetecting,
    isGeneratingModel,
    treesWithElevation,

    // Actions
    detectTreesInTile,
    generateModel,
    reset,
    setHsvThresholds,
    setDetectionParams,
    setStatus,
    handleElevationsDetected
  };
}
