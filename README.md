# Crop Stress Detection — Geospatial Data Pipeline

A Python data pipeline that builds a real geospatial crop-monitoring grid over
an agricultural area using satellite imagery and elevation data from the
Copernicus Data Space Ecosystem.

> **This pipeline produces measurements, not diagnoses.**
> Low NDVI values may indicate bare soil, fallow fields, recent harvest,
> water bodies, or many other conditions — not exclusively crop disease.
> The system does **not** diagnose disease from NDVI alone.

---

## Application Architecture & Flow Diagram

The diagram below shows the end-to-end flow between the farmer-facing interface, field and crop inspection tools, geospatial processing pipeline, application services, and speech/AI services.

```mermaid
flowchart TD
    classDef actor fill:#ede9fe,stroke:#8b5cf6,stroke-width:1.5px,color:#3b0764
    classDef ui fill:#dbeafe,stroke:#3b82f6,stroke-width:1.5px,color:#1e3a8a
    classDef geo fill:#dcfce7,stroke:#22c55e,stroke-width:1.5px,color:#14532d
    classDef service fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef access fill:#ffe4e6,stroke:#f43f5e,stroke-width:1.5px,color:#881337
    classDef store fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f

    Farmer(("Farmer / Agronomist")):::actor

    subgraph FieldCropUI["Field and Crop UI"]
        AppRouter["App Router [App.tsx]"]:::ui
        LandInspection["Land Inspection"]:::ui
        CropInspection["Crop Inspection"]:::ui
        Canvas3D["3D Field Canvas [ThreeCanvas.tsx]"]:::ui
        CellInspector["Cell Inspector [CellInspector.tsx]"]:::ui
        LayerControls["Layer Controls [LayerToggle.tsx]"]:::ui
        FieldInfo["Field Information [InfoPanel.tsx]"]:::ui
        StressAnalysis["Stress Analysis"]:::ui
        VoiceRecorder["Voice Recorder [wavRecorder.ts]"]:::ui
        TerrainScene["Terrain Scene [TerrainScene.ts]"]:::ui
        CropRenderer["Crop Renderer [CropRenderer.ts]"]:::ui
        StressLayer["Stress Layer [StressRiskLayer.ts]"]:::ui
        GridOverlay["Grid Overlay [GridOverlay.ts]"]:::ui
    end

    subgraph GeoPipeline["Geospatial Pipeline"]
        ImageryDownload["Imagery Download"]:::geo
        ElevationDownload["Elevation Download [05_download_dem.py]"]:::geo
        NDVI["NDVI Calculation"]:::geo
        TerrainDerivation["Terrain Derivation"]:::geo
        GridConstruction["Grid Construction [07_create_grid.py]"]:::geo
        StressEnrichment["Stress Enrichment"]:::geo
    end

    subgraph ConfigAccess["Configuration and Access"]
        Settings["Pipeline Settings [settings.py]"]:::access
        OAuth["Copernicus OAuth [auth.py]"]:::access
    end

    Sentinel[("Sentinel-2 Imagery")]:::store
    DEM[("Copernicus DEM")]:::store

    subgraph AppServices["Application Services"]
        API["Application API [server.py]"]:::service
        ProcessedGrid[("Processed Grid Data [server.py]")]:::store
        DiagnosticEngine["Diagnostic Engine"]:::service
    end

    Sarvam["Sarvam Speech API"]:::geo
    Groq["Groq API"]:::geo

    Farmer -->|"uses"| AppRouter
    AppRouter -->|"routes to"| LandInspection
    AppRouter -->|"routes to"| CropInspection

    LandInspection -->|"renders"| Canvas3D
    LandInspection -->|"renders"| CellInspector
    LandInspection -->|"renders"| LayerControls
    LandInspection -->|"renders"| FieldInfo
    LandInspection -->|"renders"| StressAnalysis
    CropInspection -.->|"records audio"| VoiceRecorder

    Canvas3D -->|"creates"| TerrainScene
    Canvas3D -->|"uses"| CropRenderer
    Canvas3D -->|"uses"| StressLayer
    Canvas3D -->|"uses"| GridOverlay

    ImageryDownload -->|"downloads imagery"| Sentinel
    ElevationDownload -->|"downloads elevation"| DEM
    Settings -->|"uses settings"| ImageryDownload
    Settings -->|"uses settings"| ElevationDownload
    Settings -->|"provides credentials"| OAuth
    OAuth -->|"authorizes access"| ImageryDownload
    OAuth -->|"authorizes access"| ElevationDownload

    ImageryDownload -->|"provides imagery"| NDVI
    ElevationDownload -->|"provides elevation"| TerrainDerivation
    NDVI -->|"defines grid template"| GridConstruction
    TerrainDerivation -->|"provides terrain measures"| GridConstruction
    GridConstruction -->|"enriches grid"| StressEnrichment
    GridConstruction -->|"produces grid layers"| ProcessedGrid
    StressEnrichment -->|"updates grid layers"| ProcessedGrid

    Canvas3D -->|"fetches grid and terrain"| API
    API -->|"reads processed data"| ProcessedGrid
    StressAnalysis -.->|"requests investigations"| API
    API -->|"starts investigations"| DiagnosticEngine
    DiagnosticEngine -.->|"requests language assistance"| Groq
    API -->|"sends speech requests"| Sarvam
```

