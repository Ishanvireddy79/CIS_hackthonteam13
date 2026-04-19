# ⬡ MIGRATEK — Container Migration & Backup System

A full-stack simulation of enterprise container migration with real-time visualization, backup/restore, failure injection, and data consistency validation.

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────┐
│              MIGRATEK System                    │
│                                                 │
│  ┌──────────┐    SSE/REST    ┌──────────────┐  │
│  │ React UI │◄──────────────►│ Express API  │  │
│  │ (Port 3k)│               │ (Port 8080)  │  │
│  └──────────┘               └──────────────┘  │
│       ↑                            ↓           │
│   Awwwards UI            In-Memory Migration   │
│   Live SSE Stream        Engine + Backup Store │
└─────────────────────────────────────────────────┘
                      │
              ┌───────▼────────┐
              │  Azure App     │
              │  Service (F1)  │
              │  Free Tier     │
              └────────────────┘
```

## ✨ Features

| Feature | Description |
|---|---|
| **Dual Environment Simulation** | Source (Production) + Target (Azure Cloud) with health monitoring |
| **Live Migration** | Real-time animated data flow with chunked progress |
| **Migration Logs** | Color-coded SSE-streamed terminal logs |
| **Backup & Restore** | Snapshot any environment, restore from any backup |
| **Checksum Validation** | Post-migration data consistency verification |
| **Failure Injection** | Simulate mid-flight network partition with auto-recovery |
| **Stats Dashboard** | Migration count, data transferred, avg duration |

---

## 🚀 Quick Start (Local)

### Prerequisites
- Node.js 18+
- npm 8+
- Docker (for Azure deployment)

### Option A: Run locally (separate processes)

```bash
# Clone / navigate to project
cd migration-system

# 1. Start Backend
cd backend
npm install
node server.js
# Runs on http://localhost:8080

# 2. In another terminal — Start Frontend (dev)
cd frontend
npm install
npm start
# Opens http://localhost:3000 with hot reload
```

### Option B: Docker (production build)

```bash
# Build and run everything in one container
docker build -t migratek .
docker run -p 8080:8080 migratek

# Open http://localhost:8080
```

### Option C: Docker Compose

```bash
docker-compose up --build
# Open http://localhost:8080
```

---

## ☁️ Azure Free Tier Deployment

### Prerequisites
- [Azure CLI](https://docs.microsoft.com/en-us/cli/azure/install-azure-cli) installed
- [Docker](https://docs.docker.com/get-docker/) installed
- Azure account (free account at https://azure.microsoft.com/free/)

### One-Command Deploy

```bash
chmod +x deploy-azure.sh
./deploy-azure.sh
```

This script automatically:
1. Logs you into Azure
2. Creates a Resource Group
3. Creates an Azure Container Registry (Basic)
4. Builds and pushes the Docker image
5. Creates an App Service Plan (F1 Free tier)
6. Creates and configures the Web App
7. Outputs your live URL

### Manual Azure Deployment (step by step)

```bash
# Variables
APP_NAME="migratek-app"
RG="migratek-rg"
ACR="migratekacr"
PLAN="migratek-plan"

# Login
az login

# Resource group
az group create --name $RG --location eastus

# Container Registry
az acr create --resource-group $RG --name $ACR --sku Basic --admin-enabled true

# Get ACR credentials
ACR_SERVER=$(az acr show --name $ACR --query loginServer -o tsv)
ACR_PASS=$(az acr credential show --name $ACR --query passwords[0].value -o tsv)

# Build & push
docker build -t $ACR_SERVER/migration-system:latest .
docker login $ACR_SERVER -u $ACR -p $ACR_PASS
docker push $ACR_SERVER/migration-system:latest

# App Service (FREE F1)
az appservice plan create --name $PLAN --resource-group $RG --sku F1 --is-linux

# Web App
az webapp create \
  --resource-group $RG \
  --plan $PLAN \
  --name $APP_NAME \
  --deployment-container-image-name $ACR_SERVER/migration-system:latest

# Configure env vars
az webapp config appsettings set \
  --resource-group $RG \
  --name $APP_NAME \
  --settings \
    DOCKER_REGISTRY_SERVER_URL=https://$ACR_SERVER \
    DOCKER_REGISTRY_SERVER_USERNAME=$ACR \
    DOCKER_REGISTRY_SERVER_PASSWORD=$ACR_PASS \
    PORT=8080 NODE_ENV=production

echo "Live at: https://$APP_NAME.azurewebsites.net"
```

### ⚠️ Free Tier (F1) Limits
| Limit | Value |
|---|---|
| CPU | 60 min/day |
| RAM | 1 GB |
| Storage | 1 GB |
| Cold start | ~20–30 seconds |
| Custom domains | ❌ (need B1+) |
| SSL | ✅ (*.azurewebsites.net) |

---

## 🔄 CI/CD (GitHub Actions)

```bash
# 1. Fork/push this repo to GitHub

# 2. Get publish profile from Azure portal:
#    App Service → Overview → Get publish profile → Download

# 3. Add secret to GitHub repo:
#    Settings → Secrets → New → AZURE_WEBAPP_PUBLISH_PROFILE = <paste content>

# 4. Edit .github/workflows/deploy.yml:
#    Change AZURE_WEBAPP_NAME to your app name

# 5. Push to main → auto-deploys!
```

---

## 📡 API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/state` | Full system state |
| `GET` | `/api/events` | SSE live event stream |
| `GET` | `/api/logs` | Migration logs (query: `?limit=100&level=error`) |
| `POST` | `/api/migrate` | Start migration |
| `POST` | `/api/backup` | Create snapshot (`{ environment, label }`) |
| `POST` | `/api/restore` | Restore backup (`{ backupId, targetEnvironment }`) |
| `POST` | `/api/validate` | Run consistency check |
| `POST` | `/api/simulate-failure` | Arm failure injection |
| `POST` | `/api/reset` | Reset target environment |

---

## 🎮 How to Use

1. **Dashboard** — View source/target environments side by side
2. **▶ START MIGRATION** — Migrates all 5 containers with live animation
3. **✓ Validate Consistency** — Verify checksums match post-migration
4. **📸 Snapshot** — Create backup before migration
5. **☠ INJECT FAILURE** — Arms a failure at the midpoint of next migration
   - Watch auto-recovery kick in and rollback to pre-migration backup!
6. **↺ Reset Target** — Clear target and run again
7. **Logs tab** — Full color-coded activity stream
8. **Backups tab** — All snapshots with restore buttons
9. **Validation tab** — Detailed consistency report table

---

## 📁 Project Structure

```
migration-system/
├── backend/
│   ├── server.js          # Express API + migration engine
│   └── package.json
├── frontend/
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── App.js         # React UI (all components)
│   │   └── App.css        # Dark industrial design system
│   └── package.json
├── .github/
│   └── workflows/
│       └── deploy.yml     # GitHub Actions CI/CD
├── Dockerfile             # Multi-stage build
├── docker-compose.yml     # Local orchestration
├── deploy-azure.sh        # One-click Azure deploy
└── README.md
```

---

## 🧹 Cleanup

```bash
# Delete all Azure resources
az group delete --name migratek-rg --yes --no-wait

# Stop local docker
docker-compose down
```
