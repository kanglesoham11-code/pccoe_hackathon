"""
FastAPI backend serving processed satellite data to the Three.js frontend.

Endpoints:
  GET /api/grid      → grid.json data (cells + metadata)
  GET /api/terrain   → elevation + NDVI as structured 2D arrays
  GET /api/metadata  → satellite scene metadata
  GET /api/rgb-texture → RGB satellite PNG image

Credentials are NEVER exposed to the browser.
All data comes from pre-processed pipeline outputs in data/processed/.
"""

import os
import json
import sys
from pathlib import Path
from dotenv import load_dotenv
load_dotenv()

import numpy as np
from typing import Optional
from fastapi import FastAPI, HTTPException, UploadFile, File, Form
from fastapi.responses import FileResponse, JSONResponse

from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware

# ── Project paths ─────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

import io
try:
    import tensorflow as tf
    from tensorflow.keras.preprocessing import image as keras_image
    MODEL_PATH = PROJECT_ROOT / 'crop_stress_model.keras'
    CLASS_NAMES_PATH = PROJECT_ROOT / 'class_names.txt'
    # Load model and class names on startup
    if MODEL_PATH.exists() and CLASS_NAMES_PATH.exists():
        ML_MODEL = tf.keras.models.load_model(str(MODEL_PATH))
        with open(str(CLASS_NAMES_PATH), 'r') as f:
            CLASS_NAMES = [line.strip() for line in f.readlines()]
    else:
        ML_MODEL = None
        CLASS_NAMES = []
except ImportError:
    ML_MODEL = None
    CLASS_NAMES = []


RAW_DIR = PROJECT_ROOT / "data" / "raw"
PROCESSED_DIR = PROJECT_ROOT / "data" / "processed"

GRID_JSON_PATH = PROCESSED_DIR / "grid.json"
SELECTED_SCENE_PATH = PROCESSED_DIR / "selected_scene.json"
DEM_META_PATH = PROCESSED_DIR / "dem_metadata.json"
NDVI_STATS_PATH = PROCESSED_DIR / "ndvi_statistics.json"
RGB_PATH = PROCESSED_DIR / "rgb_texture.png"
DEM_PATH = RAW_DIR / "dem.tif"
NDVI_PATH = PROCESSED_DIR / "ndvi.tif"

