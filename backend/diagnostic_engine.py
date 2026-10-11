"""
MISC 03 — Crop Stress Diagnostic Investigation Engine

Implements:
  Addition 1: Interactive diagnostic investigation with multiple plausible
               stress explanations, follow-up question gathering, evidence
               updates, contradiction handling, and investigation history.
  Addition 2: Probabilistic question selection using model-derived posterior
               distributions over stress hypotheses and expected information
               gain for choosing optimal follow-up questions.

Scope: Tomato crop with stresses: bacterial_spot, early_blight, late_blight,
       septoria_leaf_spot, nutrient_deficiency, water_stress, healthy.
"""

import os
import json
import math
import uuid
import time
import copy
import httpx
from typing import Optional
from dataclasses import dataclass, field, asdict

# ── Groq LLM Config ──────────────────────────────────────────────────
GROQ_API_KEY = os.environ.get("GROQ_API_KEY", "")
GROQ_MODEL = "qwen/qwen3.8-27b"
GROQ_URL = "https://api.groq.com/openai/v1/chat/completions"

# ── Stress Hypotheses for Tomato ──────────────────────────────────────
STRESS_HYPOTHESES = [
    "bacterial_spot",
    "early_blight",
    "late_blight",
    "septoria_leaf_spot",
    "nutrient_deficiency",
    "water_stress",
    "healthy",
]

STRESS_DESCRIPTIONS = {
    "bacterial_spot": "Bacterial Spot — small, dark, water-soaked lesions on leaves and fruit, often with yellow halos.",
    "early_blight": "Early Blight (Alternaria) — concentric ring/target-shaped brown spots, starting on older leaves.",
    "late_blight": "Late Blight (Phytophthora) — large, dark, water-soaked patches with white mold underside in humid conditions.",
    "septoria_leaf_spot": "Septoria Leaf Spot — many small circular spots with dark borders and tan/gray centers, tiny black dots.",
    "nutrient_deficiency": "Nutrient Deficiency — uniform yellowing (N), interveinal chlorosis (Fe/Mn), purpling (P), necrotic margins (K).",
    "water_stress": "Water Stress — wilting, leaf curling, dry/crispy leaf margins, stunted growth.",
    "healthy": "Healthy — uniform green coloration, no lesions, normal turgor and growth.",
}

# ── Diagnostic Question Bank ─────────────────────────────────────────
# Each question has: id, text, response_model (expected answers), cost,
# and a likelihood_update matrix describing P(answer | hypothesis).

@dataclass
class DiagnosticQuestion:
    id: str
    text: str
    category: str  # "visual", "environmental", "management", "temporal"
    response_options: list  # possible answer strings
    cost: float  # information cost (1.0 = standard)
    # likelihood[hypothesis][answer_index] = P(answer | hypothesis)
    likelihoods: dict  # hypothesis -> list[float]

