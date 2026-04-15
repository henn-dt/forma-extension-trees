const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const FormData = require('form-data');
const passport = require('passport');
const flash = require('express-flash');
const session = require('express-session');
const methodOverride = require('method-override');
const argon2 = require('argon2');

// Load environment variables from parent directory
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
const PORT = process.env.PORT || 3001;
const PYTHON_API_URL = process.env.PYTHON_API_URL || 'http://localhost:5001';

// =============================================================================
// CORS Configuration
// =============================================================================
// ALLOWED_ORIGINS: Comma-separated list of allowed origins for CORS
// Example: "https://app.autodeskforma.eu,https://forma-trees.henn.com"
// 
// For Forma extensions, you MUST include the Forma app origin:
// - EU: https://app.autodeskforma.eu
// - US: https://app.autodeskforma.com
// =============================================================================
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(origin => origin.trim())
  : ['http://localhost:5173', 'http://localhost:3001']; // Dev defaults

console.log('🔒 CORS allowed origins:', ALLOWED_ORIGINS);

// Configure multer for memory storage (we'll forward to Python)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

// Middleware
// CORS configuration for Forma iframe embedding and API access
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (same-origin requests, curl, Postman, health checks)
    if (!origin) {
      return callback(null, true);
    }
    
    // In development, allow all localhost origins
    if (process.env.NODE_ENV !== 'production' && origin.startsWith('http://localhost')) {
      return callback(null, true);
    }
    
    // Check if origin is in the allowed list
    if (ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes('*')) {
      return callback(null, true);
    }
    
    // Log rejected origins for debugging
    console.warn(`⚠️ CORS: Rejected origin: ${origin}`);
    callback(new Error(`Origin ${origin} not allowed by CORS`));
  },
  credentials: true,
  // Expose headers needed for file downloads
  exposedHeaders: ['Content-Disposition', 'X-Total-Trees', 'X-Total-Vertices', 'X-Total-Faces']
}));
app.use(express.json({ limit: '50mb' })); // Increase limit for base64 image data
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Setup authentication BEFORE static files so session is available
const setupAuth = require('./auth-setup');
setupAuth(app);

// Serve static files from public folder (login.html, welcome.html, etc.)
app.use(express.static(path.join(__dirname, '../public')));

// Data protection policy page (clean URL)
app.get('/privacy', (req, res) => {
  const publicDir = path.join(__dirname, '../public');  // Same as line 84
  const filePath = path.join(publicDir, 'data-protection-policy.html');
  
  console.log('🔍 Privacy route hit!');
  console.log('   Public dir:', publicDir);
  console.log('   Full path:', filePath);
  
  res.sendFile(filePath);
});

// Directory paths (used for legacy tile saving - now tiles are downloaded directly by user)
const TILES_DIR = path.join(__dirname, '../fetched_tiles');
const SEGMENTATION_DIR = path.join(__dirname, '../segmentation_output');

// Only create directories in non-Docker environments (local development)
// In Docker, these are not needed as tiles are downloaded to user's browser
if (process.env.NODE_ENV !== 'production') {
  if (!fs.existsSync(TILES_DIR)) {
    fs.mkdirSync(TILES_DIR, { recursive: true });
  }
  if (!fs.existsSync(SEGMENTATION_DIR)) {
    fs.mkdirSync(SEGMENTATION_DIR, { recursive: true });
  }
}

// Health check endpoint - checks both Express and Python
app.get('/health', async (req, res) => {
  try {
    // Try to reach Python backend
    const pythonResponse = await axios.get(`${PYTHON_API_URL}/health`, { timeout: 2000 });

    res.json({
      status: 'ok',
      message: 'Backend is running',
      express: 'ok',
      python: pythonResponse.data.status || 'ok'
    });
  } catch (error) {
    // Express is running but Python isn't
    res.json({
      status: 'partial',
      message: 'Express running, Python unavailable',
      express: 'ok',
      python: 'error',
      pythonError: error.message
    });
  }
});