# ── App ───────────────────────────────────────────────────────────────
app = FastAPI(
    title="3D Smart Crop Field API",
    description="Serves real Sentinel-2 and DEM data for the Three.js frontend",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Cache ─────────────────────────────────────────────────────────────
_grid_cache: dict | None = None
_terrain_cache: dict | None = None


def _load_json(path: Path) -> dict:
    if not path.exists():
        return {}
    return json.loads(path.read_text(encoding="utf-8"))


def _build_terrain_payload() -> dict:
    """Read DEM and NDVI rasters and build a structured terrain payload."""
    import rasterio
    from scipy.ndimage import zoom

    if not DEM_PATH.exists():
        raise HTTPException(status_code=404, detail="DEM raster not found. Run the data pipeline first.")
    if not NDVI_PATH.exists():
        raise HTTPException(status_code=404, detail="NDVI raster not found. Run the data pipeline first.")

    # Load DEM
    with rasterio.open(DEM_PATH) as ds:
        dem = ds.read(1).astype(np.float32)
        dem[dem == -9999.0] = np.nan

    # Load NDVI
    with rasterio.open(NDVI_PATH) as ds:
        ndvi = ds.read(1).astype(np.float32)

    # DEM may have different resolution than NDVI, resample DEM to NDVI grid
    ndvi_rows, ndvi_cols = ndvi.shape
    dem_rows, dem_cols = dem.shape

    if dem.shape != ndvi.shape:
        # Use scipy zoom to resample DEM to match NDVI grid
        zoom_r = ndvi_rows / dem_rows
        zoom_c = ndvi_cols / dem_cols
        dem_resampled = zoom(dem, (zoom_r, zoom_c), order=1)  # bilinear
        dem = dem_resampled[:ndvi_rows, :ndvi_cols]

    # Replace NaN with min for clean terrain
    valid_dem = dem[np.isfinite(dem)]
    if len(valid_dem) == 0:
        min_elev = 0.0
        max_elev = 1.0
    else:
        min_elev = float(np.min(valid_dem))
        max_elev = float(np.max(valid_dem))

    dem_clean = np.where(np.isfinite(dem), dem, min_elev)

    valid_ndvi = ndvi[np.isfinite(ndvi)]
    min_ndvi = float(np.min(valid_ndvi)) if len(valid_ndvi) > 0 else -1.0
    max_ndvi = float(np.max(valid_ndvi)) if len(valid_ndvi) > 0 else 1.0
    ndvi_clean = np.where(np.isfinite(ndvi), ndvi, 0.0)

    # Load AOI bbox from grid.json metadata
    grid_data = _load_json(GRID_JSON_PATH)
    bbox = grid_data.get("metadata", {}).get("aoi_bbox_4326", [0, 0, 0, 0])

    return {
        "rows": int(ndvi_rows),
        "cols": int(ndvi_cols),
        "elevations": dem_clean.tolist(),
        "ndvi": ndvi_clean.tolist(),
        "min_elevation": round(min_elev, 2),
        "max_elevation": round(max_elev, 2),
        "min_ndvi": round(min_ndvi, 4),
        "max_ndvi": round(max_ndvi, 4),
        "bbox": bbox,
    }


# ── Endpoints ─────────────────────────────────────────────────────────

@app.get("/api/grid")
async def get_grid():
    """Return the full grid.json data (metadata + cells)."""
    if not GRID_JSON_PATH.exists():
        raise HTTPException(status_code=404, detail="grid.json not found. Run the data pipeline (scripts 02-07).")
    return JSONResponse(content=_load_json(GRID_JSON_PATH))


@app.get("/api/terrain")
async def get_terrain():
    """Return terrain elevation + NDVI as structured 2D arrays for Three.js."""
    # Always rebuild or you could cache with a file-watch, but building is fast enough for now
    return JSONResponse(content=_build_terrain_payload())


@app.get("/api/metadata")
async def get_metadata():
    """Return satellite scene and DEM metadata."""
    scene = _load_json(SELECTED_SCENE_PATH)
    dem = _load_json(DEM_META_PATH)
    ndvi_stats = _load_json(NDVI_STATS_PATH)

    return JSONResponse(content={
        "sentinel2": {
            "scene_id": scene.get("scene_id", "unknown"),
            "datetime": scene.get("datetime", "unknown"),
            "cloud_cover_pct": scene.get("cloud_cover_pct"),
            "platform": scene.get("platform", "Sentinel-2"),
            "pixel_size_m": scene.get("pixel_size_m", 10),
            "aoi_bbox": scene.get("aoi_bbox_4326", []),
        },
        "dem": {
            "source": dem.get("dem_instance", "unknown"),
            "resolution_m": dem.get("pixel_resolution_m"),
            "elevation_range_m": [
                dem.get("elevation_min_m"),
                dem.get("elevation_max_m"),
            ],
        },
        "ndvi": {
            "min": ndvi_stats.get("ndvi_min"),
            "max": ndvi_stats.get("ndvi_max"),
            "mean": ndvi_stats.get("ndvi_mean"),
            "valid_pixels": ndvi_stats.get("valid_ndvi_pixels"),
        },
    })


@app.get("/api/rgb-texture")
async def get_rgb_texture():
    """Return the RGB satellite PNG texture."""
    if not RGB_PATH.exists():
        raise HTTPException(status_code=404, detail="RGB texture not found. Run 09_download_rgb.py.")
    return FileResponse(
        path=str(RGB_PATH),
        media_type="image/png",
        headers={"Cache-Control": "public, max-age=3600"},
    )

@app.post("/api/predict-stress")
async def predict_stress(file: UploadFile = File(...)):
    if ML_MODEL is None:
        raise HTTPException(status_code=503, detail="ML Model is not loaded on the server.")
        
    contents = await file.read()
    try:
        from PIL import Image
        img = Image.open(io.BytesIO(contents))
        if img.mode != 'RGB':
            img = img.convert('RGB')
        # Get model input shape (ignore batch size dimension)
        input_shape = ML_MODEL.input_shape
        target_size = (input_shape[1], input_shape[2]) if input_shape and len(input_shape) >= 3 else (224, 224)
        
        # Resize to match whatever the model expects
        img = img.resize(target_size)
        img_array = keras_image.img_to_array(img)
        img_array = np.expand_dims(img_array, axis=0)
        # NOTE: Do NOT manually call preprocess_input here.
        # The model's built-in data_augmentation + preprocess_input layers
        # handle that automatically during model.predict().
        
        predictions = ML_MODEL.predict(img_array, verbose=0)
        probs = predictions[0]  # model output already has softmax
        
        predicted_class_idx = int(np.argmax(probs))
        predicted_class = CLASS_NAMES[predicted_class_idx]
        confidence = float(probs[predicted_class_idx])
        
        # Edge case: if confidence is very low, it's likely not a recognizable leaf
        if confidence < 0.35:
            return {
                "prediction": "uncertain",
                "confidence": confidence,
                "breakdown": {name: round(float(s), 4) for name, s in zip(CLASS_NAMES, probs)},
                "warning": "Low confidence — the image may not be a recognizable crop leaf."
            }
        
        breakdown = {name: round(float(s), 4) for name, s in zip(CLASS_NAMES, probs)}
        
        return {
            "prediction": predicted_class,
            "confidence": confidence,
            "breakdown": breakdown
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Error processing image: {str(e)}")



# ── MISC 03: Diagnostic Investigation Endpoints ──────────────────────
from pydantic import BaseModel
from backend.diagnostic_engine import (
    start_investigation,
    submit_answer,
    conclude_investigation,
    get_investigation,
    run_comparison,
    run_all_test_cases,
    get_labeled_cases,
    STRESS_DESCRIPTIONS,
)


class StartInvestigationRequest(BaseModel):
    image_analysis: dict
    field_context: dict = {"crop": "tomato"}
    question_budget: int = 6
    strategy: str = "information_gain"


class SubmitAnswerRequest(BaseModel):
    investigation_id: str
    question_id: str
    answer_index: int


class ComparisonRequest(BaseModel):
    image_analysis: dict
    field_context: dict = {"crop": "tomato"}
    simulated_answers: dict
    question_budget: int = 6


@app.post("/api/investigation/start")
async def api_start_investigation(req: StartInvestigationRequest):
    """Start a new diagnostic investigation session."""
    result = start_investigation(
        image_analysis=req.image_analysis,
        field_context=req.field_context,
        question_budget=req.question_budget,
        strategy=req.strategy,
    )
    return JSONResponse(content=result)


@app.post("/api/investigation/answer")
async def api_submit_answer(req: SubmitAnswerRequest):
    """Submit an answer to a follow-up question."""
    result = submit_answer(
        investigation_id=req.investigation_id,
        question_id=req.question_id,
        answer_index=req.answer_index,
    )
    return JSONResponse(content=result)


@app.post("/api/investigation/conclude/{investigation_id}")
async def api_conclude_investigation(investigation_id: str):
    """Conclude investigation and get LLM-generated advisory."""
    result = await conclude_investigation(investigation_id)
    return JSONResponse(content=result)


@app.post("/api/investigation/compare")
async def api_run_comparison(req: ComparisonRequest):
    """Run side-by-side comparison of info-gain vs fixed-order strategies."""
    result = run_comparison(
        image_analysis=req.image_analysis,
        field_context=req.field_context,
        simulated_answers=req.simulated_answers,
        question_budget=req.question_budget,
    )
    return JSONResponse(content=result)


@app.get("/api/investigation/test-cases/run")
async def api_run_test_cases():
    """Run all labeled test cases and return comparison results."""
    results = run_all_test_cases()
    return JSONResponse(content=results)


@app.get("/api/investigation/test-cases/list")
async def api_list_test_cases():
    """List all labeled test cases."""
    cases = get_labeled_cases()
    return JSONResponse(content=cases)


@app.get("/api/investigation/stress-descriptions")
async def api_stress_descriptions():
    """Get all stress hypothesis descriptions."""
    return JSONResponse(content=STRESS_DESCRIPTIONS)

# ── Sarvam AI — Multilingual Voice (STT + TTS) ───────────────────────
# Uses Sarvam AI's Saaras v4 for Speech-to-Text (22 Indian languages)
# and Bulbul v4-flash for Text-to-Speech.

import httpx as _httpx
import base64 as _base64

SARVAM_API_KEY = os.environ.get("SARVAM_API_KEY", "")
SARVAM_STT_URL = "https://api.sarvam.ai/speech-to-text"
SARVAM_TTS_URL = "https://api.sarvam.ai/text-to-speech"

GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_CHAT_URL = "https://api.groq.com/openai/v1/chat/completions"
GROQ_CHAT_MODEL = "qwen/qwen3.8-27b"

# Language map
LANG_MAP = {
    "en": "English", "hi": "Hindi", "mr": "Marathi",
    "english": "en", "hindi": "hi", "marathi": "mr",
}
# Sarvam language codes
SARVAM_LANG_CODES = {
    "en": "en-IN", "hi": "hi-IN", "mr": "mr-IN",
}


@app.post("/api/transcribe")
async def api_transcribe(
    file: UploadFile = File(...),
    language: Optional[str] = Form(None),
    lang: Optional[str] = None
):
    """
    Transcribe audio to text using Sarvam AI (Saaras v4 model).
    Supports: English, Hindi, Marathi, and 22+ Indian languages.
    Returns: { text, language, language_name }
    """
    try:
        audio_bytes = await file.read()
        filename = file.filename or "audio.webm"

        if len(audio_bytes) < 500:
            return JSONResponse(content={"text": "", "language": "en", "language_name": "English"})

        # Clean content-type
        raw_ctype = file.content_type or "audio/webm"
        content_type = raw_ctype.split(";")[0].strip() if ";" in raw_ctype else raw_ctype

        # Build multipart form data for Sarvam AI
        files_payload = {
            "file": (filename, audio_bytes, content_type),
        }
        data_payload: dict = {
            "model": "saaras:v4",
        }
        # Add language code if specified
        target_lang = (language or lang or "").strip().lower()
        if target_lang and target_lang in SARVAM_LANG_CODES:
            data_payload["language_code"] = SARVAM_LANG_CODES[target_lang]

        async with _httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                SARVAM_STT_URL,
                headers={"api-subscription-key": SARVAM_API_KEY},
                files=files_payload,
                data=data_payload,
            )
            resp.raise_for_status()
            result = resp.json()

        transcript = result.get("transcript", "").strip()
        detected_lang_code = result.get("language_code", "en-IN")

        # Map Sarvam lang code to short code
        lang_code = detected_lang_code.split("-")[0] if "-" in detected_lang_code else detected_lang_code
        lang_name = LANG_MAP.get(lang_code, detected_lang_code)

        return JSONResponse(content={
            "text": transcript,
            "language": lang_code,
            "language_name": lang_name,
        })

    except _httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=502, detail=f"Sarvam STT error: {detail}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Transcription failed: {str(e)}")


