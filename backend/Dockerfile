FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential gcc \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend /app/backend
COPY tools /app/tools
COPY shared /app/shared
COPY frontend/public/items /app/frontend/public/items

WORKDIR /app/backend
ENV RISKARENA_ROOT=/app

EXPOSE 8001

CMD ["sh", "-c", "python init_db.py && uvicorn server:app --host 0.0.0.0 --port ${PORT:-8001}"]
