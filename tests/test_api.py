"""Testes da API — endpoints e integração."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pytest
from fastapi.testclient import TestClient

# Mock do modelo antes de importar a API
import unittest.mock as mock


def _mock_model_load():
    """Impede carregamento do modelo real nos testes."""
    pass


# Patch model loading
with mock.patch.dict("os.environ", {
    "G4_OFFERS_API_KEY": "test-key",
    "G4_OFFERS_ADMIN_KEY": "test-admin",
    "G4_OFFERS_HUBSPOT_KEY": "test-hubspot",
}):
    import api as api_module
    # Override API keys for testing
    api_module.API_KEYS = {
        "test-key": "system",
        "test-admin": "admin",
        "test-hubspot": "hubspot",
    }
    app = api_module.app

client = TestClient(app)

HEADERS = {"X-API-Key": "test-key"}
ADMIN_HEADERS = {"X-API-Key": "test-admin"}


# =====================================================================
# HEALTH
# =====================================================================


def test_health():
    resp = client.get("/health")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "ok"
    assert data["service"] == "g4-offers"


# =====================================================================
# AUTH
# =====================================================================


def test_unauthorized():
    resp = client.post("/v1/offers/generate", json={
        "deal_id": "123",
        "deal_amount": 50000,
    })
    assert resp.status_code == 401


def test_bad_api_key():
    resp = client.post("/v1/offers/generate", json={
        "deal_id": "123",
        "deal_amount": 50000,
    }, headers={"X-API-Key": "wrong-key"})
    assert resp.status_code == 401


# =====================================================================
# OFFERS
# =====================================================================


def test_generate_offers():
    """Gerar ofertas deve retornar menu válido."""
    resp = client.post("/v1/offers/generate", json={
        "deal_id": "test_001",
        "deal_amount": 45000,
        "bu": "Scale",
    }, headers=HEADERS)
    assert resp.status_code == 200

    data = resp.json()
    assert "offers" in data
    assert len(data["offers"]) >= 2
    assert data["grade"] in ["A+", "A", "B", "C", "D"]

    # Verificar estrutura de cada oferta
    for offer in data["offers"]:
        assert "id" in offer
        assert "label" in offer
        assert "installments" in offer
        assert "total_value" in offer
        assert offer["total_value"] > 0


def test_get_offers_after_generate():
    """GET deve retornar menu gerado anteriormente."""
    # Gerar primeiro
    client.post("/v1/offers/generate", json={
        "deal_id": "test_get_001",
        "deal_amount": 30000,
        "bu": "Scale",
    }, headers=HEADERS)

    # Buscar
    resp = client.get("/v1/offers/test_get_001", headers=HEADERS)
    assert resp.status_code == 200
    assert "offers" in resp.json()


def test_get_offers_not_found():
    """GET para deal sem ofertas deve retornar 404."""
    resp = client.get("/v1/offers/nonexistent", headers=HEADERS)
    assert resp.status_code == 404


def test_select_offer():
    """Selecionar oferta deve funcionar."""
    # Gerar
    gen_resp = client.post("/v1/offers/generate", json={
        "deal_id": "test_select_001",
        "deal_amount": 45000,
        "bu": "Scale",
    }, headers=HEADERS)
    offer_id = gen_resp.json()["offers"][0]["id"]

    # Selecionar
    resp = client.post(f"/v1/offers/test_select_001/select", json={
        "offer_id": offer_id,
        "seller_email": "vendedor@g4.com",
    }, headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["status"] == "presented"


def test_accept_offer():
    """Aceitar oferta deve funcionar."""
    # Gerar
    gen_resp = client.post("/v1/offers/generate", json={
        "deal_id": "test_accept_001",
        "deal_amount": 45000,
        "bu": "Scale",
    }, headers=HEADERS)
    offer_id = gen_resp.json()["offers"][0]["id"]

    # Aceitar
    resp = client.post(f"/v1/offers/test_accept_001/accept", json={
        "offer_id": offer_id,
        "seller_email": "vendedor@g4.com",
    }, headers=HEADERS)
    assert resp.status_code == 200
    assert resp.json()["status"] == "accepted"


# =====================================================================
# EXCEPTIONS
# =====================================================================


def test_request_exception():
    """Solicitar exceção deve criar registro pendente."""
    resp = client.post("/v1/offers/test_exc_001/exception", json={
        "deal_id": "test_exc_001",
        "seller_email": "vendedor@g4.com",
        "desired_conditions": "15x sem juros",
        "justification": "Cliente estratégico, potencial de R$500K em 2026",
        "deal_amount": 50000,
    }, headers=HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "pending"
    assert "exception_id" in data
    assert data["sla_hours"] == 2


def test_approve_exception():
    """Aprovar exceção deve funcionar."""
    # Criar exceção
    exc_resp = client.post("/v1/offers/test_exc_002/exception", json={
        "deal_id": "test_exc_002",
        "seller_email": "vendedor@g4.com",
        "desired_conditions": "15x sem juros",
        "justification": "Cliente estratégico",
        "deal_amount": 50000,
    }, headers=HEADERS)
    exc_id = exc_resp.json()["exception_id"]

    # Aprovar
    resp = client.patch(
        f"/v1/offers/test_exc_002/exception/{exc_id}/approve?approver_email=gerente@g4.com&note=Aprovado",
        headers=HEADERS,
    )
    assert resp.status_code == 200
    assert resp.json()["status"] == "approved"


# =====================================================================
# RULES (Admin)
# =====================================================================


def test_list_rules_empty():
    """Listar regras deve funcionar (pode estar vazio se sem custom rules)."""
    resp = client.get("/v1/rules", headers=ADMIN_HEADERS)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


def test_create_rule_admin_only():
    """Criar regra deve ser admin-only."""
    resp = client.post("/v1/rules", json={
        "name": "Test Rule",
        "grades": ["A"],
        "options": [{
            "type": "parcelado",
            "label_template": "Test",
            "installments_max": 6,
        }],
    }, headers=HEADERS)  # system key, not admin
    assert resp.status_code == 403


# =====================================================================
# DASHBOARD
# =====================================================================


def test_dashboard_summary():
    resp = client.get("/v1/dashboard/summary", headers=HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_scores" in data
    assert "acceptance_rate" in data


def test_dashboard_distribution():
    resp = client.get("/v1/dashboard/distribution", headers=HEADERS)
    assert resp.status_code == 200
    data = resp.json()
    assert "distribution" in data


def test_dashboard_exceptions():
    resp = client.get("/v1/dashboard/exceptions", headers=HEADERS)
    assert resp.status_code == 200


def test_dashboard_audit():
    resp = client.get("/v1/dashboard/audit", headers=HEADERS)
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# =====================================================================
# HUBSPOT
# =====================================================================


def test_hubspot_card():
    """CRM Card deve retornar formato HubSpot válido."""
    resp = client.get("/v1/hubspot/card/123")
    assert resp.status_code == 200
    data = resp.json()
    assert "results" in data
    assert len(data["results"]) >= 1


def test_hubspot_webhook():
    """Webhook deve aceitar eventos."""
    resp = client.post("/v1/webhooks/hubspot/deal-update", json=[{
        "objectId": 12345,
        "subscriptionType": "deal.propertyChange",
        "propertyName": "dealstage",
        "propertyValue": "proposal",
    }])
    assert resp.status_code == 200
    assert resp.json()["status"] == "ok"


# =====================================================================
# RUN
# =====================================================================

if __name__ == "__main__":
    pytest.main([__file__, "-v"])
