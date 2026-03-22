/**
 * Elevation fetching service - Gets terrain elevation for trees
 * Uses smart strategy to optimize performance:
 * - Direct fetch for <=1500 trees (~2.5 min for 1500 trees)
 * - Grid interpolation for >1500 trees (~2.5 min total regardless of count)
 */



/**
 * Elevation fetching service - Gets terrain elevation for trees
 * Uses smart strategy to optimize performance:
 * - Direct fetch for <=1500 trees
 * - Grid interpolation for >1500 trees
 */

import { Forma } from 'forma-embedded-view-sdk/auto';

interface TreePosition {
  x: number;
  y: number;
  z?: number;
  [key: string]: unknown;
}

interface GridPoint {
  x: number;
  y: number;
  z: number;
}

interface BBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

const GRID_THRESHOLD = 1500; // Use grid interpolation above this many trees

/**
 * Get elevations for all trees using the optimal strategy
 * This is called automatically after tree detection
 */
export async function getElevationsForTrees<T extends TreePosition>(
  trees: T[],
  terrainOffsetX: number,
  terrainOffsetY: number,
  onProgress?: (current: number, total: number, stage: string) => void
): Promise<T[]> {
  if (trees.length === 0) return trees;

  console.log(`📍 Getting elevations for ${trees.length} trees...`);

  if (trees.length <= GRID_THRESHOLD) {
    return await fetchElevationsDirectly(trees, terrainOffsetX, terrainOffsetY, onProgress);
  } else {
    return await fetchElevationsViaGrid(trees, terrainOffsetX, terrainOffsetY, onProgress);
  }
}

/**
 * METHOD 1: Direct fetch - get elevation for each tree individually
 * Used for ≤1500 trees (~0.1s per tree = ~2.5min for 1500 trees)
 */
async function fetchElevationsDirectly<T extends TreePosition>(
  trees: T[],
  terrainOffsetX: number,
  terrainOffsetY: number,
  onProgress?: (current: number, total: number, stage: string) => void
): Promise<T[]> {
  console.log(`📍 Direct fetch mode: ${trees.length} trees (~${(trees.length * 0.1).toFixed(0)}s estimated)`);
  const startTime = performance.now();

  const result: T[] = [];

  for (let i = 0; i < trees.length; i++) {
    const tree = trees[i];
    const worldX = terrainOffsetX + tree.x;
    const worldY = terrainOffsetY + tree.y;

    try {
      const z = await Forma.terrain.getElevationAt({ x: worldX, y: worldY });
      result.push({ ...tree, z });

      if (i % 100 === 0 || i === trees.length - 1) {
        onProgress?.(i + 1, trees.length, 'Fetching elevations');
        const progress = ((i + 1) / trees.length * 100).toFixed(0);
        console.log(`   ⏳ Elevation progress: ${progress}% (${i + 1}/${trees.length})`);
      }
    } catch (error) {
      console.error(`Failed to get elevation for tree ${i}:`, error);
      result.push({ ...tree, z: undefined });
    }
  }

  const elapsed = (performance.now() - startTime) / 1000;
  console.log(`✅ Direct fetch complete: ${elapsed.toFixed(1)}s (${(elapsed * 1000 / trees.length).toFixed(0)}ms/tree)`);

  return result;
}

/**
 * METHOD 2: Grid interpolation - create elevation grid and interpolate
 * Used for >1500 trees (~2.5min for grid + instant interpolation)
 */
