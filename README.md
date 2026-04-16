# Forma Tree Detection Extension

A React-based **Forma embedded extension** that detects trees automatically identified using OpenCV from satellite imagery and place them as 3D models directly into your Forma project.

> **Important:** This application is designed to run as an **embedded extension inside Autodesk Forma**. It will not work as a standalone web application. See the [Forma Embedded Views documentation](https://aps.autodesk.com/en/docs/forma/v1/embedded-views/introduction/) to learn how to create and host Forma extensions.

![Forma Extension](./public/project_page.png)

## Overview

This extension automates the process of detecting and placing trees in Forma projects:

1. **Fetches satellite imagery** aligned with Forma's UTM coordinate system
2. **Detects trees** using HSV color segmentation
3. **Calculates tree dimensions** (diameter and height) from detected canopy sizes
4. **Places 3D tree models** directly into your Forma project using batch placement
5. **Scales trees automatically** based on detected diameter (realistic proportions)

### Key Capabilities

| Feature | Description |
|---------|-------------|
| **Automatic Tree Detection** | Satellite imagery analysis to find trees |
| **Per-Tree Scaling** | Each tree is scaled based on its detected canopy diameter |
| **High-Performance Placement** | ~3,000 trees in ~10 seconds using batch `updateElements` API |
| **Extended Coverage** | Detect trees beyond Forma's ~2km terrain limit |
| **User Authentication** | Directus-based auth with project tracking |
| **Large OBJ Export** | Two-step streaming download — handles 242MB+ models |
| **Project Management** | Track and manage your Forma projects |

![Tree Placement in Action](public/TreePlacement.gif)

## Architecture Overview

```
+---------------------------------------------------------------------+
|                         FORMA (Host Application)                    |
|  +---------------------------------------------------------------+  |
|  |                    Embedded Extension (iframe)                |  |
|  |  +---------------------------------------------------------+  |  |
|  |  |              React Frontend (Vite + TypeScript)         |  |  |
|  |  |   - Tree Detection UI    - Satellite Tile Viewer        |  |  |
|  |  |   - Project Management   - User Menu & Navigation       |  |  |
|  |  +---------------------------------------------------------+  |  |
|  +---------------------------------------------------------------+  |
+---------------------------------------------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|                    Express Backend (Node.js)                        |
|  - Authentication (Directus integration)                            |
|  - Session management                                               |
|  - API proxy to Python backend                                      |
|  - Serves React static files in production                          |
|  - Streams large OBJ downloads from Python to client                |
|  Port: 3001                                                         |
+---------------------------------------------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|                    Python Backend (FastAPI)                         |
|  - Tree detection (OpenCV + HSV segmentation)                       |
|  - 3D model generation (OBJ export to temp files)                   |
|  - Model download endpoint (FileResponse streaming)                 |
|  - Image processing                                                 |
|  Port: 5001                                                         |
+---------------------------------------------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------+
|                    Directus (External CMS)                          |
|  - User authentication & management                                 |
|  - Project tracking database                                        |
|  - User-project relationships                                       |
+---------------------------------------------------------------------+
```

## Technical Stack

| Layer | Technology |
|-------|------------|
| **Frontend** | React 19 + TypeScript + Vite |
| **Forma Integration** | `forma-embedded-view-sdk/auto` |
| **Backend (API)** | Node.js + Express |
| **Backend (Detection)** | Python + FastAPI + OpenCV |
| **Authentication** | Directus CMS (or local auth for testing) |
| **Coordinate Transforms** | proj4 |
| **Map Provider** | Mapbox Raster Tiles API |
| **Containerization** | Docker + Docker Compose |

## Prerequisites

- **Docker** and **Docker Compose** (recommended for easy setup)
- **Mapbox Access Token** ([Get one here](https://account.mapbox.com/))
- **Forma Account** with embedded view access
- **Directus Instance** (for authentication) OR use local auth for testing

### For Local Development (without Docker)

- Node.js 18+
- Python 3.11+
- npm or yarn

## Installation & Setup

### Option 1: Docker (Recommended)

The easiest way to run the application is using Docker containers.

**1. Clone the repository:**
```bash
git clone https://github.com/henn-dt/forma-extension-trees.git
cd forma-extension-trees
```

**2. Create environment file:**

Copy `.env.example` to `.env` and fill in your values:
```bash
cp .env.example .env
```

Edit `.env` with your credentials:
```bash
# Required
VITE_MAPBOX_TOKEN=your_mapbox_token_here
DIRECTUS_URL=https://your-directus-instance.com
DIRECTUS_STATIC_TOKEN=your_directus_token

# Optional (defaults provided)
SESSION_SECRET=your-secure-random-string
```

**3. Build and start containers:**
```bash
docker-compose up --build
```

Or run in background:
```bash
docker-compose up -d
```

**4. Access the application:**
- Backend + Frontend: http://localhost:3001
- Python API Docs: http://localhost:5001/docs

**5. Stop containers:**
```bash
docker-compose down
```

#### Linking to Autodesk Forma

Once the service is running, you need to register it as an embedded view in your Forma project:

1. Go to the [Autodesk Forma Extensions page](https://aps.autodesk.com/en/docs/forma/v1/embedded-views/introduction/) for full documentation.
2. In your Forma project, open **Extensions** from the left sidebar.
3. Click **Add Extension** and select **Embedded View**.
4. Enter your extension URL:
   - **Local development:** `http://localhost:3001`
   - **Production:** your deployed URL (e.g. `https://webapps.henn.com/forma-tree`)
5. Give it a name (e.g. "Tree Detection") and save.
6. The extension will now appear in Forma's right-side panel.

For a step-by-step walkthrough, see the official tutorial: [Creating Embedded Views in Forma](https://tutorials.autodesk.com/courses/forma-extensions-tutorial).

> **Note:** For production deployments served over HTTPS inside Forma's iframe, make sure `ALLOWED_ORIGINS` in your `.env` includes Forma's origin (e.g. `https://app.autodeskforma.eu`) and that session cookies are configured with `SESSION_COOKIE_SECURE=true` and `SESSION_COOKIE_SAMESITE=none`.

### Option 2: Local Development

**1. Clone and install dependencies:**
```bash
git clone https://github.com/henn-dt/forma-extension-trees.git
cd forma-extension-trees

# Frontend dependencies
npm install

# Backend dependencies
cd backend && npm install && cd ..

# Python dependencies
cd python_backend
pip install -r requirements.txt
cd ..
```

**2. Set up environment files:**

Root `.env`:
```bash
VITE_MAPBOX_TOKEN=your_mapbox_token_here
DIRECTUS_URL=https://your-directus-instance.com
```

Backend `.env` (copy from `backend/.env.example`):
```bash
DIRECTUS_URL=https://your-directus-instance.com
DIRECTUS_STATIC_TOKEN=your_directus_token
SESSION_SECRET=your-secret-key
```

**3. Start all services:**

Terminal 1 - Python Backend:
```bash
cd python_backend
python main.py
```

Terminal 2 - Express Backend:
```bash
cd backend
npm start
```

Terminal 3 - React Frontend:
```bash
npm run dev
```

## Authentication System

This extension uses **Directus** as the authentication and project management backend. Users must log in before accessing the tree detection features.

### Authentication Flow

![Registration Page](./public/auth-reg.png)
*New users can register with email and password. If a data protection policy URL is configured at runtime, the registration page shows a mandatory consent checkbox linked to that URL. If no policy URL is configured, signup works without the checkbox.*

![Login Page](./public/auth-page.png)
*Existing users log in with their credentials. Password fields include a visibility toggle.*

![Welcome Page](./public/auth-welcome.png)
*After login, users see a welcome page before entering the app*

### User Menu & Projects Panel

Once logged in, users have access to a dropdown menu:

![User Menu](./public/menu1.png)

The menu provides:
- **User Information** - View your account details
- **My Projects** - Opens a slide-in drawer panel showing all Forma projects you've worked on
- **Logout** - Sign out of the application

### Project Tracking

The extension automatically logs Forma projects to Directus when you click "Get Project Info". This creates a history of all projects you've worked on, including:
- Project ID and name
- Geographic location (coordinates)
- Terrain dimensions
- SRID and timezone
- Last accessed date

### Alternative: Local Authentication (For Testing)

If you don't have a Directus instance, you can use the local authentication template:

**[Henn Auth Template](https://github.com/ABCHai25/Henn_Auth_Template)**

This provides a simple local auth system for development and testing purposes.

### Known Limitation: Directus Vendor Lock-in

> **Future Work:** The current authentication and project tracking system is tightly coupled to **Directus CMS**. This means anyone who clones the repo must set up and configure a Directus instance before the auth features work at all — a significant barrier for contributors and new team members.
>
> **Planned:** Replace the Directus dependency with a local **SQLite** database as an automatic fallback. When `DIRECTUS_URL` is not set in `.env`, the backend will auto-create a local database file and use that instead, with zero additional configuration. Directus would remain fully supported for production deployments.
>
> Until this is implemented, see the [Henn Auth Template](https://github.com/ABCHai25/Henn_Auth_Template) alternative above, or contribute to this effort by opening a pull request.

## Usage Guide

### Step 1: Authentication

1. Navigate to `http://localhost:3001` (or your deployed URL)
2. **New users:** Click "Register" and fill in your details (and accept data policy checkbox only if policy is configured)
3. **Existing users:** Enter your email and password to log in
4. Click "Enter Application" on the welcome page

### Step 2: Get Project Information

![Project Tile Tab](./public/project_page.png)

1. Click **"Get Project Info"** to retrieve Forma project metadata and terrain boundaries
2. Click **"Fetch Mapbox Tile"** to fetch satellite imagery

The extension automatically:
- Calculates optimal zoom level for your project size
- Fetches high-resolution raster tiles
- Applies perspective correction for UTM alignment
- Logs the project to your Directus account

### Step 3: Extend Coverage (Optional)

![Extended Tile Tab](./public/project_page2.png)

Forma limits terrain to ~2km x 2km. To detect trees beyond this limit:

1. Go to the **"Extend Project"** tab
2. Enter extension distances in meters (North, East, South, West)
3. Click **"Fetch Extended Tile"**

### Step 4: Detect Trees

![Tree Detection](./public/project_page3a.png)

1. Go to the **"Tree Detection"** tab
2. Select your tile source (Project Tile or Extended Tile)
3. Adjust HSV thresholds if needed for your imagery
4. Click **"Detect Trees"**

![Detection Results](./public/project_page3b.png)

Results show:
- Number of trees detected
- Individual tree coordinates
- Estimated diameters and heights
- Elevation of each tree (fetched concurrently with retry logic)

### Step 5: Place Trees in Forma

1. Review detected trees in the list
2. Adjust the **density slider** to control what percentage of detected trees to place
3. Click **"Place Trees"**

Trees are placed using the **batch `updateElements` API** for maximum performance:
- Single 3D model definition uploaded once
- All instances sent in batches of 500 operations
- ~3,000 trees placed in ~10 seconds
- Each tree scaled according to its detected diameter
- Trees with invalid elevation (NaN or zero) are automatically excluded

### Step 6: Export Options

- **Download OBJ** - 3D model with all detected trees (uses a two-step generate + streaming download, supports files over 242MB)
- **Download JSON** - Raw detection data with coordinates

## How It Works

### Satellite Imagery Pipeline

1. **Coordinate Transformation**: Convert Forma's UTM terrain bounds to WGS84 (lat/lon) using proj4
2. **Zoom Calculation**: Determine optimal tile resolution (~0.6-0.8 m/pixel at zoom 18)
3. **Tile Fetching**: Download grid of 512x512px Mapbox raster tiles
4. **Stitching & Cropping**: Combine tiles and crop to exact boundaries
5. **Perspective Warping**: Apply homography to correct Web Mercator to UTM distortions

### Tree Detection Algorithm

The Python backend uses **HSV color segmentation**:
1. Convert satellite image to HSV color space
2. Apply threshold masks to isolate green vegetation
3. Find contours of tree canopies
4. Calculate centroid and diameter for each tree
5. Return coordinates in both pixels and meters

### OBJ Model Generation (Two-Step Export)

Large tree models (20k+ trees, 242MB+) are handled with a two-step architecture:

1. **`POST /api/generate-model`** — sends detection data to the Python backend, which generates the OBJ file, saves it to a temp directory, and returns JSON metadata (filename, file size, tree/vertex/face counts).
2. **`GET /api/download-model/:filename`** — Express streams the file from Python directly to the browser with no in-memory buffering, allowing reliable downloads of very large files.

### Batch Tree Placement

Instead of placing trees one at a time (slow), we use Forma's **batch `updateElements` API**:

```
One-at-a-time:  3,000 trees ~ 17 minutes  (slow)
Batch mode:     3,000 trees ~ 10 seconds   (fast)
```

Operations are built upfront as an array of placement commands, then sent in sequential batches of 500. At 100% density, trees are shuffled randomly before placement to avoid spatial bias.

### Elevation Fetching

Tree elevations are fetched from Forma's terrain data using two strategies:

- **1,500 trees or fewer**: Direct fetch via `Forma.terrain.getElevationAt()` per tree
- **More than 1,500 trees**: Grid interpolation — a 10x10 elevation grid is fetched concurrently (15 parallel workers, up to 3 retries per point with 100/200/300ms backoff), then individual tree elevations are bilinearly interpolated from the grid

### Per-Tree Scaling

Each tree is scaled based on its detected canopy diameter:
- **Diameter** = measured from satellite imagery (meters)
- **Height** = diameter x 1.5 (realistic proportion)
- **Scale factor** = calculated to match the base tree model (12m tall)

This creates natural variation in tree sizes across your project.

### Extended Tile Feature

The "Extend Project" feature allows coverage beyond Forma's terrain limits:
1. User specifies extension distances (meters) in each direction
2. New bounding box is calculated (original + extensions)
3. Larger satellite tile is fetched and processed
4. Trees can be detected across the entire extended area and exported as OBJ

### Continuous Integration (GHCR Builds)

Every push to the `main` branch triggers `.github/workflows/build-ghcr.yml`, a GitHub Actions workflow that automatically:
1. Builds the React/Express image from `Dockerfile`
2. Builds the Python FastAPI image from `python_backend/Dockerfile`
3. Tags both images (commit SHA + `latest` on main)
4. Pushes them to GitHub Container Registry (`ghcr.io`)

#### Required Repository Secrets

Add these secrets under **GitHub Repo > Settings > Secrets and variables > Actions**:

| Secret | Description |
|--------|-------------|
| `GHCR_PAT` | Personal access token with `write:packages` scope to push images to GHCR |
| `VITE_MAPBOX_TOKEN` | Mapbox access token passed to the frontend during Docker builds |

Once configured, simply `git push origin main` to publish fresh container images without any local Docker commands.

## Project Structure

```
forma-extension-trees/
├── src/
│   ├── App.tsx                        # Main application with tab navigation
│   ├── App.css                        # App styles + font-face declarations
│   ├── index.css                      # Global styles (light theme)
│   ├── components/
│   │   ├── ActionButtons.tsx          # Project info & fetch buttons
│   │   ├── ExtendProjectPanel.tsx     # Extended tile controls
│   │   ├── MapboxTilePanel.tsx        # Satellite tile display
│   │   ├── TreeListPanel.tsx          # Detection results & OBJ export
│   │   ├── TreePlacementTester.tsx    # Batch placement with density control
│   │   ├── ModelResultPanel.tsx       # Download result metadata
│   │   ├── UserMenu.tsx              # User dropdown menu
│   │   └── MyProjectsPanel.tsx        # Slide-in projects drawer
│   ├── hooks/
│   │   ├── useFormaProject.ts         # Project metadata management
│   │   ├── useMapboxTile.ts           # Tile fetching & warping
│   │   └── useTreePipeline.ts         # Detection pipeline
│   ├── services/
│   │   ├── directus.service.ts        # Directus API client
│   │   ├── elevation.service.ts       # Concurrent elevation fetching
│   │   ├── modelGeneration.service.ts # Two-step OBJ generate + download
│   │   └── ...
│   ├── fonts/
│   │   ├── NBGROTESK-REGULAR.OTF     # Custom font (bundled by Vite)
│   │   └── NBGROTESK-BOLD.OTF        # Custom font (bundled by Vite)
│   └── main.tsx                       # Entry point (Forma iframe check)
├── backend/
│   ├── index.js                       # Express server + download proxy
│   ├── auth-setup.js                  # Authentication configuration
│   ├── passport-config.js             # Passport.js setup
│   ├── routes/                        # API routes
│   │   └── auth.js                    # Auth endpoints
│   ├── services/
│   │   ├── directus.js                # Directus integration
│   │   └── email.js                   # Email service
│   └── middleware/                     # Express middleware
├── python_backend/
│   ├── main.py                        # FastAPI server + download endpoint
│   ├── Dockerfile                     # Python container
│   ├── tree_detector_core.py          # Detection algorithm
│   └── model_generator_core.py        # OBJ generation (temp file output)
├── .github/
│   └── workflows/
│       └── build-ghcr.yml             # CI workflow (build & push images)
├── public/
│   ├── login.html                     # Login page (with password toggle)
│   ├── register.html                  # Registration page (conditional policy consent)
│   ├── welcome.html                   # Welcome page
│   └── forgot-password.html           # Password reset (placeholder)
├── Dockerfile                         # Backend + Frontend container
├── docker-compose.yml                 # Container orchestration
├── docker-compose.production.yml      # Production with nginx
├── nginx.conf                         # Production proxy (port 8012)
├── .env.example                       # Environment template
└── README.md
```

## Environment Variables

### Root `.env`
```bash
# Required
VITE_MAPBOX_TOKEN=pk.xxx              # Mapbox API token (baked into frontend build)
DIRECTUS_URL=https://your-instance    # Directus URL
DIRECTUS_STATIC_TOKEN=xxx             # Directus API token
SESSION_SECRET=your-secure-secret     # Session encryption key

# Required for production (Forma iframe)
ALLOWED_ORIGINS=https://app.autodeskforma.eu  # Comma-separated CORS origins
SESSION_COOKIE_SECURE=true            # Must be true for HTTPS
SESSION_COOKIE_SAMESITE=none          # Must be 'none' for cross-origin iframe

# Optional
PYTHON_API_URL=http://localhost:5001  # Default Python backend URL
NODE_ENV=production                   # Set in Docker
PORT=3001

# Optional: External data policy URL
# If set to a valid http/https URL -> registration shows mandatory consent checkbox with that link
# If unset/invalid                  -> consent checkbox hidden
# DATA_POLICY_URL=https://www.henn.com/privacy-policy
```

### Optional External Data Protection Policy URL

Configure the backend to link users to an existing externally hosted policy page:

1. Host your policy page on an existing website.
2. Set `DATA_POLICY_URL` in your runtime environment.

Sample (`docker-compose.production.yml`):

```yaml
forma-trees-backend:
  environment:
    - DATA_POLICY_URL=https://www.henn.com/privacy-policy
```

Behavior:
- `DATA_POLICY_URL` set and valid (`http`/`https`):
  - Register page shows mandatory consent checkbox
- `DATA_POLICY_URL` unset or invalid:
  - Register page hides checkbox and allows signup

## Docker Commands

```bash
# Build and start all services
docker-compose up --build

# Start in background
docker-compose up -d

# View logs
docker-compose logs -f

# View specific service logs
docker-compose logs -f backend
docker-compose logs -f python-api

# Stop all services
docker-compose down

# Rebuild specific service
docker-compose build backend
docker-compose build python-api
```

## Performance

| Operation | Time |
|-----------|------|
| Tile fetching (2km bbox) | 2-20 seconds |
| Tree detection (standard) | 2-5 seconds |
| Tree detection (5km extended) | 60-120 seconds |
| Tree placement (3,000 trees) | ~10 seconds |
| Elevation fetch (grid, >1500 trees) | ~2.5 minutes |

### Limits

| Item | Limit |
|------|-------|
| Maximum recommended extended tile | 5km x 5km |
| Maximum trees per placement batch | 3,000 |
| Maximum trees for OBJ export | 60,000 |
| Detection timeout | 10 minutes |
| Model generation timeout | 10 minutes |
| File upload / request body | 50 MB |

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/detect-trees` | Detect trees from uploaded satellite image |
| `POST` | `/api/generate-model` | Generate OBJ model, returns JSON metadata |
| `GET` | `/api/download-model/:filename` | Stream generated OBJ file to browser |
| `POST` | `/api/login` | Authenticate user |
| `POST` | `/api/register` | Create new user account |
| `GET` | `/api/user` | Get current user info |
| `POST` | `/api/logout` | End session |
| `GET` | `/health` | Health check (Express + Python) |

## Troubleshooting

| Issue | Solution |
|-------|----------|
| CORS errors on tile fetch | Check Mapbox token is set in `.env` |
| CORS errors in Forma iframe | Add Forma origin to `ALLOWED_ORIGINS` and set `SESSION_COOKIE_SAMESITE=none` |
| "DIRECTUS_URL missing" | Add `DIRECTUS_URL` to your `.env` file |
| Container unhealthy | Run `docker-compose logs` to check errors |
| Trees not detected | Adjust HSV thresholds for your imagery |
| OBJ download fails for large files | Should now work with streaming — check Python temp dir has disk space |
| Only partial trees placed | Trees with invalid elevation (NaN/zero) are excluded — check terrain coverage |

## Additional Resources

- **Forma Embedded Views:** https://aps.autodesk.com/en/docs/forma/v1/embedded-views/introduction/
- **Forma Extensions Tutorial:** https://tutorials.autodesk.com/courses/forma-extensions-tutorial
- **Mapbox Raster Tiles:** https://docs.mapbox.com/api/maps/raster-tiles/
- **proj4 Documentation:** http://proj4.org/

## Contributing

Contributions welcome! To contribute:

1. Fork the repository
2. Create feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit changes (`git commit -m 'Add AmazingFeature'`)
4. Push to branch (`git push origin feature/AmazingFeature`)
5. Open Pull Request

## License

MIT License - see LICENSE file for details

---

*Last Updated: 12 April 2026*
