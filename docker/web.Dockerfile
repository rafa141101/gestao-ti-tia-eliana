# ===== Web — build =====
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
# strict-ssl desativado só aqui: contorna antivírus com inspeção HTTPS (ex.: Avast) cujo
# certificado não está na CA do container. A integridade dos pacotes continua garantida
# pelos hashes sha512 do package-lock.json, verificados pelo npm independente do TLS.
RUN NPM_CONFIG_STRICT_SSL=false npm ci --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/web apps/web
RUN npm run build -w @gestao-ti/shared && npm run build -w @gestao-ti/web

# ===== Web — nginx =====
FROM nginx:1.27-alpine
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