QUESTION_BANK: list[DiagnosticQuestion] = [
    DiagnosticQuestion(
        id="q_lesion_shape",
        text="What is the predominant shape of the leaf spots/lesions?",
        category="visual",
        response_options=["Circular with rings", "Irregular water-soaked", "Small dark spots", "Tiny spots with dark border", "No spots visible", "Cannot determine"],
        cost=1.0,
        likelihoods={
            "bacterial_spot":      [0.05, 0.30, 0.45, 0.05, 0.05, 0.10],
            "early_blight":        [0.60, 0.10, 0.10, 0.05, 0.05, 0.10],
            "late_blight":         [0.05, 0.55, 0.15, 0.05, 0.05, 0.15],
            "septoria_leaf_spot":  [0.05, 0.05, 0.10, 0.60, 0.05, 0.15],
            "nutrient_deficiency": [0.02, 0.03, 0.05, 0.02, 0.75, 0.13],
            "water_stress":        [0.02, 0.03, 0.03, 0.02, 0.78, 0.12],
            "healthy":             [0.01, 0.01, 0.01, 0.01, 0.90, 0.06],
        },
    ),
    DiagnosticQuestion(
        id="q_lesion_color",
        text="What color are the affected areas on the leaves?",
        category="visual",
        response_options=["Brown/tan with yellow halo", "Dark brown concentric", "Dark green-black water soaked", "Gray center dark border", "Uniform yellowing", "Dry brown edges", "Normal green"],
        cost=1.0,
        likelihoods={
            "bacterial_spot":      [0.50, 0.10, 0.15, 0.05, 0.03, 0.02, 0.15],
            "early_blight":        [0.10, 0.55, 0.05, 0.10, 0.05, 0.05, 0.10],
            "late_blight":         [0.05, 0.10, 0.55, 0.05, 0.05, 0.05, 0.15],
            "septoria_leaf_spot":  [0.10, 0.05, 0.05, 0.55, 0.05, 0.05, 0.15],
            "nutrient_deficiency": [0.03, 0.03, 0.02, 0.02, 0.65, 0.10, 0.15],
            "water_stress":        [0.02, 0.02, 0.02, 0.02, 0.10, 0.65, 0.17],
            "healthy":             [0.01, 0.01, 0.01, 0.01, 0.02, 0.02, 0.92],
        },
    ),
    DiagnosticQuestion(
        id="q_affected_leaves",
        text="Which leaves are primarily affected?",
        category="visual",
        response_options=["Older/lower leaves first", "Newer/upper leaves", "All leaves uniformly", "Random scattered pattern", "No leaves affected"],
        cost=1.0,
        likelihoods={
            "bacterial_spot":      [0.15, 0.15, 0.20, 0.40, 0.10],
            "early_blight":        [0.60, 0.05, 0.15, 0.10, 0.10],
            "late_blight":         [0.10, 0.15, 0.35, 0.30, 0.10],
            "septoria_leaf_spot":  [0.55, 0.05, 0.20, 0.10, 0.10],
            "nutrient_deficiency": [0.40, 0.30, 0.15, 0.05, 0.10],
            "water_stress":        [0.20, 0.10, 0.45, 0.10, 0.15],
            "healthy":             [0.02, 0.02, 0.02, 0.02, 0.92],
        },
    ),
    DiagnosticQuestion(
        id="q_recent_weather",
        text="What has the recent weather been like (past 1-2 weeks)?",
        category="environmental",
        response_options=["Hot and humid", "Cool and wet", "Hot and dry", "Mild with normal rain", "Heavy prolonged rain"],
        cost=0.8,
        likelihoods={
            "bacterial_spot":      [0.30, 0.25, 0.05, 0.15, 0.25],
            "early_blight":        [0.35, 0.15, 0.10, 0.25, 0.15],
            "late_blight":         [0.10, 0.40, 0.02, 0.08, 0.40],
            "septoria_leaf_spot":  [0.15, 0.30, 0.05, 0.15, 0.35],
            "nutrient_deficiency": [0.20, 0.15, 0.20, 0.30, 0.15],
            "water_stress":        [0.25, 0.05, 0.50, 0.10, 0.10],
            "healthy":             [0.15, 0.15, 0.15, 0.40, 0.15],
        },
    ),
    DiagnosticQuestion(
        id="q_watering",
        text="How has the crop been watered recently?",
        category="management",
        response_options=["Overhead irrigation", "Drip irrigation", "Rain-fed only", "Inconsistent watering", "Adequate and regular"],
        cost=0.8,
        likelihoods={
            "bacterial_spot":      [0.40, 0.10, 0.20, 0.15, 0.15],
            "early_blight":        [0.25, 0.15, 0.20, 0.20, 0.20],
            "late_blight":         [0.30, 0.10, 0.25, 0.15, 0.20],
            "septoria_leaf_spot":  [0.35, 0.10, 0.25, 0.15, 0.15],
            "nutrient_deficiency": [0.15, 0.20, 0.20, 0.20, 0.25],
            "water_stress":        [0.05, 0.10, 0.35, 0.35, 0.15],
            "healthy":             [0.15, 0.25, 0.15, 0.10, 0.35],
        },
    ),
    DiagnosticQuestion(
        id="q_spread_speed",
        text="How quickly are the symptoms spreading?",
        category="temporal",
        response_options=["Very rapidly (days)", "Gradually over weeks", "Static / not spreading", "Unsure / just noticed"],
        cost=1.0,
        likelihoods={
            "bacterial_spot":      [0.30, 0.35, 0.10, 0.25],
            "early_blight":        [0.15, 0.50, 0.15, 0.20],
            "late_blight":         [0.55, 0.20, 0.05, 0.20],
            "septoria_leaf_spot":  [0.15, 0.45, 0.15, 0.25],
            "nutrient_deficiency": [0.05, 0.30, 0.40, 0.25],
            "water_stress":        [0.10, 0.20, 0.40, 0.30],
            "healthy":             [0.02, 0.03, 0.80, 0.15],
        },
    ),
    DiagnosticQuestion(
        id="q_fruit_symptoms",
        text="Are there any symptoms on the fruits?",
        category="visual",
        response_options=["Dark scabby spots on fruit", "Brown leathery patches", "No fruit symptoms", "Fruit dropping prematurely", "Unsure"],
        cost=1.2,
        likelihoods={
            "bacterial_spot":      [0.45, 0.10, 0.15, 0.10, 0.20],
            "early_blight":        [0.10, 0.35, 0.25, 0.10, 0.20],
            "late_blight":         [0.10, 0.40, 0.15, 0.15, 0.20],
            "septoria_leaf_spot":  [0.05, 0.05, 0.55, 0.10, 0.25],
            "nutrient_deficiency": [0.03, 0.05, 0.50, 0.15, 0.27],
            "water_stress":        [0.02, 0.05, 0.40, 0.25, 0.28],
            "healthy":             [0.01, 0.01, 0.85, 0.02, 0.11],
        },
    ),
    DiagnosticQuestion(
        id="q_mold_presence",
        text="Is there any visible mold or fungal growth on affected areas?",
        category="visual",
        response_options=["White fuzzy mold underside", "Dark powdery spores", "No mold visible", "Slimy/wet appearance", "Unsure"],
        cost=1.0,
        likelihoods={
            "bacterial_spot":      [0.02, 0.05, 0.55, 0.20, 0.18],
            "early_blight":        [0.05, 0.30, 0.35, 0.05, 0.25],
            "late_blight":         [0.50, 0.10, 0.10, 0.10, 0.20],
            "septoria_leaf_spot":  [0.05, 0.25, 0.35, 0.05, 0.30],
            "nutrient_deficiency": [0.01, 0.02, 0.80, 0.02, 0.15],
            "water_stress":        [0.01, 0.02, 0.82, 0.02, 0.13],
            "healthy":             [0.01, 0.01, 0.90, 0.01, 0.07],
        },
    ),
    DiagnosticQuestion(
        id="q_stem_symptoms",
        text="Are there any symptoms on the plant stems?",
        category="visual",
        response_options=["Dark cankers/lesions on stem", "Stem appears normal", "Wilted/collapsing stems", "Discoloration near soil line", "Unsure"],
        cost=1.0,
        likelihoods={
            "bacterial_spot":      [0.15, 0.40, 0.05, 0.10, 0.30],
            "early_blight":        [0.30, 0.30, 0.05, 0.10, 0.25],
            "late_blight":         [0.25, 0.20, 0.20, 0.10, 0.25],
            "septoria_leaf_spot":  [0.05, 0.55, 0.05, 0.05, 0.30],
            "nutrient_deficiency": [0.03, 0.50, 0.10, 0.10, 0.27],
            "water_stress":        [0.02, 0.30, 0.35, 0.10, 0.23],
            "healthy":             [0.01, 0.80, 0.02, 0.02, 0.15],
        },
    ),
    DiagnosticQuestion(
        id="q_fertilization",
        text="When was the last fertilizer application and what type?",
        category="management",
        response_options=["Recently with balanced NPK", "Over a month ago", "Only nitrogen applied", "Organic compost only", "No fertilization this season", "Unsure"],
        cost=0.8,
        likelihoods={
            "bacterial_spot":      [0.20, 0.15, 0.15, 0.15, 0.15, 0.20],
            "early_blight":        [0.20, 0.15, 0.15, 0.15, 0.15, 0.20],
            "late_blight":         [0.20, 0.15, 0.15, 0.15, 0.15, 0.20],
            "septoria_leaf_spot":  [0.20, 0.15, 0.15, 0.15, 0.15, 0.20],
            "nutrient_deficiency": [0.05, 0.30, 0.10, 0.10, 0.35, 0.10],
            "water_stress":        [0.20, 0.15, 0.15, 0.15, 0.15, 0.20],
            "healthy":             [0.30, 0.10, 0.15, 0.15, 0.05, 0.25],
        },
    ),
]

