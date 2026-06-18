# ── Stage 1: build the Vue web frontend ─────────────────────────────────────
FROM node:20-alpine AS web
WORKDIR /app
COPY package*.json ./
COPY web/package*.json ./web/
RUN npm install
COPY . .
RUN npm run build:web

# ── Stage 2: server runtime (serves the built SPA as one artifact) ───────────
FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production

# Server dependencies only.
COPY server/package*.json ./server/
RUN cd server && npm install --omit=dev

COPY server ./server
COPY --from=web /app/web/dist ./web/dist

EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://localhost:3001/api/health || exit 1

CMD ["node", "server/src/index.js"]
