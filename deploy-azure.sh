#!/bin/bash
# ═══════════════════════════════════════════════════════════════════════════
#  MIGRATEK — Azure Free Tier Deployment Script
#  Run: chmod +x deploy-azure.sh && ./deploy-azure.sh
# ═══════════════════════════════════════════════════════════════════════════

set -e

# ── Config (EDIT THESE) ────────────────────────────────────────────────────
APP_NAME="migratek-$(date +%s)"   # Must be globally unique
RESOURCE_GROUP="migratek-rg"
LOCATION="eastus"
SKU="F1"                           # F1 = Free tier (60 CPU min/day)
PLAN_NAME="migratek-plan"
ACR_NAME="migratekacr$(date +%s)" # Must be globally unique, alphanumeric only

echo ""
echo "╔══════════════════════════════════════════════════════╗"
echo "║        MIGRATEK — Azure Deployment                  ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""

# ── 1. Login Check ─────────────────────────────────────────────────────────
echo "▶ Checking Azure login..."
if ! az account show &>/dev/null; then
  echo "  Not logged in. Running: az login"
  az login
fi
echo "  ✓ Logged in as: $(az account show --query user.name -o tsv)"
echo ""

# ── 2. Create Resource Group ───────────────────────────────────────────────
echo "▶ Creating resource group: $RESOURCE_GROUP in $LOCATION"
az group create --name $RESOURCE_GROUP --location $LOCATION --output none
echo "  ✓ Resource group created"
echo ""

# ── 3. Create Azure Container Registry (Free tier uses Basic) ──────────────
echo "▶ Creating Container Registry: $ACR_NAME (Basic SKU)"
az acr create \
  --resource-group $RESOURCE_GROUP \
  --name $ACR_NAME \
  --sku Basic \
  --admin-enabled true \
  --output none
echo "  ✓ ACR created"

ACR_LOGIN_SERVER=$(az acr show --name $ACR_NAME --query loginServer -o tsv)
ACR_PASSWORD=$(az acr credential show --name $ACR_NAME --query passwords[0].value -o tsv)
echo "  ✓ Registry: $ACR_LOGIN_SERVER"
echo ""

# ── 4. Build & Push Docker Image ───────────────────────────────────────────
echo "▶ Building Docker image..."
docker build -t $ACR_LOGIN_SERVER/migration-system:latest .
echo "  ✓ Build complete"

echo "▶ Pushing to ACR..."
docker login $ACR_LOGIN_SERVER --username $ACR_NAME --password $ACR_PASSWORD
docker push $ACR_LOGIN_SERVER/migration-system:latest
echo "  ✓ Image pushed"
echo ""

# ── 5. Create App Service Plan (Free F1) ───────────────────────────────────
echo "▶ Creating App Service Plan: $PLAN_NAME ($SKU)"
az appservice plan create \
  --name $PLAN_NAME \
  --resource-group $RESOURCE_GROUP \
  --sku $SKU \
  --is-linux \
  --output none
echo "  ✓ App Service Plan created (Free F1)"
echo ""

# ── 6. Create Web App ──────────────────────────────────────────────────────
echo "▶ Creating Web App: $APP_NAME"
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan $PLAN_NAME \
  --name $APP_NAME \
  --deployment-container-image-name $ACR_LOGIN_SERVER/migration-system:latest \
  --output none

# Configure registry credentials
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --settings \
    WEBSITES_ENABLE_APP_SERVICE_STORAGE=false \
    DOCKER_REGISTRY_SERVER_URL=https://$ACR_LOGIN_SERVER \
    DOCKER_REGISTRY_SERVER_USERNAME=$ACR_NAME \
    DOCKER_REGISTRY_SERVER_PASSWORD=$ACR_PASSWORD \
    PORT=8080 \
    NODE_ENV=production \
  --output none
echo "  ✓ Web App created and configured"
echo ""

# ── 7. Enable Continuous Deployment (optional) ────────────────────────────
echo "▶ Enabling container continuous deployment..."
az webapp deployment container config \
  --enable-cd true \
  --name $APP_NAME \
  --resource-group $RESOURCE_GROUP \
  --output none
echo "  ✓ Continuous deployment enabled"
echo ""

# ── 8. Get URL ─────────────────────────────────────────────────────────────
APP_URL="https://$APP_NAME.azurewebsites.net"
echo "╔══════════════════════════════════════════════════════╗"
echo "║  ✓ DEPLOYMENT COMPLETE!                             ║"
echo "║                                                      ║"
echo "║  🌐 URL: $APP_URL"
echo "║                                                      ║"
echo "║  ⚠  Free tier F1 note:                              ║"
echo "║     • 60 CPU minutes/day limit                      ║"
echo "║     • App sleeps after 20min inactivity             ║"
echo "║     • First load may be slow (cold start)           ║"
echo "╚══════════════════════════════════════════════════════╝"
echo ""
echo "Resources created:"
echo "  Resource Group : $RESOURCE_GROUP"
echo "  App Name       : $APP_NAME"
echo "  ACR            : $ACR_NAME"
echo "  Plan           : $PLAN_NAME (F1 Free)"
echo ""
echo "To delete all resources:"
echo "  az group delete --name $RESOURCE_GROUP --yes --no-wait"
echo ""

# Save config for future reference
cat > .azure-config << EOF
APP_NAME=$APP_NAME
RESOURCE_GROUP=$RESOURCE_GROUP
ACR_NAME=$ACR_NAME
PLAN_NAME=$PLAN_NAME
APP_URL=$APP_URL
DEPLOYED_AT=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
EOF
echo "  Config saved to .azure-config"
