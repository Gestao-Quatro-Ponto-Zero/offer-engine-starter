# =============================================================================
# G4 Offer Engine — Backend (FastAPI) + Frontend (Next.js estático + HTML)
# Um único processo: uvicorn serve API em /v1 e /health e arquivos em dashboard/out
# =============================================================================

# --- Stage 1: build do dashboard (Next.js output: export → dashboard/out) ---
FROM node:20-bookworm-slim AS frontend
WORKDIR /build

COPY dashboard/package.json dashboard/package-lock.json ./dashboard/
RUN cd dashboard && npm ci --no-audit

COPY dashboard ./dashboard
COPY admin.html simulator.html video-demo.html ./

# Vazio = front chama /v1 no mesmo host (recomendado no EKS com um único Service)
ARG NEXT_PUBLIC_API_URL=
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
RUN cd dashboard && npm run build && \
    cp ../admin.html ../simulator.html ../video-demo.html out/

# --- Stage 2: Python + artefatos do frontend ---
FROM python:3.12-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    gcc \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Sobrescreve dashboard/out com o build do stage frontend
COPY --from=frontend /build/dashboard/out ./dashboard/out

RUN mkdir -p /app/model
ENV G4_MODEL_PATH="/app/model/model_v2.pkl"
ENV G4_OFFERS_CONFIG="/app/config.yaml"
ENV PORT=8080

EXPOSE 8080

CMD ["python", "-m", "uvicorn", "api:app", "--host", "0.0.0.0", "--port", "8080", "--workers", "2"]
