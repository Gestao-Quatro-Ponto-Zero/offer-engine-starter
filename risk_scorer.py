"""Risk Scoring Engine — Score composto de 3 dimensões.

G4 Risk Score = w1 × Internal + w2 × Bureau + w3 × Behavioral

Internal:  ML model do G4 Collections (prob inadimplência invertida)
Bureau:    Serasa Experian Score PJ (0-1000)
Behavioral: Engajamento e velocidade no HubSpot

Score final: 0-1000 → Faixas A+ / A / B / C / D
"""

from __future__ import annotations

import math
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import numpy as np

from models import (
    RiskGrade,
    RiskScoreResult,
    ScoreComponent,
    ScoreFactor,
)

# ---------------------------------------------------------------------------
# Carregar modelo G4 Collections (lazy singleton)
# ---------------------------------------------------------------------------

_MODEL = None
_EXPLAINER = None


def _collections_model_path() -> str:
    """Resolve o caminho do model_v2.pkl do G4 Collections."""
    # Tentar variável de ambiente primeiro
    env_path = os.getenv("G4_MODEL_PATH")
    if env_path and Path(env_path).exists():
        return env_path

    # Caminho relativo padrão
    here = Path(__file__).resolve().parent
    default = here.parent / "g4_cobranca" / "outputs" / "model_v2.pkl"
    if default.exists():
        return str(default)

    raise FileNotFoundError(
        f"Model not found. Set G4_MODEL_PATH env var or place model at {default}"
    )


def _load_model():
    """Carrega modelo e SHAP explainer (lazy, uma vez)."""
    global _MODEL, _EXPLAINER
    if _MODEL is not None:
        return

    import joblib

    path = _collections_model_path()
    _MODEL = joblib.load(path)
    print(f"[RiskScorer] Model loaded from {path}")

    try:
        import shap
        # O modelo é um Pipeline sklearn: preprocessor + GradientBoostingClassifier
        classifier = _MODEL.named_steps["classifier"]
        _EXPLAINER = shap.TreeExplainer(classifier)
        print("[RiskScorer] SHAP TreeExplainer initialized")
    except Exception as e:
        print(f"[RiskScorer] SHAP init failed (non-fatal): {e}")
        _EXPLAINER = None


# ---------------------------------------------------------------------------
# Features que o modelo espera (do G4 Collections models.py)
# ---------------------------------------------------------------------------

NUM_FEATURES = [
    "log_valor_bruto", "is_premium",
    "dias_entre_competencia_e_vencimento",
    "receita_total", "negociacoes_ganhas", "produtos_comprados_count",
    "valor_primeira_compra", "valor_ultima_compra",
    "tempo_relacionamento_dias", "dias_desde_ultima_compra",
    "kyc_score_max", "kyc_score_total",
    "is_field_sales",
]

CAT_FEATURES = [
    "bu",
    "cluster_rfm",
    "faixa_de_faturamento",
]


# ---------------------------------------------------------------------------
# Internal Score (G4 Collections ML Model)
# ---------------------------------------------------------------------------

def compute_internal_score(
    deal_amount: float,
    bu: str,
    customer_data: Optional[dict] = None,
) -> tuple[float, list[ScoreFactor]]:
    """Calcula score interno usando o modelo G4 Collections.

    Retorna (score 0-1000, lista de fatores SHAP top-5).
    """
    _load_model()
    import pandas as pd

    # Montar feature vector
    data = {
        "log_valor_bruto": math.log1p(deal_amount),
        "is_premium": 1 if bu in ("Club", "Scale") else 0,
        "dias_entre_competencia_e_vencimento": 30,  # default pré-venda
        "receita_total": 0,
        "negociacoes_ganhas": 0,
        "produtos_comprados_count": 0,
        "valor_primeira_compra": 0,
        "valor_ultima_compra": 0,
        "tempo_relacionamento_dias": 0,
        "dias_desde_ultima_compra": 999,
        "kyc_score_max": 0,
        "kyc_score_total": 0,
        "is_field_sales": 0,
        "bu": bu,
        "cluster_rfm": "Novo",
        "faixa_de_faturamento": "Nao informado",
    }

    # Override com dados reais do cliente se disponíveis
    if customer_data:
        for key in data:
            if key in customer_data and customer_data[key] is not None:
                data[key] = customer_data[key]

    feature_cols = NUM_FEATURES + CAT_FEATURES
    df = pd.DataFrame([data])[feature_cols]

    # Score: probabilidade de inadimplência
    prob_default = _MODEL.predict_proba(df)[:, 1][0]

    # Inverter: score alto = bom pagador
    score = (1.0 - prob_default) * 1000
    score = max(0, min(1000, round(score)))

    # SHAP factors
    factors = _compute_shap_factors(df, data, prob_default)

    return score, factors


