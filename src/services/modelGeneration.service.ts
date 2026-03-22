/**
 * 3D model generation service - API calls to Python backend for 3D model creation
 *
 * Two-step process:
 * 1. POST /api/generate-model → generates OBJ, saves on server, returns JSON metadata
 * 2. Browser navigates to /api/download-model/:filename → streams the file download
 *
 * Uses relative URLs (/api/*) which work in both:
 * - Development: Vite proxy forwards to localhost:3001
 * - Production: nginx proxy forwards to backend container
 */

export interface ModelDownloadResult {
  filename: string;
  fileSize: number;
  totalTrees: number;
  totalVertices: number;
  totalFaces: number;
}

/**
 * Generate 3D model from detected trees and trigger browser download
 */
export async function generate3DModelAndDownload(
  detectionData: Record<string, unknown>
): Promise<ModelDownloadResult> {
  console.log('🏗️ Calling 3D model generation API...');

  // Step 1: Generate the model (returns JSON metadata, file saved on server)
  const response = await fetch('api/generate-model', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(detectionData),
  });

  if (!response.ok) {
    let errorMessage = `3D model generation failed (${response.status})`;
    try {
      const errorData = await response.json();
      errorMessage = errorData.message || errorData.detail || errorMessage;
    } catch {
      // not JSON
    }
    throw new Error(errorMessage);
  }

  const result = await response.json();

  if (!result.success || !result.filename) {
    throw new Error(result.message || 'Model generation failed');
  }

  console.log(`✅ Model generated: ${result.filename} (${(result.fileSize / 1024 / 1024).toFixed(1)} MB)`);

  // Step 2: Trigger download via hidden anchor pointing to the download endpoint
  const downloadUrl = `api/download-model/${encodeURIComponent(result.filename)}`;
  const link = document.createElement('a');
  link.href = downloadUrl;
  link.download = result.filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  console.log(`📥 Download triggered: ${result.filename}`);

  return {
    filename: result.filename,
    fileSize: result.fileSize,
    totalTrees: result.totalTrees,
    totalVertices: result.totalVertices,
    totalFaces: result.totalFaces,
  };
}