async function fetchElevationsViaGrid<T extends TreePosition>(
  trees: T[],
  terrainOffsetX: number,
  terrainOffsetY: number,
  onProgress?: (current: number, total: number, stage: string) => void
): Promise<T[]> {
  console.log(`📊 Grid interpolation mode: ${trees.length} trees (est. ~2.5min total)`);
  const startTime = performance.now();

  // 1. Calculate bounding box
  const bounds = calculateBounds(trees);
  console.log(`   Bounds: (${bounds.west.toFixed(1)}, ${bounds.south.toFixed(1)}) to (${bounds.east.toFixed(1)}, ${bounds.north.toFixed(1)})`);

  // 2. Create grid (e.g., 39x39 = 1521 points)
  const gridSize = Math.ceil(Math.sqrt(GRID_THRESHOLD));
  const grid = createGrid(bounds, gridSize, terrainOffsetX, terrainOffsetY);
  console.log(`   Grid size: ${gridSize}×${gridSize} = ${grid.length} points`);

  // 3. Fetch elevation at each grid point with concurrency
  const gridStartTime = performance.now();
  const CONCURRENCY = 15;
  let gridIndex = 0;
  let completedPoints = 0;
  let failedPoints = 0;

  const fetchWorker = async () => {
    while (true) {
      const i = gridIndex++;
      if (i >= grid.length) break;

      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          grid[i].z = await Forma.terrain.getElevationAt({
            x: grid[i].x,
            y: grid[i].y
          });
          break;
        } catch (error) {
          if (attempt === 2) {
            console.error(`Failed to get elevation for grid point ${i} after 3 attempts`);
            grid[i].z = NaN; // Mark as failed (not 0 which could be valid)
            failedPoints++;
          } else {
            await new Promise(r => setTimeout(r, 100 * (attempt + 1)));
          }
        }
      }

      completedPoints++;
      if (completedPoints % 100 === 0 || completedPoints === grid.length) {
        onProgress?.(completedPoints, grid.length, 'Building elevation grid');
        const progress = (completedPoints / grid.length * 100).toFixed(0);
        console.log(`   ⏳ Grid progress: ${progress}% (${completedPoints}/${grid.length})`);
      }
    }
  };

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, grid.length) }).map(() => fetchWorker()));

  if (failedPoints > 0) {
    const failRate = ((failedPoints / grid.length) * 100).toFixed(1);
    console.warn(`⚠️ ${failedPoints}/${grid.length} grid points failed (${failRate}%)`);
  }

  const gridElapsed = (performance.now() - gridStartTime) / 1000;
  console.log(`✅ Grid fetched: ${gridElapsed.toFixed(1)}s`);

  // 4. Interpolate for each tree
  onProgress?.(0, trees.length, 'Interpolating tree elevations');
  console.log(`🔄 Interpolating ${trees.length} tree elevations...`);

  const result = trees.map((tree, i) => {
    const z = bilinearInterpolate(tree.x, tree.y, grid, bounds, gridSize);

    if (i % 500 === 0 && i > 0) {
      console.log(`   Interpolated: ${i}/${trees.length}`);
    }

    return { ...tree, z };
  });

  const totalElapsed = (performance.now() - startTime) / 1000;
  console.log(`✅ Grid interpolation complete: ${totalElapsed.toFixed(1)}s total`);
  console.log(`   ↳ Grid fetch: ${gridElapsed.toFixed(1)}s, Interpolation: ${(totalElapsed - gridElapsed).toFixed(1)}s`);

  return result;
}

/**
 * Calculate bounding box of tree positions
 */
function calculateBounds(trees: TreePosition[]): BBox {
  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  for (const tree of trees) {
    if (tree.x < minX) minX = tree.x;
    if (tree.x > maxX) maxX = tree.x;
    if (tree.y < minY) minY = tree.y;
    if (tree.y > maxY) maxY = tree.y;
  }

  return {
    west: minX,
    south: minY,
    east: maxX,
    north: maxY
  };
}

/**
 * Create elevation grid points
 */
function createGrid(
  bounds: BBox,
  gridSize: number,
  offsetX: number,
  offsetY: number
): GridPoint[] {
  const grid: GridPoint[] = [];
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;

  for (let row = 0; row < gridSize; row++) {
    for (let col = 0; col < gridSize; col++) {
      const relX = bounds.west + (col / (gridSize - 1)) * width;
      const relY = bounds.south + (row / (gridSize - 1)) * height;

      grid.push({
        x: offsetX + relX,
        y: offsetY + relY,
        z: 0 // Will be fetched
      });
    }
  }

  return grid;
}

/**
 * Bilinear interpolation to estimate elevation
 */
function bilinearInterpolate(
  x: number,
  y: number,
  grid: GridPoint[],
  bounds: BBox,
  gridSize: number
): number {
  // Normalize coordinates to grid space
  const width = bounds.east - bounds.west;
  const height = bounds.north - bounds.south;

  const normX = (x - bounds.west) / width * (gridSize - 1);
  const normY = (y - bounds.south) / height * (gridSize - 1);

  // Find grid cell
  const cellX = Math.floor(normX);
  const cellY = Math.floor(normY);

  // Clamp to valid range
  const safeX = Math.max(0, Math.min(gridSize - 2, cellX));
  const safeY = Math.max(0, Math.min(gridSize - 2, cellY));

  // Get 4 corner points
  const p00 = grid[safeY * gridSize + safeX];
  const p10 = grid[safeY * gridSize + safeX + 1];
  const p01 = grid[(safeY + 1) * gridSize + safeX];
  const p11 = grid[(safeY + 1) * gridSize + safeX + 1];

  // Calculate interpolation weights
  const tx = normX - safeX;
  const ty = normY - safeY;

  // If any corner has NaN, propagate it (don't silently use 0)
  if (isNaN(p00.z) || isNaN(p10.z) || isNaN(p01.z) || isNaN(p11.z)) {
    return NaN;
  }

  // Bilinear interpolation
  const z0 = p00.z * (1 - tx) + p10.z * tx;
  const z1 = p01.z * (1 - tx) + p11.z * tx;

  return z0 * (1 - ty) + z1 * ty;
}
