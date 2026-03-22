/**
 * Model Result Panel - Display 3D model download result
 */

import type { ModelDownloadResult } from '../services/modelGeneration.service';

interface ModelResultPanelProps {
  modelResult: ModelDownloadResult;
}

export function ModelResultPanel({ modelResult }: ModelResultPanelProps) {
  return (
    <div className="section">
      <h3>3D Model Downloaded</h3>

      <div className="model-stats">
        <div className="line">
          <span className="label">File:</span>
          <span>{modelResult.filename}</span>
        </div>
        <div className="line">
          <span className="label">Total Trees:</span>
          <span>{modelResult.totalTrees.toLocaleString()}</span>
        </div>
        <div className="line">
          <span className="label">Total Vertices:</span>
          <span>{modelResult.totalVertices.toLocaleString()}</span>
        </div>
        <div className="line">
          <span className="label">Total Faces:</span>
          <span>{modelResult.totalFaces.toLocaleString()}</span>
        </div>
      </div>
    </div>
  );
}