QUESTION_MAP = {q.id: q for q in QUESTION_BANK}

# Fixed-order baseline (for comparison)
FIXED_QUESTION_ORDER = [
    "q_lesion_shape", "q_lesion_color", "q_affected_leaves",
    "q_recent_weather", "q_watering", "q_spread_speed",
    "q_fruit_symptoms", "q_mold_presence", "q_stem_symptoms",
    "q_fertilization",
]


# ── Investigation State ───────────────────────────────────────────────

@dataclass
class EvidenceItem:
    question_id: str
    question_text: str
    answer: str
    answer_index: int
    timestamp: float
    contradicts_image: bool = False

@dataclass
class InvestigationState:
    investigation_id: str
    crop: str  # "tomato"
    image_analysis: dict  # from ML model predictions
    field_context: dict   # user-supplied field context
    posteriors: dict       # hypothesis -> probability
    evidence: list         # list of EvidenceItem dicts
    asked_questions: list  # list of question_ids
    question_budget: int
    questions_used: int
    status: str  # "active", "resolved", "unresolved", "expert_review"
    diagnosis: Optional[str]
    confidence: float
    recommendations: list
    investigation_trace: list  # full trace of all updates
    created_at: float
    updated_at: float
    expert_review_reason: Optional[str] = None
    contradictions: list = field(default_factory=list)
    strategy: str = "information_gain"  # or "fixed_order"


# ── Active sessions storage ───────────────────────────────────────────
_sessions: dict[str, InvestigationState] = {}


# ── Bayesian Engine ───────────────────────────────────────────────────

def _normalize(probs: dict) -> dict:
    """Normalize probability distribution."""
    total = sum(probs.values())
    if total == 0:
        n = len(probs)
        return {k: 1.0 / n for k in probs}
    return {k: v / total for k, v in probs.items()}


def _entropy(probs: dict) -> float:
    """Shannon entropy of distribution."""
    return -sum(p * math.log2(p + 1e-12) for p in probs.values() if p > 0)


def _expected_information_gain(question: DiagnosticQuestion, posteriors: dict) -> float:
    """
    Compute expected information gain (mutual information) for a question.
    EIG = H(current) - E_answer[H(posterior | answer)]
    """
    current_entropy = _entropy(posteriors)

    n_answers = len(question.response_options)
    eig = 0.0

    for ans_idx in range(n_answers):
        # P(answer) = sum over hypotheses P(answer|h) * P(h)
        p_answer = sum(
            question.likelihoods[h][ans_idx] * posteriors.get(h, 0)
            for h in STRESS_HYPOTHESES
        )

        if p_answer < 1e-12:
            continue

        # Posterior P(h | answer) for each hypothesis
        updated = {}
        for h in STRESS_HYPOTHESES:
            likelihood = question.likelihoods[h][ans_idx]
            updated[h] = likelihood * posteriors.get(h, 0)
        updated = _normalize(updated)

        posterior_entropy = _entropy(updated)
        eig += p_answer * (current_entropy - posterior_entropy)

    # Adjust by cost
    return eig / (question.cost + 0.01)


