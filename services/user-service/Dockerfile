# user-service image (run from the repo root: docker compose builds it; see docker-compose.yml).
# Build context = repo root, because every service needs the shared library in shared/.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1
WORKDIR /app

# 1. The shared library and its dependencies (FastAPI, Kafka client, MySQL, Redis, MongoDB...).
#    tzdata: the timezone database, for "today" in America/Los_Angeles (shared/xenia_shared/timeutil.py).
#    Installed "editable" so it stays at /app/shared, in the same layout as the repo: it finds files
#    like infra/mongo/seed.json (the mock seed for Messaging and Review) relative to itself.
COPY shared/pyproject.toml shared/pyproject.toml
COPY shared/xenia_shared shared/xenia_shared
COPY infra/mongo/seed.json infra/mongo/seed.json
RUN pip install --no-cache-dir -e ./shared tzdata

# 2. This service.
COPY services/user-service services/user-service
RUN pip install --no-cache-dir ./services/user-service

# 3. Start: load the shared JWT secret, then run the service from its own folder.
COPY --chmod=755 infra/docker/with-secret.sh /usr/local/bin/with-secret
WORKDIR /app/services/user-service
EXPOSE 8001
ENTRYPOINT ["with-secret"]
CMD ["uvicorn", "user_service.main:app", "--host", "0.0.0.0", "--port", "8001"]
