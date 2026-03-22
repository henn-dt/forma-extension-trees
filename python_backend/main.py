"""
FastAPI backend for tree detection and 3D model generation
Simple, focused on getting data flowing end-to-end
"""

from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Body
from fastapi.responses import JSONResponse, Response, FileResponse
from fastapi.middleware.cors import CORSMiddleware
import uvicorn
import cv2
import numpy as np
import logging
import os
import tempfile
from datetime import datetime
from typing import Optional, Dict, Any

from tree_detector_core import detect_trees_in_image
from model_generator_core import generate_obj_content, generate_model_metadata

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# CORS Configuration
# =============================================================================
# ALLOWED_ORIGINS: Comma-separated list of allowed origins for CORS
# Example: "https://app.autodeskforma.eu,https://forma-trees.henn.com"
# 
# Note: In production, the Express backend proxies requests to this Python API,
# so direct CORS isn't usually needed. This is mainly for local development
# and debugging when accessing the Python API directly.
# =============================================================================
ALLOWED_ORIGINS = os.environ.get('ALLOWED_ORIGINS', '*').split(',')
ALLOWED_ORIGINS = [origin.strip() for origin in ALLOWED_ORIGINS]
logger.info(f"🔒 CORS allowed origins: {ALLOWED_ORIGINS}")

# Create FastAPI app
app = FastAPI(
    title="Tree Detection API",
    description="Backend API for detecting trees in satellite imagery using HSV color filtering",
    version="1.0.0"
)

# Add CORS middleware
# In production, Express proxies to this API, so CORS is less critical here
# But we configure it properly for direct access during development/debugging
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    """Root endpoint with API info"""
    return {
        "service": "Tree Detection API",
        "version": "1.0.0",
        "status": "running",
        "endpoints": {
            "health": "/health",
            "detect": "/detect-trees",
            "docs": "/docs"
        }
    }


@app.get("/health")
def health_check():
    """Health check endpoint"""
    return {
        "status": "ok",
        "service": "tree-detection",
        "message": "Python FastAPI backend is running"
    }


@app.post("/detect-trees")
async def detect_trees(
    image: UploadFile = File(..., description="Satellite image file"),
    hue_min: int = Form(..., description="HSV Hue minimum (0-179)"),
    hue_max: int = Form(..., description="HSV Hue maximum (0-179)"),
    sat_min: int = Form(..., description="HSV Saturation minimum (0-255)"),
    sat_max: int = Form(..., description="HSV Saturation maximum (0-255)"),
    val_min: int = Form(..., description="HSV Value minimum (0-255)"),
    val_max: int = Form(..., description="HSV Value maximum (0-255)"),
    min_diameter: float = Form(..., description="Minimum tree diameter in meters"),
    max_diameter: float = Form(..., description="Maximum tree diameter in meters"),
    cluster_threshold: float = Form(..., description="Cluster threshold diameter in meters"),
    real_width: float = Form(..., description="Real-world width in meters"),
    real_height: float = Form(..., description="Real-world height in meters")
):
    """
    Detect trees in a satellite image using HSV color thresholding.
    
    This endpoint:
    1. Receives an image file and detection parameters
    2. Applies HSV filtering to identify vegetation
    3. Detects individual trees and tree clusters
    4. Returns tree positions and metadata
    """
    try:
        logger.info(f"Received detection request for image: {image.filename}")
        logger.info(f"HSV range: H({hue_min}-{hue_max}), S({sat_min}-{sat_max}), V({val_min}-{val_max})")
        logger.info(f"Detection params: diameter({min_diameter}-{max_diameter}m), cluster({cluster_threshold}m)")
        logger.info(f"Real dimensions: {real_width}m × {real_height}m")
        
        # Read image from upload
        contents = await image.read()
        nparr = np.frombuffer(contents, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            logger.error("Failed to decode image")
            raise HTTPException(
                status_code=400,
                detail="Failed to decode image. Please ensure the file is a valid image format (PNG, JPG, etc.)"
            )
        
        logger.info(f"Image decoded successfully: {img.shape[1]}×{img.shape[0]} pixels")
        
        # Prepare parameters for detection function
        hsv_thresholds = {
            "hue": {"min": hue_min, "max": hue_max},
            "saturation": {"min": sat_min, "max": sat_max},
            "value": {"min": val_min, "max": val_max}
        }
        
        detection_params = {
            "min_diameter": min_diameter,
            "max_diameter": max_diameter,
            "cluster_threshold": cluster_threshold
        }
        
        real_dimensions = {
            "width": real_width,
            "height": real_height
        }
        
        # Call core detection function
        logger.info("Starting tree detection...")
        result = detect_trees_in_image(
            img,
            hsv_thresholds,
            detection_params,
            real_dimensions
        )
        
        logger.info(f"Detection complete: {result['summary']['individualTreesCount']} individual trees, "
                   f"{result['summary']['treeClustersCount']} clusters, "
                   f"{result['summary']['totalPopulatedTrees']} populated trees")
        
        return JSONResponse(content=result)
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error during tree detection: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Internal server error during tree detection: {str(e)}"
        )


