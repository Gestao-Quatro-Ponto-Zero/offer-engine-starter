"""HubSpot Integration — API v3 client + CRM Card + Webhooks.

Responsabilidades:
  1. Ler dados de deals, contacts, companies
  2. Escrever custom properties (score, ofertas) nos deals
  3. Servir dados para o CRM Card (inline no HubSpot)
  4. Receber e processar webhooks de mudança de deal
  5. Criar custom properties no setup inicial
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any, Optional

import httpx

from models import (
    HubSpotDealUpdate,
    HubSpotWebhookEvent,
    OfferMenu,
    OfferStatus,
    PaymentOption,
    RiskScoreResult,
)

# =====================================================================
# CONFIG
# =====================================================================

HUBSPOT_API_BASE = "https://api.hubapi.com"
PROPERTY_GROUP = "g4_offers"
PROPERTY_GROUP_LABEL = "G4 Offers"


def _get_token() -> str:
    token = os.getenv("HUBSPOT_ACCESS_TOKEN", "")
    if not token:
        raise ValueError("HUBSPOT_ACCESS_TOKEN not set")
    return token


def _headers() -> dict:
    return {
        "Authorization": f"Bearer {_get_token()}",
        "Content-Type": "application/json",
    }


# =====================================================================
# SETUP: Criar custom properties no HubSpot (run once)
# =====================================================================

# Abordagem híbrida: apenas 3 properties essenciais no HubSpot
# (filtros, workflows, reports). Detalhes completos via CRM Card + backend.
ESSENTIAL_PROPERTIES = [
    {"name": "g4_risk_score", "label": "G4 Risk Score", "type": "number", "fieldType": "number",
     "description": "Score de risco composto G4 Offers (0-1000). Quanto maior, menor o risco."},
    {"name": "g4_risk_grade", "label": "G4 Risk Grade", "type": "enumeration", "fieldType": "select",
     "description": "Faixa de risco do cliente: A+ (excelente) a D (alto risco)", "options": [
        {"label": "A+", "value": "A+", "displayOrder": 1},
        {"label": "A", "value": "A", "displayOrder": 2},
        {"label": "B", "value": "B", "displayOrder": 3},
        {"label": "C", "value": "C", "displayOrder": 4},
        {"label": "D", "value": "D", "displayOrder": 5},
    ]},
    {"name": "g4_offer_status", "label": "G4 Offer Status", "type": "enumeration", "fieldType": "select",
     "description": "Status da oferta de pagamento do G4 Offers", "options": [
        {"label": "Pendente", "value": "pending", "displayOrder": 1},
        {"label": "Gerada", "value": "generated", "displayOrder": 2},
        {"label": "Apresentada", "value": "presented", "displayOrder": 3},
        {"label": "Aceita", "value": "accepted", "displayOrder": 4},
        {"label": "Rejeitada", "value": "rejected", "displayOrder": 5},
        {"label": "Expirada", "value": "expired", "displayOrder": 6},
    ]},
]


async def setup_custom_properties() -> dict:
    """Cria property group e todas as custom properties no HubSpot.

    Idempotente — pula properties que já existem.
    """
    async with httpx.AsyncClient(timeout=30) as client:
        # 1. Create property group
        group_url = f"{HUBSPOT_API_BASE}/crm/v3/properties/deals/groups"
        group_body = {
            "name": PROPERTY_GROUP,
            "label": PROPERTY_GROUP_LABEL,
            "displayOrder": 0,
        }
        resp = await client.post(group_url, json=group_body, headers=_headers())
        group_created = resp.status_code in (200, 201)
        group_exists = resp.status_code == 409

        # 2. Create properties
        prop_url = f"{HUBSPOT_API_BASE}/crm/v3/properties/deals"
        created = []
        skipped = []

        for prop in ESSENTIAL_PROPERTIES:
            body = {**prop, "groupName": PROPERTY_GROUP}
            resp = await client.post(prop_url, json=body, headers=_headers())
            if resp.status_code in (200, 201):
                created.append(prop["name"])
            elif resp.status_code == 409:
                skipped.append(prop["name"])
            else:
                print(f"[HubSpot] Failed to create {prop['name']}: {resp.status_code} {resp.text}")

    return {
        "group": "created" if group_created else ("exists" if group_exists else "error"),
        "properties_created": created,
        "properties_skipped": skipped,
    }


# =====================================================================
# READ: Dados de deals, contacts, companies
# =====================================================================


async def get_deal(deal_id: str) -> dict:
    """Busca deal completo do HubSpot com associations."""
    props = ",".join([
        "dealname", "amount", "dealstage", "pipeline", "closedate",
        "hs_object_id", "createdate", "hubspot_owner_id",
    ] + [p["name"] for p in ESSENTIAL_PROPERTIES])

    url = (
        f"{HUBSPOT_API_BASE}/crm/v3/objects/deals/{deal_id}"
        f"?properties={props}"
        f"&associations=companies,contacts"
    )

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_headers())
        resp.raise_for_status()
        return resp.json()


async def get_company(company_id: str) -> dict:
    """Busca company do HubSpot."""
    props = "name,domain,industry,annualrevenue,numberofemployees,city,state,country"
    url = f"{HUBSPOT_API_BASE}/crm/v3/objects/companies/{company_id}?properties={props}"

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_headers())
        resp.raise_for_status()
        return resp.json()


async def get_contact_engagement(contact_id: str) -> dict:
    """Busca métricas de engajamento de um contato."""
    props = (
        "email,firstname,lastname,"
        "hs_email_open_count,hs_email_click_count,"
        "num_associated_deals,notes_last_updated,"
        "hs_analytics_num_visits"
    )
    url = f"{HUBSPOT_API_BASE}/crm/v3/objects/contacts/{contact_id}?properties={props}"

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, headers=_headers())
        resp.raise_for_status()
        return resp.json()


# =====================================================================
# WRITE: Atualizar deal com score e ofertas
# =====================================================================


async def update_deal_score(deal_id: str, score_result: RiskScoreResult) -> bool:
    """Escreve score e grade no deal do HubSpot (apenas properties essenciais)."""
    properties = {
        "g4_risk_score": str(score_result.g4_risk_score),
        "g4_risk_grade": score_result.grade.value,
    }
    return await _patch_deal(deal_id, properties)


async def update_deal_offers(deal_id: str, menu: OfferMenu) -> bool:
    """Atualiza status da oferta no deal do HubSpot."""
    properties = {
        "g4_offer_status": OfferStatus.GENERATED.value,
    }
    return await _patch_deal(deal_id, properties)


async def update_deal_selection(deal_id: str, selected: PaymentOption, seller: str) -> bool:
    """Registra seleção da oferta — atualiza status no HubSpot."""
    properties = {
        "g4_offer_status": OfferStatus.PRESENTED.value,
    }
    return await _patch_deal(deal_id, properties)


async def update_deal_accepted(deal_id: str, approver: str = "") -> bool:
    """Registra aceitação do cliente — atualiza status no HubSpot."""
    properties: dict[str, str] = {
        "g4_offer_status": OfferStatus.ACCEPTED.value,
    }
    return await _patch_deal(deal_id, properties)


async def _patch_deal(deal_id: str, properties: dict) -> bool:
    """PATCH genérico no deal."""
    url = f"{HUBSPOT_API_BASE}/crm/v3/objects/deals/{deal_id}"
    body = {"properties": properties}

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.patch(url, json=body, headers=_headers())
        if resp.status_code == 200:
            return True
        print(f"[HubSpot] PATCH deal {deal_id} failed: {resp.status_code} {resp.text}")
        return False


# =====================================================================
# CRM CARD: Dados para renderizar no HubSpot
# =====================================================================


def build_crm_card_response(
    score_result: Optional[RiskScoreResult],
    menu: Optional[OfferMenu],
    deal_id: str,
) -> dict:
    """Constrói response para o CRM Card do HubSpot.

    Formato: HubSpot CRM Extensions API v3 response.
    """
    if not score_result:
        return {
            "results": [{
                "objectId": int(deal_id) if deal_id.isdigit() else 0,
                "title": "G4 Offers",
                "properties": [
                    {"label": "Status", "dataType": "STRING", "value": "Aguardando scoring..."},
                ],
                "actions": [
                    {
                        "type": "ACTION_HOOK",
                        "httpMethod": "POST",
                        "uri": f"/v1/score",
                        "label": "Calcular Score",
                    }
                ],
            }],
        }

    # Score properties
    properties = [
        {"label": "Score", "dataType": "NUMERIC", "value": str(score_result.g4_risk_score)},
        {"label": "Faixa", "dataType": "STRING", "value": score_result.grade.value},
        {"label": "Limite", "dataType": "CURRENCY", "value": str(score_result.credit_limit), "currencyCode": "BRL"},
        {"label": "Disponível", "dataType": "CURRENCY", "value": str(score_result.credit_available), "currencyCode": "BRL"},
    ]

    # Offer sections
    sections = []
    if menu and menu.offers:
        for i, offer in enumerate(menu.offers):
            tag = " (Recomendada)" if offer.recommended else ""
            sections.append({
                "id": offer.id,
                "title": f"Opção {i + 1}{tag}",
                "properties": [
                    {"label": "Condição", "dataType": "STRING", "value": offer.label},
                    {"label": "Parcela", "dataType": "CURRENCY", "value": str(offer.installment_value), "currencyCode": "BRL"},
                    {"label": "Total", "dataType": "CURRENCY", "value": str(offer.total_value), "currencyCode": "BRL"},
                ],
                "actions": [
                    {
                        "type": "ACTION_HOOK",
                        "httpMethod": "POST",
                        "uri": f"/v1/offers/{deal_id}/select",
                        "label": "Oferecer",
                        "associatedObjectProperties": ["g4_offer_status"],
                    }
                ],
            })

    # Actions
    actions = [
        {
            "type": "ACTION_HOOK",
            "httpMethod": "POST",
            "uri": f"/v1/score",
            "label": "Recalcular",
        },
        {
            "type": "IFRAME",
            "width": 890,
            "height": 748,
            "uri": f"/v1/hubspot/score-detail/{deal_id}",
            "label": "Ver detalhes do score",
        },
    ]

    result: dict[str, Any] = {
        "results": [{
            "objectId": int(deal_id) if deal_id.isdigit() else 0,
            "title": "G4 Offers",
            "properties": properties,
            "actions": actions,
        }],
    }

    if sections:
        result["results"][0]["sections"] = sections

    return result


# =====================================================================
# BEHAVIORAL DATA: Extrair sinais para scoring
# =====================================================================


async def extract_behavioral_data(deal_id: str) -> dict:
    """Extrai dados comportamentais do HubSpot para o behavioral score.

    Busca deal + contacts associados e computa sinais.
    """
    try:
        deal = await get_deal(deal_id)
    except Exception:
        return {}

    props = deal.get("properties", {})
    data: dict[str, Any] = {}

    # Deal velocity
    create_date = props.get("createdate")
    if create_date:
        try:
            created = datetime.fromisoformat(create_date.replace("Z", "+00:00"))
            days = (datetime.now(timezone.utc) - created).days
            data["days_in_pipeline"] = max(0, days)
        except (ValueError, TypeError):
            pass

    # Custom G4 properties
    for key in ("payment_history_score", "nps_score"):
        val = props.get(key)
        if val is not None:
            try:
                data[key] = float(val)
            except (ValueError, TypeError):
                pass

    # Contact engagement
    assoc = deal.get("associations", {})
    contacts = assoc.get("contacts", {}).get("results", [])
    if contacts:
        contact_id = str(contacts[0].get("id", ""))
        if contact_id:
            try:
                contact = await get_contact_engagement(contact_id)
                c_props = contact.get("properties", {})
                data["email_opens"] = int(c_props.get("hs_email_open_count", 0) or 0)
                data["email_clicks"] = int(c_props.get("hs_email_click_count", 0) or 0)
            except Exception:
                pass

    return data
