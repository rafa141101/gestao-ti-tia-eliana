# ===== API — build =====
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN npm ci --no-audit --no-fund

COPY packages/shared packages/shared
COPY apps/api apps/api
RUN npm run build -w @gestao-ti/shared \
 && npx -w @gestao-ti/api prisma generate \
 && npm run build -w @gestao-ti/api

# ===== API — runtime =====
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production TZ=America/Sao_Paulo

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/packages/shared/package.json packages/shared/package.json
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/apps/api/package.json apps/api/package.json
COPY --from=build /app/node_modules node_modules
COPY --from=build /app/apps/api/dist apps/api/dist
COPY --from=build /app/apps/api/prisma apps/api/prisma
# src é necessário para o seed (prisma/seed.ts importa helpers de src/lib via tsx)
COPY --from=build /app/apps/api/src apps/api/src

WORKDIR /app/apps/api
EXPOSE 3001
# Aplica migrations e sobe a API
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
