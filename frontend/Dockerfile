# ---- Build stage ----
FROM node:20-slim AS builder
WORKDIR /app
ENV npm_config_build_from_source=true
ENV SWC_BINARY_PATH=/tmp/swc
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run download:busytex-assets
RUN npm run build

# The built static files are in /app/dist
# They are consumed by nginx in docker-compose.yml via a named volume or COPY
FROM scratch AS export
COPY --from=builder /app/dist /dist