// Save tile endpoint
app.post('/api/saveTile', async (req, res) => {
  try {
    const { imageUrl, projectId, zoom, bbox, center } = req.body;

    if (!imageUrl || !projectId) {
      return res.status(400).json({
        error: 'Missing required fields: imageUrl, projectId'
      });
    }

    console.log('Saving tile for project:', projectId);

    // Generate filename
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `satellite_tile_${projectId}_zoom${zoom}_${timestamp}.png`;
    const filepath = path.join(TILES_DIR, filename);

    // Download image from Mapbox
    console.log('Downloading image from Mapbox...');
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 30000 // 30 second timeout
    });

    const imageBuffer = Buffer.from(response.data);

    // Save image to disk
    fs.writeFileSync(filepath, imageBuffer);
    console.log('Image saved to:', filepath);

    // Save metadata
    const metadata = {
      projectId,
      zoom,
      bbox,
      center,
      filename,
      filepath,
      timestamp: new Date().toISOString(),
      imageSize: imageBuffer.length
    };

    const metadataPath = path.join(TILES_DIR, `${filename}.json`);
    fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
    console.log('Metadata saved');

    res.json({
      success: true,
      message: 'Tile saved successfully',
      filename,
      filepath,
      metadata
    });

  } catch (error) {
    console.error('Error saving tile:', error.message);
    res.status(500).json({
      error: 'Failed to save tile',
      message: error.message
    });
  }
});

// List saved tiles endpoint
app.get('/api/tiles', (req, res) => {
  try {
    const files = fs.readdirSync(TILES_DIR)
      .filter(file => file.endsWith('.png'))
      .map(file => {
        const metadataFile = `${file}.json`;
        const metadataPath = path.join(TILES_DIR, metadataFile);

        let metadata = null;
        if (fs.existsSync(metadataPath)) {
          metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf-8'));
        }

        return {
          filename: file,
          metadata
        };
      });

    res.json({ tiles: files });
  } catch (error) {
    console.error('Error listing tiles:', error.message);
    res.status(500).json({
      error: 'Failed to list tiles',
      message: error.message
    });
  }
});

// Phase 3 - Tree detection endpoint (proxy to Python)
app.post('/api/detect-trees', upload.single('image'), async (req, res) => {
  try {
    console.log('🌳 Tree detection API called - proxying to Python');
    console.log('Parameters received:', {
      hue_min: req.body.hue_min,
      hue_max: req.body.hue_max,
      sat_min: req.body.sat_min,
      sat_max: req.body.sat_max,
      val_min: req.body.val_min,
      val_max: req.body.val_max,
      min_diameter: req.body.min_diameter,
      max_diameter: req.body.max_diameter,
      cluster_threshold: req.body.cluster_threshold,
      real_width: req.body.real_width,
      real_height: req.body.real_height,
      image_size: req.file?.size
    });

    // Validate image upload
    if (!req.file) {
      return res.status(400).json({
        error: 'No image uploaded',
        message: 'Please upload an image file'
      });
    }

    // Create FormData to forward to Python
    const formData = new FormData();

    // Add image file
    formData.append('image', req.file.buffer, {
      filename: req.file.originalname || 'image.png',
      contentType: req.file.mimetype
    });

    // Add all detection parameters
    formData.append('hue_min', req.body.hue_min);
    formData.append('hue_max', req.body.hue_max);
    formData.append('sat_min', req.body.sat_min);
    formData.append('sat_max', req.body.sat_max);
    formData.append('val_min', req.body.val_min);
    formData.append('val_max', req.body.val_max);
    formData.append('min_diameter', req.body.min_diameter);
    formData.append('max_diameter', req.body.max_diameter);
    formData.append('cluster_threshold', req.body.cluster_threshold);
    formData.append('real_width', req.body.real_width);
    formData.append('real_height', req.body.real_height);

    console.log('Forwarding request to Python backend...');

    // Forward to Python FastAPI
    const pythonResponse = await axios.post(
      `${PYTHON_API_URL}/detect-trees`,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
        timeout: 600000 // 10 minutes timeout for large tiles (4951m × 4886m needs ~65s)
      }
    );

    console.log('✅ Python detection successful:', {
      individualTrees: pythonResponse.data.summary?.individualTreesCount,
      clusters: pythonResponse.data.summary?.treeClustersCount,
      totalPopulated: pythonResponse.data.summary?.totalPopulatedTrees
    });

    // Return Python's response to frontend
    res.json(pythonResponse.data);

  } catch (error) {
    console.error('❌ Error in tree detection:', error.message);

    if (error.response) {
      // Python returned an error
      console.error('Python error response:', error.response.data);
      res.status(error.response.status).json({
        error: 'Tree detection failed',
        message: error.response.data.detail || error.response.data.error || error.message,
        pythonError: error.response.data
      });
    } else if (error.code === 'ECONNREFUSED') {
      // Python backend not running
      res.status(503).json({
        error: 'Python backend unavailable',
        message: 'Tree detection service is not running. Please start the Python backend on port 5001.',
        hint: 'Run: cd python_backend && python main.py'
      });
    } else {
      // Other error
      res.status(500).json({
        error: 'Internal server error',
        message: error.message
      });
    }
  }
});

