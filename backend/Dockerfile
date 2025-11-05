# syntax=docker/dockerfile:1

########## Builder ##########
FROM python:3.13-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential libpq-dev ca-certificates curl && \
    rm -rf /var/lib/apt/lists/*

# Install uv (copy binaries)
COPY --from=ghcr.io/astral-sh/uv:latest /uv /uvx /bin/

WORKDIR /app/backend

# Install transitive deps without the project (cacheable)
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=backend/uv.lock,target=uv.lock,readwrite \
    --mount=type=bind,source=backend/pyproject.toml,target=pyproject.toml,readwrite \
    uv sync --locked --no-install-project --no-editable

# Copy project and do non-editable sync
ADD backend/ /app/backend/
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --locked --no-editable

########## Final ##########
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Runtime system deps (libpq only; no build tools needed)
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev ca-certificates && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend

# Copy the virtual environment to a path outside the bind mount
COPY --from=builder /app/backend/.venv /opt/venv
ENV VIRTUAL_ENV=/opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# If your entrypoint or runtime needs app assets (templates/static), copy them selectively:
# ADD backend/ /app/backend/

COPY backend/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000
ENTRYPOINT ["/entrypoint.sh"]
