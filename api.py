"""G4 Offers API — FastAPI principal.

Endpoints:
  /v1/score              — Scoring
  /v1/offers             — Geração e gestão de ofertas
  /v1/rules              — CRUD de regras (admin)
  /v1/hubspot            — CRM Card + Webhooks
  /v1/exceptions         — Fluxo de exceções
  /v1/dashboard          — KPIs e relatórios
  /health                — Health check
"""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
import uuid
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from typing import Optional

import yaml
from fastapi import FastAPI, Header, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from models import (
    ExceptionRecord,
    ExceptionRequest,
    ExceptionStatus,
    OfferAcceptRequest,
    OfferGenerateRequest,
    OfferMenu,
    OfferSelectRequest,
    OfferStatus,
    RiskGrade,
    RiskScoreResult,
    ScoreRequest,
)

# =====================================================================
# CONFIG
# =====================================================================

_config = None


def _load_config() -> dict:
    global _config
    if _config:
        return _config
    default_path = os.path.join(os.path.dirname(__file__), "config.yaml")
    cfg_path = os.getenv("G4_OFFERS_CONFIG", default_path)
    with open(cfg_path) as f:
        _config = yaml.safe_load(f)
    return _config


# =====================================================================
# AUTH
# =====================================================================

API_KEYS = {
    os.getenv("G4_OFFERS_API_KEY", "g4-offers-2026"): "system",
    os.getenv("G4_OFFERS_HUBSPOT_KEY", "g4-hubspot-2026"): "hubspot",
    os.getenv("G4_OFFERS_ADMIN_KEY", "g4-admin-2026"): "admin",
}


def _verify_api_key(x_api_key: str = Header(default="")) -> str:
    role = API_KEYS.get(x_api_key, "")
    if not role:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return role


# =====================================================================
# IN-MEMORY STATE (substituir por Firestore em prod)
# =====================================================================

# Stores temporários — em produção vão para Firestore
_scores_cache: dict[str, RiskScoreResult] = {}
_offers_cache: dict[str, OfferMenu] = {}
_exceptions_store: dict[str, ExceptionRecord] = {}
_audit_log: list[dict] = []


def _audit(action: str, deal_id: str, user: str, details: dict = None):
    _audit_log.append({
        "id": uuid.uuid4().hex[:12],
        "action": action,
        "deal_id": deal_id,
        "user": user,
        "details": details or {},
        "timestamp": datetime.now(timezone.utc).isoformat(),
    })


# =====================================================================
# LIFESPAN
# =====================================================================


@asynccontextmanager
async def lifespan(app: FastAPI):
    config = _load_config()
    print(f"[G4 Offers] Starting v{config['version']}")
    print(f"[G4 Offers] Risk weights: {config['scoring']['weights']}")

    # Pre-load model (lazy, mas forçar no startup)
    try:
        from risk_scorer import _load_model
        _load_model()
        print("[G4 Offers] ML model loaded successfully")
    except Exception as e:
        print(f"[G4 Offers] ML model load deferred: {e}")

    yield

    print("[G4 Offers] Shutting down")


# =====================================================================
# APP
# =====================================================================

