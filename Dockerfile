# ── Stage 1: Build React Frontend ─────────────────────────────────────────
FROM node:18-alpine AS frontend-build

WORKDIR /app/frontend

# Copy frontend dependencies
COPY frontend/package.json ./
RUN npm install --legacy-peer-deps

# Copy source and build
COPY frontend/ ./
RUN npm run build

# ── Stage 2: Production Backend ────────────────────────────────────────────
FROM node:18-alpine AS production

WORKDIR /app

# Install backend dependencies
COPY backend/package.json ./
RUN npm install --production

# Copy backend code
COPY backend/ ./

# Copy built frontend into backend's static folder
COPY --from=frontend-build /app/frontend/build ./frontend/build

# Azure App Service uses port 8080 by default
ENV PORT=8080
ENV NODE_ENV=production

EXPOSE 8080

# Health check for Azure
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:8080/api/state || exit 1

CMD ["node", "server.js"]