# Temp directory for generated models
MODELS_DIR = os.path.join(tempfile.gettempdir(), "forma_tree_models")
os.makedirs(MODELS_DIR, exist_ok=True)
logger.info(f"📁 Model temp directory: {MODELS_DIR}")


@app.post("/generate-model")
async def generate_model(detection_data: Dict[str, Any] = Body(...)):
    """
    Generate 3D model (OBJ file) from tree detection results.
    Saves to temp file and returns metadata + download URL.
    """
    try:
        logger.info("Received 3D model generation request")

        if not detection_data.get('individualTrees') and not detection_data.get('treeClusters'):
            raise HTTPException(status_code=400, detail="No trees found in detection data")

        metadata = generate_model_metadata(detection_data)
        total_trees = metadata['totalTrees']
        logger.info(f"Generating model: {total_trees} trees, "
                   f"{metadata['totalVertices']} vertices, {metadata['totalFaces']} faces")

        if total_trees > 60000:
            raise HTTPException(
                status_code=400,
                detail=f"Model too large: {total_trees} trees would create a {total_trees * 0.01:.0f}MB+ file. "
                       f"Please reduce to <60,000 trees."
            )

        # Generate OBJ content
        obj_content, mtl_content = generate_obj_content(detection_data)

        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        obj_filename = f"trees_model_{total_trees}trees_{timestamp}.obj"

        # Save to temp file
        filepath = os.path.join(MODELS_DIR, obj_filename)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(obj_content)

        file_size = os.path.getsize(filepath)
        logger.info(f"Model saved: {filepath} ({file_size} bytes)")

        return JSONResponse(content={
            "success": True,
            "filename": obj_filename,
            "fileSize": file_size,
            "totalTrees": total_trees,
            "totalVertices": metadata['totalVertices'],
            "totalFaces": metadata['totalFaces']
        })

    except HTTPException:
        raise
    except FileNotFoundError as e:
        logger.error(f"Tree model file not found: {str(e)}")
        raise HTTPException(status_code=404, detail="Base tree model not found.")
    except Exception as e:
        logger.error(f"Error during model generation: {str(e)}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/download-model/{filename}")
async def download_model(filename: str):
    """Download a previously generated model file."""
    # Sanitize filename to prevent path traversal
    safe_filename = os.path.basename(filename)
    filepath = os.path.join(MODELS_DIR, safe_filename)

    if not os.path.exists(filepath):
        raise HTTPException(status_code=404, detail=f"Model file not found: {safe_filename}")

    logger.info(f"Serving model download: {safe_filename} ({os.path.getsize(filepath)} bytes)")
    return FileResponse(
        filepath,
        media_type="application/octet-stream",
        filename=safe_filename
    )


if __name__ == "__main__":
    logger.info("Starting Tree Detection API...")
    logger.info("Server will be available at: http://localhost:5001")
    logger.info("API documentation at: http://localhost:5001/docs")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=5001,
        log_level="info",
        timeout_keep_alive=120,
        #workers=4
    )
