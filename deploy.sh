#!/bin/bash
# G4 Offers — Deploy Script
# Configura GCP, secrets, e deploya a API no Cloud Run
set -euo pipefail

PROJECT_ID="g4-cobranca-pipeline"
REGION="southamerica-east1"
SERVICE="g4-offers-api"
REGISTRY="${REGION}-docker.pkg.dev/${PROJECT_ID}/cobranca-api"
IMAGE="${REGISTRY}/g4-offers-api:latest"

echo "=== G4 Offers Deploy ==="
echo "Project: ${PROJECT_ID}"
echo "Region:  ${REGION}"
echo "Service: ${SERVICE}"
echo ""

# 1. Autenticar
echo "[1/7] Autenticando no GCP..."
gcloud config set project ${PROJECT_ID}

# 2. Criar secrets (se não existirem)
echo "[2/7] Configurando secrets..."
for SECRET in hubspot-token offers-api-key offers-admin-key serasa-api-key; do
  if ! gcloud secrets describe ${SECRET} &>/dev/null 2>&1; then
    echo "  Criando secret: ${SECRET}"
    echo -n "PLACEHOLDER" | gcloud secrets create ${SECRET} --data-file=-
    echo "  ⚠  Atualize o secret '${SECRET}' com o valor real:"
    echo "     gcloud secrets versions add ${SECRET} --data-file=<(echo -n 'VALOR_REAL')"
  else
    echo "  Secret '${SECRET}' já existe"
  fi
done

# 3. Copiar modelo do G4 Collections
echo "[3/7] Copiando modelo ML..."
mkdir -p model
cp ../g4_cobranca/outputs/model_v2.pkl model/ 2>/dev/null || echo "  ⚠  model_v2.pkl não encontrado localmente. Será baixado do GCS no runtime."

# 4. Build Docker
echo "[4/7] Building Docker image..."
gcloud auth configure-docker ${REGION}-docker.pkg.dev --quiet
docker build -t ${IMAGE} .

# 5. Push
echo "[5/7] Pushing image..."
docker push ${IMAGE}

# 6. Deploy Cloud Run
echo "[6/7] Deploying to Cloud Run..."
gcloud run deploy ${SERVICE} \
  --image ${IMAGE} \
  --region ${REGION} \
  --platform managed \
  --allow-unauthenticated \
  --memory 1Gi \
  --cpu 1 \
  --min-instances 0 \
  --max-instances 5 \
  --timeout 60 \
  --set-env-vars "\
G4_MODEL_PATH=/app/model/model_v2.pkl,\
G4_OFFERS_CONFIG=/app/config.yaml,\
GCP_PROJECT=${PROJECT_ID}" \
  --set-secrets "\
HUBSPOT_ACCESS_TOKEN=hubspot-token:latest,\
G4_OFFERS_API_KEY=offers-api-key:latest,\
G4_OFFERS_ADMIN_KEY=offers-admin-key:latest"

# 7. Verificar
echo "[7/7] Verificando deploy..."
URL=$(gcloud run services describe ${SERVICE} --region ${REGION} --format 'value(status.url)')
echo ""
echo "✓ Deploy completo!"
echo "  URL: ${URL}"
echo "  Health: ${URL}/health"
echo ""
echo "Próximos passos:"
echo "  1. Atualize os secrets com valores reais"
echo "  2. Configure o HubSpot App (ver hubspot-app.json)"
echo "  3. Execute POST ${URL}/v1/setup/hubspot-properties para criar custom properties"
echo "  4. Configure webhooks no HubSpot apontando para ${URL}/v1/webhooks/hubspot/deal-update"