// Phase 3.4 - 3D model generation endpoint
// Step 1: POST generates the OBJ and saves it on the Python server, returns JSON metadata
// Step 2: GET /api/download-model/:filename serves the file
app.post('/api/generate-model', async (req, res) => {
  try {
    console.log('🏗️ Generating 3D model from tree detection data...');

    if (!req.body) {
      return res.status(400).json({ error: 'No detection data provided' });
    }

    console.log('Detection data:', {
      individualTrees: req.body.individualTrees?.length || 0,
      clusters: req.body.treeClusters?.length || 0,
      totalPopulated: req.body.summary?.totalPopulatedTrees || 0
    });

    // Forward to Python - returns JSON metadata (not the file itself)
    const pythonResponse = await axios.post(
      `${PYTHON_API_URL}/generate-model`,
      req.body,
      {
        timeout: 600000,  // 10 minutes for large model generation
        maxBodyLength: Infinity,
        maxContentLength: Infinity
      }
    );

    console.log('✅ Model generated:', pythonResponse.data);
    res.json(pythonResponse.data);

  } catch (error) {
    console.error('❌ Model generation error:', error.message);

    if (error.response && error.response.data) {
      res.status(error.response.status).json({
        error: 'Model generation failed',
        message: error.response.data.detail || error.message
      });
    } else if (error.code === 'ECONNREFUSED') {
      res.status(503).json({
        error: 'Python backend unavailable',
        hint: 'Run: cd python_backend && python main.py'
      });
    } else {
      res.status(500).json({ error: 'Internal server error', message: error.message });
    }
  }
});

// Step 2: Download a generated model file (proxied from Python)
app.get('/api/download-model/:filename', async (req, res) => {
  try {
    const { filename } = req.params;
    console.log(`📥 Downloading model: ${filename}`);

    // Proxy the download from Python using a stream
    const pythonResponse = await axios.get(
      `${PYTHON_API_URL}/download-model/${encodeURIComponent(filename)}`,
      { responseType: 'stream', timeout: 600000 }
    );

    // Forward headers
    res.set({
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': pythonResponse.headers['content-disposition'] || `attachment; filename=${filename}`,
      'Content-Length': pythonResponse.headers['content-length'] || ''
    });

    // Pipe directly - no buffering
    pythonResponse.data.pipe(res);

  } catch (error) {
    console.error('❌ Download error:', error.message);
    if (error.response) {
      res.status(error.response.status).json({ error: 'Download failed', message: error.message });
    } else {
      res.status(500).json({ error: 'Download failed', message: error.message });
    }
  }
});

