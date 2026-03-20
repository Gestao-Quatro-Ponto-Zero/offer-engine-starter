# G4 Offer Engine

Motor de condições comerciais baseado em risco para a G4 Educação.

## O que é

Sistema que calcula automaticamente as melhores condições de pagamento para cada deal, baseado no score de risco do cliente (0-1000).

### Score de Risco (3 dimensões)
- **ML Interno (50%)** — Histórico de pagamentos, aging, comportamento
- **Bureau/Serasa (30%)** — Score de crédito externo
- **Behavioral/HubSpot (20%)** — Engajamento, NPS, ciclo de venda

### Faixas de Risco
| Faixa | Score | Condições |
|-------|-------|-----------|
| A+ | 850-1000 | Até 12x sem entrada, Pix com 8% desc |
| A | 700-849 | Até 10x com 20% entrada, Pix com 6% desc |
| B | 500-699 | Até 8x com 30% entrada, Pix com 4% desc |
| C | 300-499 | Até 6x com 40% entrada, Estruturado, Pix com 3% desc |
| D | 0-299 | À vista ou Pix com 3% desc, Estruturado com caução |

### Funcionalidades
- **4 Modais de Pagamento**: Cartão (parcelado), Pix (com desconto), Boleto, Estruturado
- **Saída Inteligente**: Sugestões alternativas quando deal excede limite (split, entrada mínima, estruturado)
- **Cap Absoluto**: Limite máximo de R$80k em descontos ecossistema
- **Pagamento Estruturado**: Início diferido (60 dias) + cheque caução + promissória digital
- **Descontos Ecossistema**: Descontos progressivos para clientes recorrentes
- **Overrides por BU/Produto**: Regras customizadas por business unit
- **Admin Panel**: Painel completo para diretoria editar todas as regras
- **Simulador**: Simulação interativa de ofertas em tempo real
- **API REST**: 22 endpoints FastAPI para integração com HubSpot

## Stack

- **Backend**: Python 3.11+ / FastAPI / Pydantic
- **Frontend**: Next.js 15 (dashboard), HTML standalone (simulator/admin)
- **Integração**: HubSpot CRM API
- **Deploy**: EKS / Docker (um container com API + front estático), AWS App Runner, Vercel

## Estrutura

```
├── api.py                 # FastAPI — 22 endpoints
├── offer_engine.py        # Motor de regras e cálculos
├── models.py              # Modelos Pydantic
├── risk_scorer.py         # Calculadora de score de risco
├── rules_store.py         # Persistência de regras
├── hubspot_client.py      # Integração HubSpot
├── config.yaml            # Configuração geral
├── simulator.html         # Simulador standalone
├── admin.html             # Painel administrativo
├── video-demo.html        # Demo auto-play
├── dashboard/             # Next.js 15 dashboard
├── tests/                 # 34 testes automatizados
├── Dockerfile             # Container da API
├── deploy.sh              # Script de deploy
└── .github/               # CI/CD workflows
```

## Quick Start

```bash
# Backend
pip install -r requirements.txt
uvicorn api:app --reload

# Dashboard
cd dashboard && npm install && npm run dev
```

## Docker / EKS (backend + frontend no mesmo pod)

O `Dockerfile` usa **multi-stage build**: primeiro gera o Next.js em modo estático (`dashboard/out`), depois copia para a imagem Python. A FastAPI (`api.py`) monta esses arquivos em `/` quando `dashboard/out` existe; a API continua em `/v1` e `/health`.

```bash
docker build -t g4-offer-engine .
docker run -p 8080:8080 g4-offer-engine
# UI: http://localhost:8080/   | API: http://localhost:8080/v1/...  | health: /health
```

No **EKS**, use **um** Deployment/Service (uma porta, ex. 8080). O Ingress deve encaminhar o tráfego HTTP para esse serviço; não é necessário um segundo deployment só para o front. Se a API estiver em outro host, faça o build com `--build-arg NEXT_PUBLIC_API_URL=https://sua-api.exemplo.com`.

## URLs (Vercel)

- **Simulador**: https://g4-offer-simulator.vercel.app
- **Admin**: https://g4-offer-simulator.vercel.app/admin.html
- **Demo**: https://g4-offer-simulator.vercel.app/demo.html

## Licença

Proprietário — G4 Educação. Uso interno.