# ── Sarvam AI Text-to-Speech ─────────────────────────────────────────

class TTSRequest(BaseModel):
    text: str
    language: str = "en"


@app.post("/api/tts")
async def api_tts(req: TTSRequest):
    """
    Convert text to speech using Sarvam AI (Bulbul v4-flash).
    Returns: { audio_base64, content_type }
    """
    try:
        lang_code = SARVAM_LANG_CODES.get(req.language, "en-IN")

        async with _httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                SARVAM_TTS_URL,
                headers={
                    "api-subscription-key": SARVAM_API_KEY,
                    "Content-Type": "application/json",
                },
                json={
                    "text": req.text[:2000],  # Sarvam limit is 2500 chars
                    "language_code": lang_code,
                    "model": "bulbul:v4-flash",
                },
            )
            resp.raise_for_status()
            result = resp.json()

        audios = result.get("audios", [])
        if audios:
            return JSONResponse(content={
                "audio_base64": audios[0],
                "content_type": "audio/wav",
            })
        else:
            raise HTTPException(status_code=500, detail="No audio generated")

    except _httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=502, detail=f"Sarvam TTS error: {detail}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"TTS failed: {str(e)}")



# ── Free Chat Endpoint (Groq LLM) ────────────────────────────────────
# Allows the farmer to ask follow-up questions about the diagnosis in
# any language. The LLM has full context of the investigation.