def _update_posteriors(posteriors: dict, question: DiagnosticQuestion, answer_idx: int) -> dict:
    """Bayesian update of posteriors given observed answer."""
    updated = {}
    for h in STRESS_HYPOTHESES:
        likelihood = question.likelihoods[h][answer_idx]
        updated[h] = likelihood * posteriors.get(h, 0)
    return _normalize(updated)


def _select_next_question_ig(state: InvestigationState) -> Optional[DiagnosticQuestion]:
    """Select the question with highest expected information gain."""
    available = [q for q in QUESTION_BANK if q.id not in state.asked_questions]
    if not available:
        return None

    best_q = None
    best_eig = -1.0
    for q in available:
        eig = _expected_information_gain(q, state.posteriors)
        if eig > best_eig:
            best_eig = eig
            best_q = q

    return best_q


def _select_next_question_fixed(state: InvestigationState) -> Optional[DiagnosticQuestion]:
    """Select the next question in fixed order."""
    for qid in FIXED_QUESTION_ORDER:
        if qid not in state.asked_questions and qid in QUESTION_MAP:
            return QUESTION_MAP[qid]
    return None


def _check_stopping_conditions(state: InvestigationState) -> tuple[bool, str]:
    """
    Check if investigation should stop.
    Returns (should_stop, reason).
    """
    # Budget exhausted
    if state.questions_used >= state.question_budget:
        return True, "question_budget_exhausted"

    # High confidence in one hypothesis
    max_h = max(state.posteriors, key=state.posteriors.get)
    max_p = state.posteriors[max_h]

    if max_p >= 0.85 and state.questions_used >= 2:
        return True, "high_confidence"

    # Too many contradictions → expert review
    if len(state.contradictions) >= 2:
        return True, "contradictions_need_expert"

    # All questions asked
    if len(state.asked_questions) >= len(QUESTION_BANK):
        return True, "all_questions_asked"

    return False, ""


def _detect_contradiction(state: InvestigationState, question: DiagnosticQuestion,
                           answer_idx: int) -> Optional[str]:
    """
    Detect if the new answer contradicts existing image analysis or evidence.
    """
    image_pred = state.image_analysis.get("prediction", "")
    image_conf = state.image_analysis.get("confidence", 0)

    # If image says healthy but visual questions show symptoms
    if image_pred == "healthy" and image_conf > 0.5:
        if question.category == "visual" and answer_idx not in _get_healthy_answer_indices(question):
            return f"Image analysis predicted 'healthy' (conf={image_conf:.0%}) but visual observation indicates symptoms: '{question.response_options[answer_idx]}'"

    # If image says disease but observer says no symptoms
    if image_pred in ["disease_stress", "bacterial_spot", "early_blight", "late_blight"] and image_conf > 0.5:
        if question.id == "q_lesion_shape" and answer_idx == 4:  # "No spots visible"
            return f"Image analysis detected disease stress (conf={image_conf:.0%}) but observer reports no visible spots."

    return None


def _get_healthy_answer_indices(q: DiagnosticQuestion) -> list[int]:
    """Get answer indices that are consistent with healthy plant."""
    healthy_likelihoods = q.likelihoods.get("healthy", [])
    return [i for i, p in enumerate(healthy_likelihoods) if p > 0.3]


def _get_initial_priors(image_analysis: dict) -> dict:
    """
    Derive initial prior distribution from ML model image analysis.
    Maps the 4-class model output to the 7 diagnostic hypotheses.
    """
    breakdown = image_analysis.get("breakdown", {})

    # Map 4 model classes to 7 diagnostic hypotheses
    disease_prob = breakdown.get("disease_stress", 0.25)
    healthy_prob = breakdown.get("healthy", 0.25)
    nutrient_prob = breakdown.get("nutrients_stress", 0.25)
    water_prob = breakdown.get("water_stress", 0.25)

    # Split disease_stress across 4 disease hypotheses
    priors = {
        "bacterial_spot": disease_prob * 0.25,
        "early_blight": disease_prob * 0.30,
        "late_blight": disease_prob * 0.25,
        "septoria_leaf_spot": disease_prob * 0.20,
        "nutrient_deficiency": nutrient_prob,
        "water_stress": water_prob,
        "healthy": healthy_prob,
    }

    return _normalize(priors)


# ── Groq LLM Integration ─────────────────────────────────────────────