// Upload tree GLB to Forma and return blobId
app.post('/api/upload-tree-to-forma', async (req, res) => {
  try {
    console.log('🌳 Uploading tree GLB to Forma...');

    const { authContext } = req.body;

    // Get token from environment
    const BEARER_TOKEN = process.env.BEARER_TOKEN;

    if (!BEARER_TOKEN) {
      return res.status(400).json({ error: 'Bearer token not configured in .env' });
    }

    if (!authContext) {
      return res.status(400).json({ error: 'authContext (project ID) required' });
    }

    // Step 1: Request upload link from Forma
    console.log('Step 1: Requesting upload link from Forma...');
    const uploadLinkUrl = `https://aps.autodesk.com/api/forma/v1/integrate/upload-link?authcontext=${encodeURIComponent(authContext)}`;

    const linkResponse = await axios.get(uploadLinkUrl, {
      headers: {
        'Authorization': `Bearer ${BEARER_TOKEN}`,
        'Content-Type': 'application/json'
      }
    });

    const { uploadUrl, blobId } = linkResponse.data;
    console.log('✅ Got upload link, blobId:', blobId);

    // Step 2: Read GLB file
    console.log('Step 2: Reading GLB file...');
    const glbPath = path.join(__dirname, '..', 'python_backend', 'tree_model', 'tree_lowpoly.glb');

    if (!fs.existsSync(glbPath)) {
      return res.status(404).json({ error: 'GLB file not found', path: glbPath });
    }

    const glbBuffer = fs.readFileSync(glbPath);
    console.log('✅ GLB file read, size:', glbBuffer.length, 'bytes');

    // Step 3: PUT GLB to Forma storage
    console.log('Step 3: Uploading GLB to Forma storage...');
    await axios.put(uploadUrl, glbBuffer, {
      headers: {
        'Content-Type': 'application/octet-stream',
        'Content-Length': glbBuffer.length
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity
    });

    console.log('✅ GLB uploaded successfully!');

    res.json({
      success: true,
      blobId,
      message: 'GLB uploaded to Forma successfully'
    });

  } catch (error) {
    console.error('❌ Upload error:', error.message);

    if (error.response) {
      console.error('Forma API error:', error.response.status, error.response.data);
      res.status(error.response.status).json({
        error: 'Forma API error',
        message: error.response.data.message || error.message,
        details: error.response.data
      });
    } else {
      res.status(500).json({
        error: 'Upload failed',
        message: error.message
      });
    }
  }
});

// Get tree GLB file for frontend upload
app.get('/api/get-tree-glb', async (req, res) => {
  try {
    const glbPath = path.join(__dirname, '..', 'python_backend', 'tree_model', 'tree_lowpoly.glb');

    if (!fs.existsSync(glbPath)) {
      return res.status(404).json({ error: 'GLB file not found' });
    }

    res.setHeader('Content-Type', 'model/gltf-binary');
    res.setHeader('Content-Disposition', 'inline; filename=tree_lowpoly.glb');

    const glbBuffer = fs.readFileSync(glbPath);
    res.send(glbBuffer);

  } catch (error) {
    console.error('❌ Error serving GLB:', error);
    res.status(500).json({ error: 'Failed to read GLB file', message: error.message });
  }
});

// Get tree blobId from tree-blobid-result.json
app.get('/api/tree-blobid', (req, res) => {
  try {
    const blobIdPath = path.join(__dirname, 'tree-blobid-result.json');

    if (!fs.existsSync(blobIdPath)) {
      return res.status(404).json({
        error: 'BlobId file not found',
        message: 'Tree blobId has not been generated yet. Please upload the tree GLB first.'
      });
    }

    const blobIdData = JSON.parse(fs.readFileSync(blobIdPath, 'utf-8'));

    res.json({
      blobId: blobIdData.blobId,
      timestamp: blobIdData.timestamp,
      projectId: blobIdData.projectId,
      note: blobIdData.note
    });
  } catch (error) {
    console.error('Error reading blobId:', error.message);
    res.status(500).json({
      error: 'Failed to read blobId',
      message: error.message
    });
  }
});

// Proxy for Forma batch ingest API (to avoid CORS)
app.post('/api/forma/batch-ingest', async (req, res) => {
  try {
    const { items, projectId } = req.body;

    if (!items || !projectId) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'items and projectId are required'
      });
    }

    const token = process.env.BEARER_TOKEN;
    if (!token) {
      return res.status(500).json({
        error: 'Server configuration error',
        message: 'BEARER_TOKEN not configured'
      });
    }

    const batchUrl = `https://developer.api.autodesk.com/forma/integrate/v2alpha/elements/batch-ingest?authcontext=${projectId}`;

    console.log('🔄 Proxying batch ingest request to Forma API...');
    console.log('   URL:', batchUrl);
    console.log('   Items count:', items.length);

    const response = await axios.post(batchUrl, { items }, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      }
    });

    console.log('✅ Batch ingest successful');
    res.json(response.data);

  } catch (error) {
    console.error('❌ Batch ingest proxy error:', error.message);

    if (error.response) {
      console.error('   Status:', error.response.status);
      console.error('   Data:', error.response.data);
      res.status(error.response.status).json({
        error: 'Forma API error',
        message: error.response.data?.message || error.message,
        details: error.response.data
      });
    } else {
      res.status(500).json({
        error: 'Proxy error',
        message: error.message
      });
    }
  }
});