---

## Data Sources

### Sentinel-2 L2A (Multispectral Imagery)

| Band | Name | Resolution | Usage |
|------|------|------------|-------|
| B04 | Red | 10 m | NDVI calculation (reflectance) |
| B08 | NIR | 10 m | NDVI calculation (reflectance) |
| SCL | Scene Classification Layer | 20 m → 10 m (nearest-neighbor) | Cloud/shadow masking |

- **Collection:** `sentinel-2-l2a` (Level-2A, atmospherically corrected)
- **Units:** `REFLECTANCE` (physical reflectance, 0–1 range, no arbitrary scaling)
- **Source:** [Copernicus Data Space Sentinel Hub](https://dataspace.copernicus.eu/)

### NDVI Formula

```
NDVI = (B08 - B04) / (B08 + B04)
```

- Range: −1 to +1 (physically meaningful)
- Division by zero → `NaN` (not replaced with arbitrary values)
- Cloud-masked pixels → `NaN`

### SCL Cloud Masking

Pixels with the following SCL classes are **excluded** (set to NaN):

| SCL | Class | Action |
|-----|-------|--------|
| 0 | No data | Excluded |
| 1 | Saturated / defective | Excluded |
| 2 | Dark area | Excluded |
| 3 | Cloud shadow | Excluded |
| 7 | Unclassified | Excluded |
| 8 | Cloud (medium probability) | Excluded |
| 9 | Cloud (high probability) | Excluded |
| 10 | Thin cirrus | Excluded |
| 11 | Snow / ice | Excluded |
| **4** | **Vegetation** | **Kept** |
| **5** | **Bare soil** | **Kept** |
| **6** | **Water** | **Kept** |

### Copernicus DEM (Elevation)

- **Preferred:** COPERNICUS_30 (30 m global DEM)
- **Fallback:** COPERNICUS_90 (90 m) — used automatically if 30 m access is denied
- **Slope:** Derived from DEM using `numpy.gradient` with real-world pixel spacing from the GeoTIFF geotransform (not arbitrary pixel indices)

---

## Area of Interest (AOI)

| Parameter | Value |
|-----------|-------|
| Location | Nashik district, Maharashtra (agricultural test area) |
| Bounding box | `[73.9300, 20.0000, 73.9400, 20.0100]` (EPSG:4326) |
| Approximate size | ~1.1 km × 1.1 km |
| Grid CRS | EPSG:32643 (UTM zone 43N) |

The AOI is configurable in `config/settings.py`. Replace with an actual field
polygon when available.

---

## Coordinate Reference System (CRS)

All geospatial processing uses a **projected CRS** (UTM) for accurate
metre-based distance calculations:

- **AOI input:** EPSG:4326 (WGS84 lat/lon)
- **Raster processing:** EPSG:32643 (UTM zone 43N) — auto-detected from AOI centroid
- **Grid construction:** UTM (cells in metres, aligned to Sentinel-2 pixel grid)
- **GeoJSON output:** EPSG:4326 (for compatibility with web maps)

Grid cells are **not** created by dividing latitude/longitude into arbitrary
rows and columns. They are aligned pixel-for-pixel to the Sentinel-2 10 m
raster.

---

## Grid Methodology

1. The NDVI raster (10 m, UTM) defines the grid template
2. Each grid cell corresponds to one Sentinel-2 pixel
3. Elevation and slope are sampled at each cell centre via nearest-neighbor from the coarser DEM raster
4. Cell centres and corners are reprojected to WGS84 for the GeoJSON output
5. Cells with no valid NDVI data are marked `"valid": false` — never filled with zeros or averages

---

## Setup

### Prerequisites

- Python 3.11+
- A Sentinel Hub account on [Copernicus Data Space](https://dataspace.copernicus.eu/)
- OAuth Client ID and Client Secret (create at the Sentinel Hub Dashboard)

### Install Dependencies

```bash
pip install -r requirements.txt
```

### Configure Credentials

1. Copy the template:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your credentials:
   ```
   CLIENT_ID=your-sentinel-hub-client-id
   CLIENT_SECRET=your-sentinel-hub-client-secret
   ```

3. **Never commit `.env`** — it is already in `.gitignore`.

4. Verify the configuration:
   ```bash
   python scripts/verify_env.py
   ```

---

## Running the Pipeline

Execute scripts in order. Each script depends on outputs from previous steps.

```
Step  Script                            Purpose
────  ──────────────────────────────    ─────────────────────────────────────
 0    scripts/verify_env.py             Verify .env credentials load safely
 1    scripts/01_auth_test.py           Test OAuth2 authentication
 2    scripts/02_sentinel_catalog_test.py  Search catalog for S2 L2A scenes
 3    scripts/03_download_sentinel.py   Download B04, B08, SCL bands
 4    scripts/04_calculate_ndvi.py      Compute cloud-masked NDVI
 5    scripts/05_download_dem.py        Download Copernicus DEM elevation
 6    scripts/06_calculate_terrain.py   Compute slope from DEM
 7    scripts/07_create_grid.py         Build grid and sample all rasters
 8    scripts/08_validate_pipeline.py   Validate entire pipeline (no mock data)
```

### Example

```bash
python scripts/verify_env.py
python scripts/01_auth_test.py
python scripts/02_sentinel_catalog_test.py
python scripts/03_download_sentinel.py
python scripts/04_calculate_ndvi.py
python scripts/05_download_dem.py
python scripts/06_calculate_terrain.py
python scripts/07_create_grid.py
python scripts/08_validate_pipeline.py
```

---

## Output Files

### Raw Downloads (`data/raw/`)

| File | Description |
|------|-------------|
| `sentinel_b04.tif` | Sentinel-2 B04 (Red), FLOAT32 reflectance |
| `sentinel_b08.tif` | Sentinel-2 B08 (NIR), FLOAT32 reflectance |
| `sentinel_scl.tif` | Scene Classification Layer, UINT8 |
| `dem.tif` | Copernicus DEM elevation, FLOAT32 (metres) |

### Processed Outputs (`data/processed/`)

| File | Description |
|------|-------------|
| `ndvi.tif` | Cloud-masked NDVI, FLOAT32, NaN = nodata |
| `slope.tif` | Slope in degrees, FLOAT32 |
| `grid.json` | **★ Final output** — per-cell measurements |
| `grid.geojson` | Same data as GeoJSON with polygon geometry |
| `scene_metadata.json` | All catalog search results |
| `selected_scene.json` | Selected scene provenance |
| `dem_metadata.json` | DEM source, fallback status, stats |
| `ndvi_statistics.json` | NDVI distribution statistics |
| `terrain_statistics.json` | Elevation and slope statistics |
| `ndvi_preview.png` | NDVI visualization (preview only) |
| `dem_preview.png` | Elevation visualization (preview only) |
| `slope_preview.png` | Slope visualization (preview only) |

### grid.json Structure

```json
{
  "metadata": {
    "aoi_bbox_4326": [73.93, 20.0, 73.94, 20.01],
    "crs": "EPSG:32643",
    "sentinel2_scene_id": "S2C_MSIL2A_...",
    "sentinel2_datetime": "2026-06-02T05:43:25.241Z",
    "dem_source": "COPERNICUS_90",
    "total_cells": 11550,
    "valid_cells": 11550
  },
  "cells": [
    {
      "cell_id": "R000_C000",
      "row": 0,
      "col": 0,
      "center_lat": 20.0098946,
      "center_lon": 73.9299811,
      "valid": true,
      "ndvi_mean": 0.505537,
      "elevation_m": 553.21,
      "slope_deg": 0.542,
      "low_vegetation_index": false
    }
  ]
}
```

---

## Configuration

All configurable parameters are in `config/settings.py`:

| Parameter | Default | Description |
|-----------|---------|-------------|
| `AOI_BBOX` | `[73.93, 20.0, 73.94, 20.01]` | Bounding box [W, S, E, N] |
| `GRID_CELL_SIZE_M` | `10` | Grid cell size (metres) |
| `LOW_VEGETATION_NDVI_THRESHOLD` | `0.2` | Flag threshold (observation, not diagnosis) |
| `DATE_FROM` / `DATE_TO` | 30-day window | Sentinel-2 search period |

---

## Scientific Limitations

1. **NDVI is not a disease detector.** Low NDVI can result from bare soil,
   fallow fields, dry season, recent harvest, water bodies, or sensor noise.
   A comprehensive crop health assessment requires field surveys, weather data,
   and agronomic expertise.

2. **Single-date snapshot.** The pipeline uses the best available scene from
   the search period. Temporal analysis (multi-date NDVI trends) would provide
   more meaningful insights but is not yet implemented.

3. **DEM resolution.** If COPERNICUS_30 is unavailable, the pipeline falls
   back to COPERNICUS_90 (90 m). Slope values at this resolution are smoothed
   and may miss small-scale terrain features.

4. **SCL accuracy.** The Scene Classification Layer is algorithmically
   generated and may occasionally misclassify pixels (e.g., bright soil as
   cloud). Visual inspection of the NDVI preview is recommended.

5. **Cloud cover during monsoon.** The Nashik AOI experiences heavy monsoon
   cloud cover (June–September). The best available scene may still have
   partial cloud contamination that SCL does not fully capture.

6. **No ground truth.** The `low_vegetation_index` flag is a configurable
   threshold-based observation. It has not been validated against field
   measurements for this specific AOI.

---

## Project Structure

```
Field Grid System/
├── .env.example            # Credential template (copy to .env)
├── .gitignore              # Excludes .env, output/, *.tif
├── requirements.txt        # Python dependencies
├── README.md               # This file
├── config/
│   ├── __init__.py
│   └── settings.py         # AOI, endpoints, thresholds
├── src/
│   ├── __init__.py
│   └── auth.py             # OAuth2 token management
├── scripts/
│   ├── verify_env.py       # Credential verification
│   ├── 01_auth_test.py     # Authentication test
│   ├── 02_sentinel_catalog_test.py
│   ├── 03_download_sentinel.py
│   ├── 04_calculate_ndvi.py
│   ├── 05_download_dem.py
│   ├── 06_calculate_terrain.py
│   ├── 07_create_grid.py
│   └── 08_validate_pipeline.py
└── data/
    ├── raw/                # Downloaded rasters (git-ignored)
    └── processed/          # Computed outputs (git-ignored)
```

---

## Security

- Credentials are loaded exclusively from `.env` via `python-dotenv`
- `.env` is listed in `.gitignore` and is never committed
- The Client Secret is never printed, logged, or included in error messages
- OAuth access tokens are cached in memory and never written to disk
- `verify_env.py` audits `settings.py` source code for accidental secret embedding