async def _groq_generate_advisory(state: InvestigationState) -> dict:
    """
    Use Groq LLM to generate contextual advisory based on investigation results.
    """
    sorted_posteriors = sorted(state.posteriors.items(), key=lambda x: x[1], reverse=True)
    top_diagnosis = sorted_posteriors[0]

    evidence_summary = ""
    for ev in state.evidence:
        evidence_summary += f"  - Q: {ev['question_text']} → A: {ev['answer']}"
        if ev.get('contradicts_image'):
            evidence_summary += " [CONTRADICTS IMAGE]"
        evidence_summary += "\n"

    contradiction_summary = ""
    if state.contradictions:
        contradiction_summary = "CONTRADICTIONS FOUND:\n" + "\n".join(f"  - {c}" for c in state.contradictions)

    prompt = f"""You are an expert crop pathologist providing field advisory for tomato crops.

INVESTIGATION RESULTS:
- Top diagnosis: {top_diagnosis[0]} (probability: {top_diagnosis[1]:.1%})
- All probabilities: {json.dumps({h: round(p, 3) for h, p in sorted_posteriors})}
- Investigation status: {state.status}
- Questions asked: {state.questions_used}/{state.question_budget}

EVIDENCE COLLECTED:
{evidence_summary if evidence_summary else "  No follow-up evidence collected."}

{contradiction_summary}

IMAGE ANALYSIS:
- ML Prediction: {state.image_analysis.get('prediction', 'unknown')}
- Confidence: {state.image_analysis.get('confidence', 0):.1%}

FIELD CONTEXT:
{json.dumps(state.field_context, indent=2)}

Based on this investigation, provide:
1. A concise diagnosis summary (2-3 sentences)
2. Confidence assessment explaining why the diagnosis is or isn't certain
3. Three specific, actionable recommendations for the farmer
4. Whether expert review is needed and why

Format as JSON with keys: "summary", "confidence_assessment", "recommendations" (array of strings), "needs_expert_review" (boolean), "expert_review_reason" (string or null)"""

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            response = await client.post(
                GROQ_URL,
                headers={
                    "Authorization": f"Bearer {GROQ_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": GROQ_MODEL,
                    "messages": [
                        {"role": "system", "content": "You are an expert agricultural pathologist. Respond ONLY with valid JSON."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 800,
                },
            )

            if response.status_code == 200:
                content = response.json()["choices"][0]["message"]["content"]
                # Try to parse JSON from response
                try:
                    # Handle potential markdown wrapping
                    if "```json" in content:
                        content = content.split("```json")[1].split("```")[0]
                    elif "```" in content:
                        content = content.split("```")[1].split("```")[0]
                    return json.loads(content.strip())
                except (json.JSONDecodeError, IndexError):
                    return {
                        "summary": content[:500],
                        "confidence_assessment": "Unable to parse structured response.",
                        "recommendations": ["Consult a local agricultural extension officer."],
                        "needs_expert_review": True,
                        "expert_review_reason": "LLM response parsing failed."
                    }
            else:
                return _fallback_advisory(state)
    except Exception:
        return _fallback_advisory(state)


def _fallback_advisory(state: InvestigationState) -> dict:
    """Fallback advisory when Groq is unavailable."""
    top = max(state.posteriors, key=state.posteriors.get)
    conf = state.posteriors[top]

    recs = {
        "bacterial_spot": ["Apply copper-based bactericide", "Remove infected plant material", "Avoid overhead irrigation"],
        "early_blight": ["Apply chlorothalonil or mancozeb fungicide", "Remove affected lower leaves", "Improve air circulation with pruning"],
        "late_blight": ["Apply metalaxyl-based fungicide immediately", "Remove and destroy infected plants", "Avoid wetting foliage, use drip irrigation"],
        "septoria_leaf_spot": ["Apply chlorothalonil fungicide", "Remove lower infected leaves", "Mulch to prevent soil splash"],
        "nutrient_deficiency": ["Conduct soil test for nutrient levels", "Apply balanced NPK fertilizer", "Consider foliar micronutrient spray"],
        "water_stress": ["Establish consistent irrigation schedule", "Apply mulch to retain moisture", "Water deeply but less frequently"],
        "healthy": ["Continue current management practices", "Monitor regularly for early symptoms", "Maintain proper nutrition schedule"],
    }

    return {
        "summary": f"Investigation suggests {STRESS_DESCRIPTIONS.get(top, top)} with {conf:.0%} confidence.",
        "confidence_assessment": f"Based on {state.questions_used} observations. {'High' if conf > 0.7 else 'Moderate' if conf > 0.4 else 'Low'} confidence.",
        "recommendations": recs.get(top, ["Consult agricultural extension officer"]),
        "needs_expert_review": conf < 0.5 or len(state.contradictions) > 0,
        "expert_review_reason": "Low confidence or contradictory evidence" if conf < 0.5 else None,
    }


# ── Public API Functions ──────────────────────────────────────────────

def start_investigation(
    image_analysis: dict,
    field_context: dict,
    question_budget: int = 6,
    strategy: str = "information_gain",
) -> dict:
    """
    Start a new diagnostic investigation.

    Args:
        image_analysis: Output from /api/predict-stress (prediction, confidence, breakdown)
        field_context: User-supplied context (crop, location, season, etc.)
        question_budget: Maximum number of follow-up questions
        strategy: "information_gain" or "fixed_order"

    Returns:
        Initial investigation state with first question suggestion.
    """
    inv_id = str(uuid.uuid4())[:12]
    priors = _get_initial_priors(image_analysis)

    state = InvestigationState(
        investigation_id=inv_id,
        crop=field_context.get("crop", "tomato"),
        image_analysis=image_analysis,
        field_context=field_context,
        posteriors=priors,
        evidence=[],
        asked_questions=[],
        question_budget=question_budget,
        questions_used=0,
        status="active",
        diagnosis=None,
        confidence=0.0,
        recommendations=[],
        investigation_trace=[],
        created_at=time.time(),
        updated_at=time.time(),
        contradictions=[],
        strategy=strategy,
    )

    # Record initial state
    state.investigation_trace.append({
        "step": 0,
        "action": "investigation_started",
        "posteriors": copy.deepcopy(state.posteriors),
        "image_analysis": image_analysis,
        "field_context": field_context,
        "timestamp": time.time(),
    })

    _sessions[inv_id] = state

    # Select first question
    if strategy == "information_gain":
        next_q = _select_next_question_ig(state)
    else:
        next_q = _select_next_question_fixed(state)

    # Compute EIG for all available questions
    candidate_questions = _get_candidate_questions(state)

    return {
        "investigation_id": inv_id,
        "status": "active",
        "posteriors": {h: round(p, 4) for h, p in state.posteriors.items()},
        "sorted_hypotheses": _sorted_hypotheses(state),
        "next_question": _question_to_dict(next_q) if next_q else None,
        "candidate_questions": candidate_questions,
        "questions_used": 0,
        "question_budget": question_budget,
        "strategy": strategy,
        "evidence": [],
        "contradictions": [],
    }


def submit_answer(investigation_id: str, question_id: str, answer_index: int) -> dict:
    """
    Submit an answer to a diagnostic question and get updated state.
    """
    state = _sessions.get(investigation_id)
    if not state:
        return {"error": "Investigation not found"}

    if state.status != "active":
        return {"error": f"Investigation is {state.status}, cannot submit new answers."}

    question = QUESTION_MAP.get(question_id)
    if not question:
        return {"error": f"Unknown question: {question_id}"}

    if answer_index < 0 or answer_index >= len(question.response_options):
        return {"error": f"Invalid answer index: {answer_index}"}

    answer_text = question.response_options[answer_index]

    # Check for contradiction
    contradiction = _detect_contradiction(state, question, answer_index)
    contradicts_image = contradiction is not None
    if contradiction:
        state.contradictions.append(contradiction)

    # Record evidence
    evidence_item = {
        "question_id": question_id,
        "question_text": question.text,
        "answer": answer_text,
        "answer_index": answer_index,
        "timestamp": time.time(),
        "contradicts_image": contradicts_image,
    }
    state.evidence.append(evidence_item)
    state.asked_questions.append(question_id)
    state.questions_used += 1

    # Bayesian update
    old_posteriors = copy.deepcopy(state.posteriors)

    # Handle "Unsure" / "Cannot determine" answers: minimal update
    unsure_keywords = ["unsure", "cannot determine", "don't know"]
    if any(kw in answer_text.lower() for kw in unsure_keywords):
        # Mild uniform update — barely changes posteriors
        updated = {h: p * 0.99 + 0.01 / len(STRESS_HYPOTHESES) for h, p in state.posteriors.items()}
        state.posteriors = _normalize(updated)
    else:
        state.posteriors = _update_posteriors(state.posteriors, question, answer_index)

    # Record trace
    state.investigation_trace.append({
        "step": state.questions_used,
        "action": "answer_submitted",
        "question_id": question_id,
        "question_text": question.text,
        "answer": answer_text,
        "answer_index": answer_index,
        "contradicts_image": contradicts_image,
        "contradiction_detail": contradiction,
        "posteriors_before": old_posteriors,
        "posteriors_after": copy.deepcopy(state.posteriors),
        "timestamp": time.time(),
    })

    state.updated_at = time.time()

    # Check stopping conditions
    should_stop, reason = _check_stopping_conditions(state)

    if should_stop:
        top_h = max(state.posteriors, key=state.posteriors.get)
        top_p = state.posteriors[top_h]
        state.confidence = top_p
        state.diagnosis = top_h

        if reason == "contradictions_need_expert":
            state.status = "expert_review"
            state.expert_review_reason = "Multiple contradictions between image analysis and field observations require expert assessment."
        elif top_p < 0.40:
            state.status = "unresolved"
            state.expert_review_reason = "No hypothesis reached sufficient confidence."
        else:
            state.status = "resolved"

        state.investigation_trace.append({
            "step": state.questions_used,
            "action": "investigation_concluded",
            "status": state.status,
            "reason": reason,
            "diagnosis": state.diagnosis,
            "confidence": state.confidence,
            "timestamp": time.time(),
        })

        next_q = None
        candidates = []
    else:
        # Select next question
        if state.strategy == "information_gain":
            next_q = _select_next_question_ig(state)
        else:
            next_q = _select_next_question_fixed(state)
        candidates = _get_candidate_questions(state)

    return {
        "investigation_id": investigation_id,
        "status": state.status,
        "posteriors": {h: round(p, 4) for h, p in state.posteriors.items()},
        "sorted_hypotheses": _sorted_hypotheses(state),
        "evidence": state.evidence,
        "next_question": _question_to_dict(next_q) if next_q else None,
        "candidate_questions": candidates,
        "questions_used": state.questions_used,
        "question_budget": state.question_budget,
        "contradictions": state.contradictions,
        "latest_contradiction": contradiction,
        "diagnosis": state.diagnosis,
        "confidence": round(state.confidence, 4) if state.confidence else None,
        "expert_review_reason": state.expert_review_reason,
    }


async def conclude_investigation(investigation_id: str) -> dict:
    """
    Conclude an investigation and generate final advisory.
    """
    state = _sessions.get(investigation_id)
    if not state:
        return {"error": "Investigation not found"}

    top_h = max(state.posteriors, key=state.posteriors.get)
    top_p = state.posteriors[top_h]
    state.diagnosis = top_h
    state.confidence = top_p

    if state.status == "active":
        if top_p < 0.40:
            state.status = "unresolved"
        elif len(state.contradictions) >= 2:
            state.status = "expert_review"
        else:
            state.status = "resolved"

    # Generate LLM advisory
    advisory = await _groq_generate_advisory(state)
    state.recommendations = advisory.get("recommendations", [])

    if advisory.get("needs_expert_review") and state.status != "expert_review":
        state.status = "expert_review"
        state.expert_review_reason = advisory.get("expert_review_reason", "LLM recommended expert review")

    state.investigation_trace.append({
        "step": state.questions_used + 1,
        "action": "investigation_finalized",
        "status": state.status,
        "diagnosis": state.diagnosis,
        "confidence": state.confidence,
        "advisory": advisory,
        "timestamp": time.time(),
    })

    return {
        "investigation_id": investigation_id,
        "status": state.status,
        "diagnosis": state.diagnosis,
        "diagnosis_description": STRESS_DESCRIPTIONS.get(state.diagnosis, ""),
        "confidence": round(state.confidence, 4),
        "posteriors": {h: round(p, 4) for h, p in state.posteriors.items()},
        "sorted_hypotheses": _sorted_hypotheses(state),
        "evidence": state.evidence,
        "contradictions": state.contradictions,
        "advisory": advisory,
        "investigation_trace": state.investigation_trace,
        "questions_used": state.questions_used,
        "question_budget": state.question_budget,
        "strategy": state.strategy,
        "expert_review_reason": state.expert_review_reason,
    }


def get_investigation(investigation_id: str) -> Optional[dict]:
    """Get current state of an investigation."""
    state = _sessions.get(investigation_id)
    if not state:
        return None

    next_q = None
    candidates = []
    if state.status == "active":
        if state.strategy == "information_gain":
            next_q = _select_next_question_ig(state)
        else:
            next_q = _select_next_question_fixed(state)
        candidates = _get_candidate_questions(state)

    return {
        "investigation_id": investigation_id,
        "status": state.status,
        "posteriors": {h: round(p, 4) for h, p in state.posteriors.items()},
        "sorted_hypotheses": _sorted_hypotheses(state),
        "evidence": state.evidence,
        "next_question": _question_to_dict(next_q) if next_q else None,
        "candidate_questions": candidates,
        "questions_used": state.questions_used,
        "question_budget": state.question_budget,
        "contradictions": state.contradictions,
        "diagnosis": state.diagnosis,
        "confidence": round(state.confidence, 4) if state.confidence else None,
        "strategy": state.strategy,
        "expert_review_reason": state.expert_review_reason,
    }


def run_comparison(image_analysis: dict, field_context: dict,
                   simulated_answers: dict, question_budget: int = 6) -> dict:
    """
    Run both information_gain and fixed_order strategies side by side
    with the same simulated answers for comparison.

    Args:
        simulated_answers: dict of question_id -> answer_index
    """
    results = {}
    for strategy in ["information_gain", "fixed_order"]:
        inv = start_investigation(image_analysis, field_context, question_budget, strategy)
        inv_id = inv["investigation_id"]

        while inv["status"] == "active" and inv.get("next_question"):
            q_id = inv["next_question"]["id"]
            ans_idx = simulated_answers.get(q_id, len(QUESTION_MAP[q_id].response_options) - 1)  # default to last (unsure)
            inv = submit_answer(inv_id, q_id, ans_idx)

        results[strategy] = {
            "diagnosis": inv.get("diagnosis"),
            "confidence": inv.get("confidence"),
            "questions_used": inv.get("questions_used"),
            "questions_asked": _sessions[inv_id].asked_questions.copy(),
            "final_posteriors": inv.get("posteriors"),
            "contradictions": inv.get("contradictions"),
            "status": inv.get("status"),
        }

        # Clean up
        del _sessions[inv_id]

    return results


# ── Helper Functions ──────────────────────────────────────────────────

def _question_to_dict(q: DiagnosticQuestion) -> dict:
    return {
        "id": q.id,
        "text": q.text,
        "category": q.category,
        "response_options": q.response_options,
        "cost": q.cost,
    }


def _get_candidate_questions(state: InvestigationState) -> list:
    """Get all available questions with their EIG scores."""
    available = [q for q in QUESTION_BANK if q.id not in state.asked_questions]
    candidates = []
    for q in available:
        eig = _expected_information_gain(q, state.posteriors)
        candidates.append({
            "id": q.id,
            "text": q.text,
            "category": q.category,
            "expected_information_gain": round(eig, 4),
            "cost": q.cost,
        })
    candidates.sort(key=lambda x: x["expected_information_gain"], reverse=True)
    return candidates


def _sorted_hypotheses(state: InvestigationState) -> list:
    """Get hypotheses sorted by probability."""
    return [
        {
            "hypothesis": h,
            "probability": round(p, 4),
            "description": STRESS_DESCRIPTIONS.get(h, ""),
        }
        for h, p in sorted(state.posteriors.items(), key=lambda x: x[1], reverse=True)
    ]


# ── Labeled Test Cases ────────────────────────────────────────────────

LABELED_CASES = [
    {
        "case_id": "TC01_ambiguous_blight",
        "description": "Ambiguous symptom — could be early or late blight",
        "image_analysis": {
            "prediction": "disease_stress",
            "confidence": 0.72,
            "breakdown": {"disease_stress": 0.72, "healthy": 0.10, "nutrients_stress": 0.08, "water_stress": 0.10},
        },
        "field_context": {"crop": "tomato", "location": "Nashik, Maharashtra", "season": "Kharif", "growth_stage": "fruiting"},
        "simulated_answers": {
            "q_lesion_shape": 0,  # Circular with rings
            "q_lesion_color": 1,  # Dark brown concentric
            "q_affected_leaves": 0,  # Older/lower leaves first
            "q_recent_weather": 0,  # Hot and humid
            "q_spread_speed": 1,  # Gradually over weeks
            "q_mold_presence": 1,  # Dark powdery spores
        },
        "expected_diagnosis": "early_blight",
        "demonstrates": "ambiguous_symptom_resolved",
    },
    {
        "case_id": "TC02_contradiction_case",
        "description": "Image says healthy, but observer reports symptoms (contradiction)",
        "image_analysis": {
            "prediction": "healthy",
            "confidence": 0.82,
            "breakdown": {"disease_stress": 0.05, "healthy": 0.82, "nutrients_stress": 0.08, "water_stress": 0.05},
        },
        "field_context": {"crop": "tomato", "location": "Pune, Maharashtra", "season": "Rabi", "growth_stage": "vegetative"},
        "simulated_answers": {
            "q_lesion_shape": 2,  # Small dark spots
            "q_lesion_color": 0,  # Brown/tan with yellow halo
            "q_affected_leaves": 3,  # Random scattered
            "q_recent_weather": 0,  # Hot and humid
            "q_watering": 0,  # Overhead irrigation
            "q_spread_speed": 0,  # Very rapidly
        },
        "expected_diagnosis": "bacterial_spot",
        "demonstrates": "contradictory_context",
    },
    {
        "case_id": "TC03_unresolved_case",
        "description": "Unclear symptoms with unanswered questions — remains unresolved",
        "image_analysis": {
            "prediction": "uncertain",
            "confidence": 0.28,
            "breakdown": {"disease_stress": 0.30, "healthy": 0.25, "nutrients_stress": 0.25, "water_stress": 0.20},
        },
        "field_context": {"crop": "tomato", "location": "Nagpur, Maharashtra", "season": "Kharif", "growth_stage": "seedling"},
        "simulated_answers": {
            "q_lesion_shape": 5,  # Cannot determine
            "q_lesion_color": 6,  # Normal green
            "q_affected_leaves": 4,  # No leaves affected
            "q_recent_weather": 3,  # Mild with normal rain
            "q_watering": 4,  # Adequate and regular
            "q_spread_speed": 3,  # Unsure
        },
        "expected_diagnosis": None,
        "demonstrates": "unresolved_case",
    },
    {
        "case_id": "TC04_poor_image_quality",
        "description": "Poor quality field image with low confidence prediction",
        "image_analysis": {
            "prediction": "uncertain",
            "confidence": 0.31,
            "breakdown": {"disease_stress": 0.31, "healthy": 0.23, "nutrients_stress": 0.24, "water_stress": 0.22},
        },
        "field_context": {"crop": "tomato", "location": "Solapur, Maharashtra", "season": "Summer", "growth_stage": "flowering", "image_quality": "poor — blurry, taken at dusk"},
        "simulated_answers": {
            "q_lesion_shape": 5,  # Cannot determine
            "q_lesion_color": 4,  # Uniform yellowing
            "q_affected_leaves": 0,  # Older/lower leaves
            "q_recent_weather": 2,  # Hot and dry
            "q_watering": 3,  # Inconsistent watering
            "q_fertilization": 4,  # No fertilization
        },
        "expected_diagnosis": "nutrient_deficiency",
        "demonstrates": "poor_quality_image",
    },
    {
        "case_id": "TC05_useful_followup",
        "description": "Initial ambiguity resolved by useful follow-up answer about mold",
        "image_analysis": {
            "prediction": "disease_stress",
            "confidence": 0.65,
            "breakdown": {"disease_stress": 0.65, "healthy": 0.12, "nutrients_stress": 0.10, "water_stress": 0.13},
        },
        "field_context": {"crop": "tomato", "location": "Kolhapur, Maharashtra", "season": "Monsoon", "growth_stage": "fruiting"},
        "simulated_answers": {
            "q_lesion_shape": 1,  # Irregular water-soaked
            "q_mold_presence": 0,  # White fuzzy mold underside
            "q_recent_weather": 1,  # Cool and wet
            "q_spread_speed": 0,  # Very rapidly
        },
        "expected_diagnosis": "late_blight",
        "demonstrates": "useful_followup_answer",
    },
]


def get_labeled_cases() -> list:
    """Return all labeled test cases."""
    return LABELED_CASES


def run_all_test_cases() -> list:
    """Run all labeled test cases and return comparison results."""
    results = []
    for case in LABELED_CASES:
        comparison = run_comparison(
            case["image_analysis"],
            case["field_context"],
            case["simulated_answers"],
            question_budget=6,
        )
        results.append({
            "case_id": case["case_id"],
            "description": case["description"],
            "demonstrates": case["demonstrates"],
            "expected_diagnosis": case["expected_diagnosis"],
            "information_gain": comparison["information_gain"],
            "fixed_order": comparison["fixed_order"],
            "ig_correct": comparison["information_gain"]["diagnosis"] == case["expected_diagnosis"],
            "fixed_correct": comparison["fixed_order"]["diagnosis"] == case["expected_diagnosis"],
        })
    return results