def _compute_shap_factors(
    df, raw_data: dict, prob_default: float
) -> list[ScoreFactor]:
    """Extrai top 5 fatores via SHAP TreeExplainer."""
    if _EXPLAINER is None:
        return []

    try:
        import pandas as pd

        # Preprocessar para o SHAP (o explainer precisa dos dados transformados)
        preprocessor = _MODEL.named_steps["preprocessor"]
        X_transformed = preprocessor.transform(df)

        shap_values = _EXPLAINER.shap_values(X_transformed)

        # Para classificação binária, shap_values pode ser [neg, pos]
        if isinstance(shap_values, list):
            vals = shap_values[1][0]  # classe positiva (inadimplência)
        else:
            vals = shap_values[0]

        # Mapear nomes de features (inclui one-hot encoded)
        num_names = NUM_FEATURES[:]
        cat_pipeline = preprocessor.named_transformers_["cat"]
        encoder = cat_pipeline.named_steps["encoder"]
        cat_names = list(encoder.get_feature_names_out(CAT_FEATURES))
        all_names = num_names + cat_names

        # Top 5 por magnitude
        pairs = list(zip(all_names, vals))
        pairs.sort(key=lambda x: abs(x[1]), reverse=True)

        factors = []
        for feat_name, shap_val in pairs[:5]:
            # Extrair feature base (antes do one-hot)
            base_feat = feat_name.split("_", 1)[0] if "_" in feat_name else feat_name
            for orig in list(raw_data.keys()):
                if feat_name.startswith(orig):
                    base_feat = orig
                    break

            val = raw_data.get(base_feat, "")
            direction = "aumenta_risco" if shap_val > 0 else "reduz_risco"
            impact_sign = "+" if shap_val < 0 else "-"  # invertido: SHAP+ = mais risco = score menor

            factors.append(ScoreFactor(
                feature=base_feat,
                value=val,
                impact=f"{impact_sign}{abs(round(shap_val * 1000))}",
                direction=direction,
            ))

        return factors

    except Exception as e:
        print(f"[RiskScorer] SHAP computation failed: {e}")
        return []


# ---------------------------------------------------------------------------
# Bureau Score (Serasa Experian)
# ---------------------------------------------------------------------------

async def compute_bureau_score(
    cnpj: Optional[str],
    bureau_client=None,
    cached_score: Optional[float] = None,
) -> float:
    """Consulta score Serasa Experian por CNPJ.

    Retorna score 0-1000. Usa cache se disponível.
    """
    if cached_score is not None:
        return cached_score

    if not cnpj:
        return 500.0  # fallback: score neutro

    if bureau_client:
        try:
            result = await bureau_client.get_score(cnpj)
            return float(result.get("score", 500))
        except Exception as e:
            print(f"[RiskScorer] Bureau query failed for {cnpj}: {e}")
            return 500.0

    return 500.0  # sem client configurado


# ---------------------------------------------------------------------------
# Behavioral Score (HubSpot signals)
# ---------------------------------------------------------------------------

def compute_behavioral_score(hubspot_data: Optional[dict] = None) -> float:
    """Score comportamental baseado em sinais do HubSpot.

    Sinais considerados (0-1000 cada, depois média ponderada):
    - Engajamento com emails (opens, clicks)
    - Velocidade de resposta
    - Frequência de interação (meetings, calls)
    - Deal velocity (dias no pipeline)
    - Histórico de pagamento (custom property)
    - NPS (custom property)
    """
    if not hubspot_data:
        return 500.0  # score neutro sem dados

    scores = []
    weights = []

    # 1. Email engagement (0-1000)
    opens = hubspot_data.get("email_opens", 0) or 0
    clicks = hubspot_data.get("email_clicks", 0) or 0
    if opens > 0:
        engagement = min((clicks / max(opens, 1)) * 2000, 1000)
        scores.append(engagement)
        weights.append(0.15)

    # 2. Response velocity (0-1000) — menor = melhor
    response_hours = hubspot_data.get("avg_response_hours")
    if response_hours is not None:
        # <2h = 1000, 24h = 500, >72h = 200
        if response_hours <= 2:
            vel_score = 1000
        elif response_hours <= 24:
            vel_score = 1000 - (response_hours - 2) * (500 / 22)
        else:
            vel_score = max(200, 500 - (response_hours - 24) * (300 / 48))
        scores.append(vel_score)
        weights.append(0.25)

    # 3. Interaction frequency (0-1000)
    meetings = hubspot_data.get("meetings_count", 0) or 0
    calls = hubspot_data.get("calls_count", 0) or 0
    notes = hubspot_data.get("notes_count", 0) or 0
    total_interactions = meetings + calls + notes
    if total_interactions > 0:
        # 10+ interactions = 1000, 1 = 300
        freq_score = min(300 + total_interactions * 70, 1000)
        scores.append(freq_score)
        weights.append(0.15)

    # 4. Deal velocity (0-1000) — menos dias = melhor
    days_in_pipeline = hubspot_data.get("days_in_pipeline")
    if days_in_pipeline is not None:
        # <7d = 1000, 30d = 600, 90d+ = 200
        if days_in_pipeline <= 7:
            vel = 1000
        elif days_in_pipeline <= 30:
            vel = 1000 - (days_in_pipeline - 7) * (400 / 23)
        else:
            vel = max(200, 600 - (days_in_pipeline - 30) * (400 / 60))
        scores.append(vel)
        weights.append(0.20)

    # 5. Payment history (custom property, 0-1000 direto)
    payment_score = hubspot_data.get("payment_history_score")
    if payment_score is not None:
        scores.append(min(float(payment_score), 1000))
        weights.append(0.15)

    # 6. NPS (0-1000)
    nps = hubspot_data.get("nps_score")
    if nps is not None:
        # NPS -100 a 100 → 0 a 1000
        nps_normalized = (float(nps) + 100) / 200 * 1000
        scores.append(max(0, min(1000, nps_normalized)))
        weights.append(0.10)

    if not scores:
        return 500.0

    # Média ponderada normalizada
    total_weight = sum(weights)
    weighted_sum = sum(s * w for s, w in zip(scores, weights))
    return round(weighted_sum / total_weight)