// TEST: Upload GLB to Forma storage
app.post('/api/test-upload-glb', async (req, res) => {
  try {
    console.log('🧪 TEST: Uploading tree GLB to Forma...');

    const { token, authContext } = req.body;

    if (!token || !authContext) {
      return res.status(400).json({
        error: 'Missing authentication',
        message: 'token and authContext are required'
      });
    }

    // 1. Request upload link from Forma
    console.log('Requesting upload link...');
    const linkResp = await axios.get(
      `https://aps.autodesk.com/api/forma/v1/integrate/upload-link?authcontext=${encodeURIComponent(authContext)}`,
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 10000
      }
    );

    const { uploadUrl, blobId } = linkResp.data;
    console.log('✅ Upload link received, blobId:', blobId);

    // 2. Read GLB file
    const glbPath = path.join(__dirname, '..', 'python_backend', 'tree_model', 'tree_lowpoly.glb');

    if (!fs.existsSync(glbPath)) {
      return res.status(404).json({
        error: 'GLB file not found',
        message: `File not found at: ${glbPath}`
      });
    }

    const glbBuffer = fs.readFileSync(glbPath);
    console.log('GLB file size:', glbBuffer.length, 'bytes');

    // 3. Upload to Forma
    console.log('Uploading to Forma storage...');
    await axios.put(uploadUrl, glbBuffer, {
      headers: { 'Content-Type': 'application/octet-stream' },
      maxBodyLength: Infinity,
      timeout: 30000
    });

    console.log('✅ GLB uploaded successfully');

    res.json({
      success: true,
      blobId,
      message: 'GLB uploaded to Forma'
    });

  } catch (error) {
    console.error('❌ Upload failed:', error.message);

    if (error.response) {
      console.error('Forma API error:', error.response.status, error.response.data);
      res.status(error.response.status).json({
        error: 'Upload failed',
        message: error.response.data?.message || error.message,
        details: error.response.data
      });
    } else {
      res.status(500).json({
        error: 'Upload failed',
        message: error.message
      });
    }
  }
});

// ==================== BLOBID CACHE MANAGEMENT ====================

const BLOBID_CACHE_FILE = path.join(__dirname, 'tree-blobid-cache.json');

/**
 * GET /api/blobid/:projectId
 * Check if we have a cached blobId for this project
 */
app.get('/api/blobid/:projectId', (req, res) => {
  try {
    const { projectId } = req.params;

    if (!fs.existsSync(BLOBID_CACHE_FILE)) {
      return res.json({ found: false, projectId });
    }

    const cache = JSON.parse(fs.readFileSync(BLOBID_CACHE_FILE, 'utf8'));

    if (cache[projectId]) {
      console.log(`✅ Found cached blobId for project ${projectId}`);
      return res.json({
        found: true,
        projectId,
        blobId: cache[projectId].blobId,
        timestamp: cache[projectId].timestamp,
        glbFile: cache[projectId].glbFile
      });
    }

    res.json({ found: false, projectId });

  } catch (error) {
    console.error('Error reading blobId cache:', error);
    res.status(500).json({ error: 'Failed to read cache', message: error.message });
  }
});

/**
 * POST /api/blobid
 * Save a new blobId for a project
 * Body: { projectId, blobId, glbFile }
 */
