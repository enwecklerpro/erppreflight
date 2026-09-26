# ERP Preflight — Vollständige Konfiguration & Setup-Skripte für Cloud-Agenten / KI-Umgebungen

> **Verwendungszweck**: Diese Datei enthält die exakten Werte für die drei Konfigurationsfelder aus dem Cloud-Agenten-Setup-Dialog (**Umgebungsvariablen**, **API-Anmeldedaten**, **Setup-Skript**) sowie die vollständige Übergabe-Anleitung für die nachfolgende KI.

---

## TEIL 1: Die 3 Felder für den Setup-Dialog (Direkt zum Kopieren)

### Feld 1: „Umgebungsvariablen“ (Nicht-sensible Variablen im `.env`-Format)
*Kopiere den folgenden Textblock 1:1 in das Feld **Umgebungsvariablen**:*

```env
NODE_ENV=development
PORT=3001
API_PORT=3001
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_APP_URL=http://localhost:3000
DATABASE_URL=postgresql://erppreflight:erppreflight_secret@localhost:5432/erppreflight_dev
POSTGRES_DB=erppreflight_dev
POSTGRES_USER=erppreflight
REDIS_URL=redis://localhost:6379
ANALYSIS_SERVICE_URL=http://localhost:8000
S3_ENDPOINT=http://localhost:9000
S3_REGION=us-east-1
S3_BUCKET_QUARANTINE=erppreflight-quarantine
S3_BUCKET_CLEAN=erppreflight-clean
S3_BUCKET_REPORTS=erppreflight-reports
AUTO_MIGRATE=true
STRICT_MIGRATIONS=false
CLAMAV_HOST=localhost
CLAMAV_PORT=3310
CLAMAV_MOCK_MODE=true
ALLOW_LOCAL_LANDSCAPE_PROBES=true
ALLOW_PRIVATE_LANDSCAPE_PROBES=true
CORS_ORIGIN=http://localhost:3000,http://localhost:3001
NEXT_TELEMETRY_DISABLED=1
```

---

### Feld 2: „API-Anmeldedaten“ (Geheime Schlüssel & Passwörter)
*Füge diese Werte über **`+ Zugangsdaten hinzufügen`** als geheime Umgebungsvariablen hinzu:*

| Schlüssel (Key) | Empfohlener Wert / Beschreibung |
|---|---|
| `JWT_SECRET` | `erppreflight_super_secure_jwt_secret_token_key_2026_at_least_64_bytes_long_entropy_string` |
| `ADMIN_BOOTSTRAP_PASSWORD` | `AdminInitialSecurePass2026!#Preflight` |
| `POSTGRES_PASSWORD` | `erppreflight_secret` |
| `S3_ACCESS_KEY` | `minioadmin` |
| `S3_SECRET_KEY` | `minioadmin` |
| `MASTER_ENCRYPTION_KEY` | `0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef` |
| `OPENAI_API_KEY` | *(Optional: Dein OpenAI API-Key für generative Erklärung)* |
| `ANTHROPIC_API_KEY` | *(Optional: Dein Anthropic API-Key für Claude)* |
| `STRIPE_SECRET_KEY` | *(Optional: Stripe Secret Key `sk_test_...`)* |
| `STRIPE_WEBHOOK_SECRET` | *(Optional: Stripe Webhook Signing Secret `whsec_...`)* |

---

### Feld 3: „Setup-Skript“ (Bash-Skript für automatische Initialisierung)
*Kopiere das folgende Skript 1:1 in das Feld **Setup-Skript**:*

```bash
#!/bin/bash
set -e

echo "=== [1/5] System & Tools vorbereiten ==="
# Sicherstellen, dass curl, git, python3, venv vorhanden sind
if command -v apt-get &> /dev/null; then
    sudo apt-get update -y && sudo apt-get install -y python3 python3-pip python3-venv curl git
fi

echo "=== [2/5] PNPM Package Manager einrichten ==="
# PNPM global installieren falls nicht vorhanden
if ! command -v pnpm &> /dev/null; then
    npm install -g pnpm@10.20.0
fi

echo "=== [3/5] Python Virtuelle Umgebung & Analyse-Engines ==="
# Python venv für die 19 Analyse-Engines in services/analysis-python/ einrichten
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
fi
source .venv/bin/activate
pip install --upgrade pip
pip install -r services/analysis-python/requirements.txt

echo "=== [4/5] Node.js Monorepo Abhängigkeiten installieren ==="
pnpm install --frozen-lockfile || pnpm install

echo "=== [5/5] Monorepo Build & Typsicherheit prüfen ==="
pnpm run build
pnpm run typecheck

echo "=========================================================="
echo "✅ ERP Preflight Umgebung erfolgreich initialisiert!"
echo "   - Node.js & PNPM Workspace: Bereit"
echo "   - Python 3.13 (.venv):      19 Preflight Engines bereit"
echo "   - Drizzle ORM:              25 Tabellen typisiert"
echo "=========================================================="
```

---

## TEIL 2: Komplette Dokumentation für die andere KI (Agenten-Briefing)

*Diesen Abschnitt kannst du der anderen KI als Kontext oder Prompt geben, damit sie das Projekt sofort zu 100 % versteht:*

### 1. Was ist dieses Projekt?
**ERP Preflight** (`https://github.com/enwecklerpro/erppreflight`) ist eine produktionsreife Multi-Tenant SaaS-Plattform für SAP Preflight-Analysen, Clean Core Audits, SAP S/4HANA Upgrade-Verifikation und Release Intelligence.