# Store chat histories per investigation
_chat_histories: dict[str, list] = {}


class ChatRequest(BaseModel):
    message: str
    investigation_id: str = ""
    language: str = "en"


@app.post("/api/chat")
async def api_free_chat(req: ChatRequest):
    """
    Free-form chat about the diagnosis. Uses Groq LLM with full
    investigation context. Supports multilingual responses.
    """
    inv_context = ""
    if req.investigation_id:
        inv_data = get_investigation(req.investigation_id)
        if inv_data:
            diag = inv_data.get("diagnosis", "unknown")
            conf = inv_data.get("confidence")
            desc = inv_data.get("diagnosis_description", "")
            hyps = inv_data.get("sorted_hypotheses", [])
            evidence = inv_data.get("evidence", [])
            contradictions = inv_data.get("contradictions", [])
            advisory = inv_data.get("advisory", {})

            inv_context = f"""
Investigation Context:
- Diagnosis: {diag} (confidence: {conf})
- Description: {desc}
- All hypotheses considered: {json.dumps(hyps[:5])}
- Evidence gathered: {json.dumps(evidence[-6:])}
- Contradictions found: {json.dumps(contradictions)}
- Advisory summary: {advisory.get('summary', 'N/A')}
- Recommendations: {json.dumps(advisory.get('recommendations', []))}
"""

    # Get or create chat history
    chat_key = req.investigation_id or "global"
    if chat_key not in _chat_histories:
        _chat_histories[chat_key] = []

    history = _chat_histories[chat_key]

    # Build system prompt
    lang_instruction = ""
    if req.language == "hi":
        lang_instruction = "Respond in Hindi (Devanagari script). "
    elif req.language == "mr":
        lang_instruction = "Respond in Marathi (Devanagari script). "
    else:
        lang_instruction = "Respond in English. "

    system_prompt = f"""You are CropSense AI, an expert agricultural advisor for tomato farming in Maharashtra, India.
{lang_instruction}
You help farmers understand crop stress diagnoses, treatment options, and best farming practices.
Keep responses concise (2-4 sentences for simple questions, more for detailed explanations).
If asked about the current diagnosis, use the investigation context provided.
Be warm, practical, and farmer-friendly. Use simple language.

{inv_context}"""

    # Add user message to history
    history.append({"role": "user", "content": req.message})

    # Build messages for Groq
    messages = [{"role": "system", "content": system_prompt}]
    # Keep last 10 messages for context
    messages.extend(history[-10:])

    try:
        async with _httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(
                GROQ_CHAT_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_CHAT_MODEL,
                    "messages": messages,
                    "temperature": 0.7,
                    "max_tokens": 512,
                },
            )
            resp.raise_for_status()
            result = resp.json()

        reply = result["choices"][0]["message"]["content"].strip()

        # Add assistant reply to history
        history.append({"role": "assistant", "content": reply})

        return JSONResponse(content={
            "reply": reply,
            "language": req.language,
        })

    except _httpx.HTTPStatusError as e:
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=502, detail=f"Groq chat error: {detail}")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Chat failed: {str(e)}")


# NOTE: This wildcard route MUST come AFTER all specific /api/investigation/* routes
@app.get("/api/investigation/{investigation_id}")
async def api_get_investigation(investigation_id: str):
    """Get current state of an investigation."""
    result = get_investigation(investigation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Investigation not found")
    return JSONResponse(content=result)



# ── Serve frontend static files (production build) ───────────────────
FRONTEND_DIST = PROJECT_ROOT / "frontend" / "dist"
if FRONTEND_DIST.exists():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIST), html=True), name="frontend")


# ── Main ──────────────────────────────────────────────────────────────
if __name__ == "__main__":
    import uvicorn
    print("Starting 3D Smart Crop Field API server ...")
    print(f"  Grid JSON  : {'FOUND' if GRID_JSON_PATH.exists() else 'MISSING'}")
    print(f"  DEM raster : {'FOUND' if DEM_PATH.exists() else 'MISSING'}")
    print(f"  NDVI raster: {'FOUND' if NDVI_PATH.exists() else 'MISSING'}")
    print(f"  RGB texture: {'FOUND' if RGB_PATH.exists() else 'MISSING'}")
    print()
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
