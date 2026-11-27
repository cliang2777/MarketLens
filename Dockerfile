FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080

WORKDIR /app

# Install lean web runtime dependencies (excludes dev/plotting libs for fast Cloud Run cold starts)
COPY requirements-prod.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements-prod.txt

COPY research ./research
COPY backend ./backend
COPY run.py .

EXPOSE 8080

CMD ["sh", "-c", "exec uvicorn backend.app.main:app --host 0.0.0.0 --port ${PORT:-8080} --workers 1"]
