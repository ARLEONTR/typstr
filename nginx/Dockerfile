FROM node:20-slim AS frontend-builder
WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
RUN npm run download:busytex-assets
RUN npm run build

FROM nginx:1.27-alpine
COPY --from=frontend-builder /app/frontend/dist /usr/share/nginx/html
COPY nginx/nginx.conf.template /etc/nginx/nginx.conf.template
COPY nginx/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