app = FastAPI(
    title="G4 Offers API",
    description="Sistema inteligente de oferta de condições de pagamento risk-based",
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Restringir em produção
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =====================================================================
# HEALTH
# =====================================================================


@app.get("/health")
async def health():
    config = _load_config()
    return {
        "status": "ok",
        "service": "g4-offers",
        "version": config["version"],
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "scores_cached": len(_scores_cache),
        "offers_cached": len(_offers_cache),
        "exceptions_pending": sum(
            1 for e in _exceptions_store.values()
            if e.status == ExceptionStatus.PENDING
        ),
    }


# =====================================================================
# SCORING
# =====================================================================


@app.post("/v1/score")
async def score_deal(
    req: ScoreRequest,
    x_api_key: str = Header(default=""),
):
    """Calcula G4 Risk Score composto para um deal."""
    _verify_api_key(x_api_key)
    config = _load_config()
    weights = config["scoring"]["weights"]

    from risk_scorer import compute_composite_score

    # Buscar dados comportamentais do HubSpot (se token disponível)
    hubspot_data = req.hubspot_data
    if not hubspot_data and os.getenv("HUBSPOT_ACCESS_TOKEN"):
        try:
            from hubspot_client import extract_behavioral_data
            hubspot_data = await extract_behavioral_data(req.deal_id)
        except Exception as e:
            print(f"[Score] HubSpot data fetch failed: {e}")

    # Calcular score composto
    result = await compute_composite_score(
        deal_id=req.deal_id,
        deal_amount=req.deal_amount,
        bu=req.bu,
        company_cnpj=req.company_cnpj,
        customer_data=req.hubspot_data,
        hubspot_data=hubspot_data,
        weights=weights,
    )

    # Cache
    _scores_cache[req.deal_id] = result

    # Escrever no HubSpot
    if os.getenv("HUBSPOT_ACCESS_TOKEN"):
        try:
            from hubspot_client import update_deal_score
            await update_deal_score(req.deal_id, result)
        except Exception as e:
            print(f"[Score] HubSpot update failed: {e}")

    _audit("score", req.deal_id, "system", {
        "score": result.g4_risk_score,
        "grade": result.grade.value,
    })

    return result.model_dump(mode="json")


@app.get("/v1/score/{deal_id}")
async def get_score(
    deal_id: str,
    x_api_key: str = Header(default=""),
):
    """Retorna score atual de um deal (cache)."""
    _verify_api_key(x_api_key)

    result = _scores_cache.get(deal_id)
    if not result:
        raise HTTPException(status_code=404, detail=f"Score not found for deal {deal_id}. POST /v1/score first.")

    return result.model_dump(mode="json")


# =====================================================================
# OFFERS
# =====================================================================


@app.post("/v1/offers/generate")
async def generate_offers(
    req: OfferGenerateRequest,
    x_api_key: str = Header(default=""),
):
    """Gera menu de ofertas de pagamento para um deal."""
    _verify_api_key(x_api_key)

    # Score (usar cache ou calcular)
    score_result = _scores_cache.get(req.deal_id)
    if not score_result:
        # Auto-score
        from risk_scorer import compute_composite_score
        config = _load_config()
        score_result = await compute_composite_score(
            deal_id=req.deal_id,
            deal_amount=req.deal_amount,
            bu=req.bu,
            weights=config["scoring"]["weights"],
        )
        _scores_cache[req.deal_id] = score_result

    # Buscar regras customizadas
    from rules_store import list_rules
    custom_rules = await list_rules(active_only=True)

    # Gerar menu
    from offer_engine import generate_offer_menu
    menu = generate_offer_menu(
        score_result=score_result,
        deal_amount=req.deal_amount,
        bu=req.bu,
        custom_rules=custom_rules if custom_rules else None,
    )

    _offers_cache[req.deal_id] = menu

    # Escrever no HubSpot
    if os.getenv("HUBSPOT_ACCESS_TOKEN"):
        try:
            from hubspot_client import update_deal_offers
            await update_deal_offers(req.deal_id, menu)
        except Exception as e:
            print(f"[Offers] HubSpot update failed: {e}")

    _audit("generate_offers", req.deal_id, "system", {
        "grade": menu.grade.value,
        "n_options": len(menu.offers),
    })

    return menu.model_dump(mode="json")


@app.get("/v1/offers/{deal_id}")
async def get_offers(
    deal_id: str,
    x_api_key: str = Header(default=""),
):
    """Retorna menu de ofertas atual de um deal."""
    _verify_api_key(x_api_key)

    menu = _offers_cache.get(deal_id)
    if not menu:
        raise HTTPException(status_code=404, detail=f"No offers for deal {deal_id}. POST /v1/offers/generate first.")

    return menu.model_dump(mode="json")


@app.post("/v1/offers/{deal_id}/select")
async def select_offer(
    deal_id: str,
    req: OfferSelectRequest,
    x_api_key: str = Header(default=""),
):
    """Vendedor seleciona uma oferta para apresentar ao cliente."""
    _verify_api_key(x_api_key)

    menu = _offers_cache.get(deal_id)
    if not menu:
        raise HTTPException(status_code=404, detail="No offers for this deal")

    selected = None
    for offer in menu.offers:
        if offer.id == req.offer_id:
            selected = offer
            break

    if not selected:
        raise HTTPException(status_code=404, detail=f"Offer {req.offer_id} not found")

    # Escrever no HubSpot
    if os.getenv("HUBSPOT_ACCESS_TOKEN"):
        try:
            from hubspot_client import update_deal_selection
            await update_deal_selection(deal_id, selected, req.seller_email)
        except Exception as e:
            print(f"[Select] HubSpot update failed: {e}")

    _audit("select_offer", deal_id, req.seller_email, {
        "offer_id": req.offer_id,
        "label": selected.label,
    })

    return {
        "status": "presented",
        "deal_id": deal_id,
        "selected": selected.model_dump(mode="json"),
    }


@app.post("/v1/offers/{deal_id}/accept")
async def accept_offer(
    deal_id: str,
    req: OfferAcceptRequest,
    x_api_key: str = Header(default=""),
):
    """Registra aceitação do cliente."""
    _verify_api_key(x_api_key)

    # Escrever no HubSpot
    if os.getenv("HUBSPOT_ACCESS_TOKEN"):
        try:
            from hubspot_client import update_deal_accepted
            await update_deal_accepted(deal_id, req.seller_email)
        except Exception as e:
            print(f"[Accept] HubSpot update failed: {e}")

    _audit("accept_offer", deal_id, req.seller_email, {
        "offer_id": req.offer_id,
    })

    return {
        "status": "accepted",
        "deal_id": deal_id,
        "message": "Oferta aceita pelo cliente. Deal atualizado no HubSpot.",
    }


@app.post("/v1/offers/{deal_id}/reject")
async def reject_offer(
    deal_id: str,
    x_api_key: str = Header(default=""),
):
    """Registra rejeição do cliente."""
    _verify_api_key(x_api_key)

    _audit("reject_offer", deal_id, "client")

    return {"status": "rejected", "deal_id": deal_id}


# =====================================================================
# EXCEPTIONS
# =====================================================================


@app.post("/v1/offers/{deal_id}/exception")
async def request_exception(
    deal_id: str,
    req: ExceptionRequest,
    x_api_key: str = Header(default=""),
):
    """Solicita exceção para condição fora do padrão."""
    _verify_api_key(x_api_key)
    config = _load_config()

    # Determinar aprovador
    score_result = _scores_cache.get(deal_id)
    current_grade = score_result.grade if score_result else RiskGrade.B

    routing = config["offers"]["exceptions"]["approval_routing"]
    approver_role = "vp"
    for route in routing:
        if req.deal_amount <= route["max_amount"]:
            approver_role = route["approver_role"]
            break

    exception_id = f"exc_{uuid.uuid4().hex[:12]}"
    record = ExceptionRecord(
        id=exception_id,
        deal_id=deal_id,
        seller_email=req.seller_email,
        desired_conditions=req.desired_conditions,
        justification=req.justification,
        deal_amount=req.deal_amount,
        current_grade=current_grade,
        approver_role=approver_role,
        created_at=datetime.now(timezone.utc),
    )

    _exceptions_store[exception_id] = record

    _audit("request_exception", deal_id, req.seller_email, {
        "exception_id": exception_id,
        "approver_role": approver_role,
    })

    return {
        "status": "pending",
        "exception_id": exception_id,
        "approver_role": approver_role,
        "sla_hours": config["offers"]["exceptions"]["sla_hours"],
    }


@app.patch("/v1/offers/{deal_id}/exception/{exception_id}/approve")
async def approve_exception(
    deal_id: str,
    exception_id: str,
    approver_email: str = Query(...),
    note: str = Query(""),
    x_api_key: str = Header(default=""),
):
    """Aprova exceção."""
    _verify_api_key(x_api_key)

    record = _exceptions_store.get(exception_id)
    if not record:
        raise HTTPException(status_code=404, detail="Exception not found")

    record.status = ExceptionStatus.APPROVED
    record.approver_email = approver_email
    record.decision_note = note
    record.decided_at = datetime.now(timezone.utc)

    _audit("approve_exception", deal_id, approver_email, {
        "exception_id": exception_id,
    })

    return {"status": "approved", "exception_id": exception_id}


@app.patch("/v1/offers/{deal_id}/exception/{exception_id}/reject")
async def reject_exception(
    deal_id: str,
    exception_id: str,
    approver_email: str = Query(...),
    note: str = Query(""),
    x_api_key: str = Header(default=""),
):
    """Rejeita exceção."""
    _verify_api_key(x_api_key)

    record = _exceptions_store.get(exception_id)
    if not record:
        raise HTTPException(status_code=404, detail="Exception not found")

    record.status = ExceptionStatus.REJECTED
    record.approver_email = approver_email
    record.decision_note = note
    record.decided_at = datetime.now(timezone.utc)

    _audit("reject_exception", deal_id, approver_email, {
        "exception_id": exception_id,
    })

    return {"status": "rejected", "exception_id": exception_id}


# =====================================================================
# RULES (Admin)
# =====================================================================


@app.get("/v1/rules")
async def list_all_rules(
    active_only: bool = Query(True),
    x_api_key: str = Header(default=""),
):
    """Lista todas as regras de oferta."""
    role = _verify_api_key(x_api_key)

    from rules_store import list_rules
    rules = await list_rules(active_only=active_only)
    return [r.model_dump(mode="json") for r in rules]


@app.get("/v1/rules/{rule_id}")
async def get_rule_detail(
    rule_id: str,
    x_api_key: str = Header(default=""),
):
    """Detalhe de uma regra."""
    _verify_api_key(x_api_key)

    from rules_store import get_rule
    rule = await get_rule(rule_id)
    if not rule:
        raise HTTPException(status_code=404, detail="Rule not found")
    return rule.model_dump(mode="json")


@app.post("/v1/rules")
async def create_rule(
    rule: dict,
    x_api_key: str = Header(default=""),
):
    """Cria nova regra de oferta."""
    role = _verify_api_key(x_api_key)
    if role not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")

    from models import OfferRule
    from rules_store import create_rule as store_create

    new_rule = OfferRule(**rule)
    created = await store_create(new_rule)

    _audit("create_rule", "", "admin", {"rule_id": created.id})
    return created.model_dump(mode="json")


@app.put("/v1/rules/{rule_id}")
async def update_rule(
    rule_id: str,
    updates: dict,
    x_api_key: str = Header(default=""),
):
    """Atualiza regra (cria nova versão)."""
    role = _verify_api_key(x_api_key)
    if role not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")

    from rules_store import update_rule as store_update

    updated = await store_update(rule_id, updates)
    if not updated:
        raise HTTPException(status_code=404, detail="Rule not found")

    _audit("update_rule", "", "admin", {"rule_id": rule_id, "version": updated.version})
    return updated.model_dump(mode="json")


@app.post("/v1/rules/{rule_id}/rollback")
async def rollback_rule(
    rule_id: str,
    to_version: int = Query(...),
    x_api_key: str = Header(default=""),
):
    """Rollback para versão anterior."""
    role = _verify_api_key(x_api_key)
    if role not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")

    from rules_store import rollback_rule as store_rollback

    result = await store_rollback(rule_id, to_version)
    if not result:
        raise HTTPException(status_code=404, detail="Version not found")

    _audit("rollback_rule", "", "admin", {"rule_id": rule_id, "to_version": to_version})
    return result.model_dump(mode="json")


@app.get("/v1/rules/{rule_id}/history")
async def get_rule_history(
    rule_id: str,
    x_api_key: str = Header(default=""),
):
    """Histórico de versões de uma regra."""
    _verify_api_key(x_api_key)

    from rules_store import get_rule_history as store_history
    history = await store_history(rule_id)
    return [r.model_dump(mode="json") for r in history]


@app.post("/v1/rules/simulate")
async def simulate_rule(
    rule: dict,
    x_api_key: str = Header(default=""),
):
    """Simula impacto de uma regra nos deals históricos."""
    _verify_api_key(x_api_key)

    from models import OfferRule
    from rules_store import simulate_rule_impact

    test_rule = OfferRule(**rule)

    # Usar deals do cache como amostra
    historical = []
    for deal_id, score in _scores_cache.items():
        historical.append({
            "deal_id": deal_id,
            "g4_risk_grade": score.grade.value,
            "amount": 0,
            "bu": "",
        })

    result = await simulate_rule_impact(test_rule, historical)
    return result


# =====================================================================
# HUBSPOT WEBHOOKS + CRM CARD
# =====================================================================


@app.post("/v1/webhooks/hubspot/deal-update")
async def hubspot_deal_webhook(request: Request):
    """Recebe webhooks do HubSpot quando deal muda.

    Triggers: deal stage change, amount change, company change.
    """
    body = await request.json()

    # HubSpot envia array de eventos
    events = body if isinstance(body, list) else [body]

    for event_data in events:
        try:
            event = HubSpotWebhookEvent(**event_data) if isinstance(event_data, dict) else event_data
        except Exception:
            continue

        deal_id = str(event_data.get("objectId", ""))
        event_type = event_data.get("subscriptionType", event_data.get("event_type", ""))
        prop_name = event_data.get("propertyName", "")
        prop_value = event_data.get("propertyValue", "")

        if not deal_id:
            continue

        # Trigger: stage change para proposal/negotiation
        config = _load_config()
        trigger_stages = config["hubspot"]["scoring_trigger_stages"]

        should_score = False
        if "dealstage" in prop_name and prop_value in trigger_stages:
            should_score = True
        elif "amount" in prop_name:
            should_score = True

        if should_score:
            # Auto-score assíncrono
            try:
                from risk_scorer import compute_composite_score
                result = await compute_composite_score(
                    deal_id=deal_id,
                    deal_amount=float(prop_value) if "amount" in prop_name else 0,
                    bu="Scale",  # TODO: extrair do deal
                    weights=config["scoring"]["weights"],
                )
                _scores_cache[deal_id] = result
                print(f"[Webhook] Auto-scored deal {deal_id}: {result.g4_risk_score} ({result.grade.value})")
            except Exception as e:
                print(f"[Webhook] Auto-score failed for deal {deal_id}: {e}")

    return {"status": "ok", "events_processed": len(events)}


@app.get("/v1/hubspot/card/{deal_id}")
async def hubspot_crm_card(
    deal_id: str,
):
    """Serve dados para o CRM Card no HubSpot.

    Chamado pelo HubSpot CRM Extensions API quando o deal é aberto.
    """
    from hubspot_client import build_crm_card_response

    score_result = _scores_cache.get(deal_id)
    menu = _offers_cache.get(deal_id)

    return build_crm_card_response(score_result, menu, deal_id)


@app.get("/v1/hubspot/score-detail/{deal_id}")
async def hubspot_score_detail(deal_id: str):
    """Serve iframe com detalhes do score (SHAP factors).

    Aberto via botão "Ver detalhes do score" no CRM Card.
    """
    score_result = _scores_cache.get(deal_id)
    if not score_result:
        return JSONResponse(
            content={"error": "Score not found"},
            status_code=404,
        )

    # Retornar HTML com detalhes (simplificado — em produção, servir Next.js)
    factors_html = ""
    for f in score_result.top_factors:
        color = "#22c55e" if f.direction == "reduz_risco" else "#f97316"
        factors_html += f"""
        <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f0f0f0">
            <span>{f.feature}</span>
            <span style="color:{color};font-weight:600">{f.impact}</span>
        </div>
        """

    html = f"""<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><style>
body {{ font-family: -apple-system, sans-serif; padding: 24px; max-width: 600px; margin: 0 auto; }}
h2 {{ color: #1a1a1a; font-size: 18px; }}
.score {{ font-size: 48px; font-weight: 700; color: #2563eb; }}
.grade {{ font-size: 24px; color: #6b7280; margin-left: 12px; }}
.section {{ margin-top: 24px; }}
.component {{ display: flex; justify-content: space-between; padding: 8px 0; }}
</style></head>
<body>
<h2>G4 Risk Score — Deal {deal_id}</h2>
<div>
    <span class="score">{score_result.g4_risk_score}</span>
    <span class="grade">Faixa {score_result.grade.value}</span>
</div>

<div class="section">
    <h3>Composição do Score</h3>
    <div class="component"><span>Interno (ML G4)</span><span><b>{round(score_result.components['internal'].score)}</b> × {score_result.components['internal'].weight}</span></div>
    <div class="component"><span>Bureau (Serasa)</span><span><b>{round(score_result.components['bureau'].score)}</b> × {score_result.components['bureau'].weight}</span></div>
    <div class="component"><span>Comportamental</span><span><b>{round(score_result.components['behavioral'].score)}</b> × {score_result.components['behavioral'].weight}</span></div>
</div>

<div class="section">
    <h3>Fatores Principais</h3>
    {factors_html if factors_html else "<p>Fatores SHAP não disponíveis</p>"}
</div>

<div class="section">
    <h3>Crédito</h3>
    <div class="component"><span>Limite aprovado</span><span>R$ {score_result.credit_limit:,.0f}</span></div>
    <div class="component"><span>Disponível</span><span>R$ {score_result.credit_available:,.0f}</span></div>
</div>
</body></html>"""

    return JSONResponse(
        content=html,
        media_type="text/html",
    )


# =====================================================================
# SETUP
# =====================================================================


@app.post("/v1/setup/hubspot-properties")
async def setup_hubspot_props(
    x_api_key: str = Header(default=""),
):
    """Cria custom properties no HubSpot (run once)."""
    role = _verify_api_key(x_api_key)
    if role not in ("admin",):
        raise HTTPException(status_code=403, detail="Admin only")

    from hubspot_client import setup_custom_properties
    result = await setup_custom_properties()
    return result


# =====================================================================
# DASHBOARD
# =====================================================================


@app.get("/v1/dashboard/summary")
async def dashboard_summary(
    x_api_key: str = Header(default=""),
):
    """KPIs agregados do sistema."""
    _verify_api_key(x_api_key)

    total_scores = len(_scores_cache)
    total_offers = len(_offers_cache)
    avg_score = (
        round(sum(s.g4_risk_score for s in _scores_cache.values()) / total_scores)
        if total_scores > 0 else 0
    )

    accepted = sum(
        1 for a in _audit_log if a["action"] == "accept_offer"
    )
    presented = sum(
        1 for a in _audit_log if a["action"] == "select_offer"
    )
    acceptance_rate = accepted / max(presented, 1)

    return {
        "total_scores": total_scores,
        "total_offers_generated": total_offers,
        "average_risk_score": avg_score,
        "acceptance_rate": round(acceptance_rate, 2),
        "exceptions_pending": sum(
            1 for e in _exceptions_store.values()
            if e.status == ExceptionStatus.PENDING
        ),
        "exceptions_total": len(_exceptions_store),
    }


@app.get("/v1/dashboard/distribution")
async def dashboard_distribution(
    x_api_key: str = Header(default=""),
):
    """Distribuição de deals por faixa de risco."""
    _verify_api_key(x_api_key)

    dist: dict[str, int] = {"A+": 0, "A": 0, "B": 0, "C": 0, "D": 0}
    for score in _scores_cache.values():
        dist[score.grade.value] += 1

    return {
        "distribution": dist,
        "total": len(_scores_cache),
    }


@app.get("/v1/dashboard/exceptions")
async def dashboard_exceptions(
    x_api_key: str = Header(default=""),
):
    """Relatório de exceções."""
    _verify_api_key(x_api_key)

    total = len(_exceptions_store)
    approved = sum(1 for e in _exceptions_store.values() if e.status == ExceptionStatus.APPROVED)
    rejected = sum(1 for e in _exceptions_store.values() if e.status == ExceptionStatus.REJECTED)
    pending = sum(1 for e in _exceptions_store.values() if e.status == ExceptionStatus.PENDING)

    return {
        "total": total,
        "approved": approved,
        "rejected": rejected,
        "pending": pending,
        "approval_rate": round(approved / max(total, 1), 2),
    }


@app.get("/v1/dashboard/audit")
async def dashboard_audit(
    limit: int = Query(50, ge=1, le=500),
    x_api_key: str = Header(default=""),
):
    """Audit log recente."""
    _verify_api_key(x_api_key)
    return _audit_log[-limit:]


# =====================================================================
# FRONTEND (dashboard Next.js + HTML estáticos)
# Servido quando dashboard/out existe (ex.: após build no App Runner)
# =====================================================================

_frontend_dir = os.path.join(os.path.dirname(__file__), "dashboard", "out")
if os.path.isdir(_frontend_dir):
    app.mount("/", StaticFiles(directory=_frontend_dir, html=True), name="frontend")


# =====================================================================
# MAIN
# =====================================================================

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", "8080"))
    uvicorn.run("api:app", host="0.0.0.0", port=port, reload=True)