app.post('/api/blobid', (req, res) => {
  try {
    const { projectId, blobId, glbFile } = req.body;

    if (!projectId || !blobId) {
      return res.status(400).json({ error: 'Missing projectId or blobId' });
    }

    // Read existing cache or create new
    let cache = {};
    if (fs.existsSync(BLOBID_CACHE_FILE)) {
      cache = JSON.parse(fs.readFileSync(BLOBID_CACHE_FILE, 'utf8'));
    }

    // Add/update entry
    cache[projectId] = {
      blobId,
      timestamp: new Date().toISOString(),
      glbFile: glbFile || 'Henkel_tree.glb'
    };

    // Save to file
    fs.writeFileSync(BLOBID_CACHE_FILE, JSON.stringify(cache, null, 2));

    console.log(`💾 Cached blobId for project ${projectId}`);

    res.json({
      success: true,
      message: 'BlobId cached successfully',
      projectId,
      blobId
    });

  } catch (error) {
    console.error('Error saving blobId cache:', error);
    res.status(500).json({ error: 'Failed to save cache', message: error.message });
  }
});

/**
 * GET /api/blobid
 * Get all cached blobIds (for debugging)
 */
app.get('/api/blobid', (req, res) => {
  try {
    if (!fs.existsSync(BLOBID_CACHE_FILE)) {
      return res.json({ cache: {}, message: 'No cache file found' });
    }

    const cache = JSON.parse(fs.readFileSync(BLOBID_CACHE_FILE, 'utf8'));
    res.json({ cache, count: Object.keys(cache).length });

  } catch (error) {
    console.error('Error reading blobId cache:', error);
    res.status(500).json({ error: 'Failed to read cache', message: error.message });
  }
});

// ==================== TOKEN MANAGEMENT ====================

/**
 * POST /api/update-tokens
 * Update VITE_REFRESH_TOKEN and VITE_BEARER_TOKEN in .env file
 * Body: { access_token, refresh_token }
 */
app.post('/api/update-tokens', (req, res) => {
  try {
    const { access_token, refresh_token } = req.body;

    if (!access_token) {
      return res.status(400).json({ error: 'Missing access_token' });
    }

    const envPath = path.join(__dirname, '..', '.env');

    if (!fs.existsSync(envPath)) {
      return res.status(404).json({ error: '.env file not found' });
    }

    let envContent = fs.readFileSync(envPath, 'utf8');

    // Update VITE_BEARER_TOKEN
    if (envContent.includes('VITE_BEARER_TOKEN=')) {
      envContent = envContent.replace(
        /VITE_BEARER_TOKEN=.*/,
        `VITE_BEARER_TOKEN=${access_token}`
      );
    } else {
      envContent += `\nVITE_BEARER_TOKEN=${access_token}`;
    }

    // Update VITE_REFRESH_TOKEN if provided
    if (refresh_token) {
      if (envContent.includes('VITE_REFRESH_TOKEN=')) {
        envContent = envContent.replace(
          /VITE_REFRESH_TOKEN=.*/,
          `VITE_REFRESH_TOKEN=${refresh_token}`
        );
      } else {
        envContent += `\nVITE_REFRESH_TOKEN=${refresh_token}`;
      }
    }

    // Write back to .env
    fs.writeFileSync(envPath, envContent);

    console.log('✅ Tokens updated in .env file');

    res.json({
      success: true,
      message: 'Tokens updated successfully',
      updated: {
        access_token: true,
        refresh_token: !!refresh_token
      }
    });

  } catch (error) {
    console.error('Error updating tokens:', error);
    res.status(500).json({ error: 'Failed to update tokens', message: error.message });
  }
});

// ==================== AUTH ROUTES ====================
const { router: authRouter, checkAuthenticated } = require('./routes/auth');
app.use('/api', authRouter);
// ==================== DIRECTUS PROXY ROUTES (Protected) ====================
const directusService = require('./services/directus');

// ==================== FORMA PROJECT SYNC ENDPOINTS ====================

/**
 * POST /api/forma-project/sync
 * Called when user clicks "Get Project Info" - syncs project to Directus
 * Body: { formaProjectId, name, coordinates: [lon, lat], size: "4951m × 4886m" }
 */