# ---------------------------------------------------------------------------
# Score Composto
# ---------------------------------------------------------------------------

GRADE_THRESHOLDS = [
    (850, RiskGrade.A_PLUS),
    (700, RiskGrade.A),
    (500, RiskGrade.B),
    (300, RiskGrade.C),
    (0, RiskGrade.D),
]


def _score_to_grade(score: int) -> RiskGrade:
    for threshold, grade in GRADE_THRESHOLDS:
        if score >= threshold:
            return grade
    return RiskGrade.D


CREDIT_LIMITS = {
    RiskGrade.A_PLUS: 500_000,
    RiskGrade.A: 300_000,
    RiskGrade.B: 200_000,
    RiskGrade.C: 100_000,
    RiskGrade.D: 50_000,
}


async def compute_composite_score(
    deal_id: str,
    deal_amount: float,
    bu: str,
    company_cnpj: Optional[str] = None,
    customer_data: Optional[dict] = None,
    hubspot_data: Optional[dict] = None,
    bureau_client=None,
    cached_bureau_score: Optional[float] = None,
    weights: Optional[dict] = None,
    existing_credit_used: float = 0,
) -> RiskScoreResult:
    """Calcula o G4 Risk Score composto.

    Combina 3 dimensões com pesos configuráveis:
    - Internal (ML model G4 Collections)
    - Bureau (Serasa Experian)
    - Behavioral (HubSpot signals)
    """
    w = weights or {"internal": 0.50, "bureau": 0.30, "behavioral": 0.20}

    # 1. Internal score
    internal_raw, factors = compute_internal_score(deal_amount, bu, customer_data)

    # 2. Bureau score
    bureau_raw = await compute_bureau_score(
        company_cnpj, bureau_client, cached_bureau_score
    )
    bureau_cached = cached_bureau_score is not None

    # 3. Behavioral score
    behavioral_raw = compute_behavioral_score(hubspot_data)

    # Composite
    composite = (
        internal_raw * w["internal"]
        + bureau_raw * w["bureau"]
        + behavioral_raw * w["behavioral"]
    )
    composite = max(0, min(1000, round(composite)))

    grade = _score_to_grade(composite)
    credit_limit = CREDIT_LIMITS.get(grade, 50_000)
    credit_available = max(0, credit_limit - existing_credit_used)

    now = datetime.now(timezone.utc)

    return RiskScoreResult(
        deal_id=deal_id,
        g4_risk_score=composite,
        grade=grade,
        components={
            "internal": ScoreComponent(
                score=internal_raw,
                weight=w["internal"],
                contribution=round(internal_raw * w["internal"]),
                source="g4_collections_model_v2",
            ),
            "bureau": ScoreComponent(
                score=bureau_raw,
                weight=w["bureau"],
                contribution=round(bureau_raw * w["bureau"]),
                source="serasa_experian",
                cached=bureau_cached,
                cache_date=now if not bureau_cached else None,
            ),
            "behavioral": ScoreComponent(
                score=behavioral_raw,
                weight=w["behavioral"],
                contribution=round(behavioral_raw * w["behavioral"]),
                source="hubspot",
            ),
        },
        credit_limit=credit_limit,
        credit_available=credit_available,
        top_factors=factors,
        scored_at=now,
    )
