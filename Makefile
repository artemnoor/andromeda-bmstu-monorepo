.PHONY: setup up down migrate test lint api directus validate web-setup web-dev web-build web-test web-check

WEB_PORT ?= 4173

# Required tools: uv, Docker Compose v2, GNU make. Copy .env.example to .env
# for local Compose values. Set ACADEMIC_DATA_DATABASE_URL in the shell for uv.
setup:
	uv sync --locked --all-packages --group dev --no-editable

up:
	docker compose up -d --wait academic-data-db

down:
	docker compose down

migrate:
	uv run --env-file .env --package andromeda-api academic-data db upgrade

test:
	uv run --env-file .env pytest -q

lint:
	uv run ruff check .

api:
	uv run --env-file .env --package andromeda-api uvicorn andromeda_api.main:app --reload --host 127.0.0.1 --port 8000

directus:
	docker compose --profile directus up -d --wait directus
	uv run --env-file .env python platform/directus/metadata/apply_metadata.py --mode core

validate:
	docker compose config --quiet
	docker compose --profile directus config --quiet
	uv run pytest --collect-only -q

# The original applicant frontend is a dependency-free Node 22 static app.
# Install from its lockfile separately from the Python workspace.
web-setup:
	npm ci --prefix apps/web

web-dev:
	npm --prefix apps/web run dev -- --port $(WEB_PORT)

web-build:
	npm --prefix apps/web run build

web-test:
	npm --prefix apps/web test

web-check: web-setup
	npm --prefix apps/web test
	npm --prefix apps/web run build