### 2. Monorepo-Struktur & Zuständige Verzeichnisse
Das Projekt ist ein **Turborepo** mit **pnpm Workspaces**:

```text
erppreflight/
├── apps/
│   ├── web/               # Next.js 15 App Router Frontend (Port 3000)
│   │   ├── src/app/       # 27 App Router Seiten (Projects, Findings, Lab, Simulation, etc.)
│   │   ├── src/components/# Base UI / Shadcn barrierefreie Komponenten
│   │   └── src/lib/       # TanStack Query Client, API Client
│   ├── api/               # NestJS 11 Fastify Core SaaS API (Port 3001)
│   │   ├── src/modules/   # Auth, Projects, Findings, Changesets, Agent-Gate, Telemetry, Outbox
│   │   └── src/common/    # TenancyContext, Guards, Interceptors
│   └── local-agent/       # Enterprise On-Premise CLI & Daemon Agent
│       └── src/           # daemon.ts, identity.ts, probe.ts, updater.ts, cli.ts
│
├── services/
│   └── analysis-python/   # Python 3.13 FastAPI Stateless Microservice (Port 8000)
│       ├── src/engines/   # 19 Deterministische SAP Analyse-Engines + MFS BlackBox
│       └── tests/         # 501 Pytest Golden-Fixture-Tests
│
├── packages/
│   ├── database/          # Drizzle ORM Schema (25 Tabellen) & pg.Pool RLS Client
│   │   ├── src/schema.ts  # Master Export aller Tabellen & Inferenz-Typen
│   │   ├── src/client.ts  # withTenantTransaction & getDrizzle()
│   │   └── migrations/    # 9 PostgreSQL SQL-Migrationen (001 bis 009)
│   ├── schemas/           # Gemeinsame Zod-Schemas (@erppreflight/schemas)
│   ├── evidence/          # RFC 8785 kanonisches JSON & SHA-256 Hashing
│   ├── tenancy/           # AsyncLocalStorage Multi-Tenant Isolation
│   ├── auth/              # RBAC Policies & Rechte-Matrizen
│   └── cli/               # Globales CLI & MCP Stdio Server Bridge
│
└── infra/
    ├── coolify/           # Hostinger VPS & Coolify v4+ docker-compose.coolify.yml
    └── docker/            # Multi-Stage Dockerfiles (web, api, analysis)
```

---

### 3. Die zwei unumstößlichen Kardinal-Axiome (Regeln für jede KI)

1. **Axiom 1: *„A page that renders is not a completed feature.“* **
   - Kein UI-Feature ist fertig ohne echtes Data-Fetching via **TanStack Query** (`useQuery` / `useMutation`).
   - Keine temporären Dummy-Arrays oder `Math.random()` in Produktivpfaden!
   - Severity-Badges (`BLOCKER`, `CRITICAL`, `MAJOR`, `MEDIUM`, `MINOR`, `INFO`) dürfen **niemals nur über Farbe** dargestellt werden (Icons, Textlabels oder ARIA-Tags sind Pflicht).
   - Saubere Ladeskelette (kein Layout Shift) und informative Leerzustände.

2. **Axiom 2: *„An engine without deterministic logic/evidence/fixtures is not complete.“* **
   - Analyse-Engines sind reine deterministische AST- und Regelauswerter, **keine Prompt-Wrapper**.
   - Zwei identische Eingabedateien müssen bitgenau identische Findings erzeugen.
   - Jedes Finding muss kryptografische SHA-256 Evidence Pointers besitzen (Datei, Zeile, Spalte, Code-Auszug).
   - Generative KI ist strikt auf das Konfidenzniveau `INFERRED` ($\le 0.60$) gedeckelt.

---

### 4. Befehle zum Starten und Testen

```bash
# 1. Lokale Entwicklung (startet Web, API und Services)
pnpm dev

# 2. Typprüfung (MUSS mit 0 Fehlern durchlaufen)
pnpm run typecheck

# 3. TypeScript Tests (673 Tests: 542 Backend + 131 Frontend)
pnpm run test

# 4. Python Analyse-Engine Tests (501 Tests)
pnpm run test:python

# 5. Anti-Fassaden-Prüfung (verifiziert echte Netzwerkaufrufe & keine Dummy-Mocks)
pnpm run check:production-truth
pnpm run check:no-production-facades

# 6. Produktions-Build
pnpm run build
```

---

### 5. Deployment auf Hostinger VPS

- **Orchestrierung**: Coolify v4+ oder Docker Compose auf Ubuntu 22.04/24.04 LTS.
- **Konfigurationsdatei**: `infra/coolify/docker-compose.coolify.yml`
- **Container-Topologie**:
  1. `postgres` (Port 5432, PostgreSQL 16 + pgvector)
  2. `redis` (Port 6379, Redis 7.2 Alpine)
  3. `minio` (Port 9000/9001, S3 Objekt-Speicher)
  4. `clamav` (Port 3310, Antivirus-Daemon)
  5. `analysis-python` (Port 8000, 19 Preflight Engines)
  6. `api` (Port 3001, NestJS Fastify Backend)
  7. `web` (Port 3000, Next.js 15 Frontend)
- **Startbefehl auf dem Server**:
  ```bash
  docker compose -f infra/coolify/docker-compose.coolify.yml up -d --build
  ```