app.post('/api/forma-project/sync', checkAuthenticated, async (req, res) => {
  try {
    const { formaProjectId, name, coordinates, size } = req.body;

    if (!formaProjectId) {
      return res.status(400).json({ error: 'formaProjectId is required' });
    }

    console.log('=== SYNCING FORMA PROJECT ===');
    console.log('Forma Project ID:', formaProjectId);
    console.log('Project Name:', name);
    console.log('User:', req.user.email);
    console.log('Coordinates:', coordinates);
    console.log('Size:', size);

    // Get user's Directus ID
    const user = await directusService.getUserByEmail(req.user.email);
    if (!user) {
      return res.status(404).json({ error: 'User not found in Directus' });
    }

    // Upsert project and link user
    const result = await directusService.upsertProject(
      { formaProjectId, name, coordinates, size },
      user.id
    );

    console.log('✅ Project sync result:', {
      projectId: result.project?.id,
      isNew: result.isNew,
      userLinked: result.userLinked
    });

    res.json({
      success: true,
      project: result.project,
      isNew: result.isNew,
      userLinked: result.userLinked,
      message: result.isNew 
        ? 'New project created and linked to user' 
        : 'Existing project linked to user'
    });

  } catch (error) {
    console.error('❌ Error syncing Forma project:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/forma-project/check/:formaProjectId
 * Check if a Forma project exists in Directus
 */
app.get('/api/forma-project/check/:formaProjectId', checkAuthenticated, async (req, res) => {
  try {
    const { formaProjectId } = req.params;
    const project = await directusService.getProjectByFormaId(formaProjectId);

    res.json({
      exists: !!project,
      project: project || null
    });

  } catch (error) {
    console.error('Error checking project:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/my-projects
 * Get all projects for the authenticated user
 */
app.get('/api/my-projects', checkAuthenticated, async (req, res) => {
  try {
    console.log('=== FETCHING USER PROJECTS ===');
    console.log('User:', req.user.email);

    const projects = await directusService.getUserProjects(req.user.email);

    console.log('✅ Found', projects.length, 'projects for user');

    res.json({
      success: true,
      projects: projects,
      count: projects.length
    });

  } catch (error) {
    console.error('❌ Error fetching user projects:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== LEGACY DIRECTUS PROJECT ROUTES ====================

// Get projects for user
app.get('/api/directus/projects', checkAuthenticated, async (req, res) => {
  try {
    const projects = await directusService.getUserProjects(req.user.email);
    res.json(projects);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Create project
app.post('/api/directus/projects', checkAuthenticated, async (req, res) => {
  try {
    const project = await directusService.createProject(req.body);
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Get single project
app.get('/api/directus/projects/:id', checkAuthenticated, async (req, res) => {
  try {
    const project = await directusService.getProject(req.params.id);
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Update project
app.patch('/api/directus/projects/:id', checkAuthenticated, async (req, res) => {
  try {
    const project = await directusService.updateProject(req.params.id, req.body);
    res.json(project);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Delete project
app.delete('/api/directus/projects/:id', checkAuthenticated, async (req, res) => {
  try {
    await directusService.deleteProject(req.params.id);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ==================== SERVE REACT APP ====================
// Serve built React app from dist folder (for production-like setup)
// This must come AFTER all API routes
// In Docker, dist is at /app/dist (same folder as index.js)
// In local dev, dist is at ../dist (parent folder)
const distPath = process.env.NODE_ENV === 'production' 
  ? path.join(__dirname, 'dist')      // Docker: /app/dist
  : path.join(__dirname, '../dist');  // Local: ../dist
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  
  // For any route that's not an API or static file, serve the React app
  // This enables client-side routing
  app.get('*', (req, res, next) => {
    // Don't serve index.html for API routes or existing static files
    if (req.path.startsWith('/api') || req.path.endsWith('.html')) {
      return next();
    }
    res.sendFile(path.join(distPath, 'index.html'));
  });
  
  console.log('✅ Serving React app from dist/');
} else {
  console.log('⚠️ dist/ folder not found. Run "npm run build" to build the React app.');
}

const HOST = '0.0.0.0';              // <— add this
app.listen(PORT, HOST, () => {       // <— bind to 0.0.0.0
  console.log(`Backend server running on http://${HOST}:${PORT}`);
  console.log(`Tiles directory: ${TILES_DIR}`);
  console.log(`Segmentation directory: ${SEGMENTATION_DIR}`);
});
