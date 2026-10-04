# Build depuis la racine du monorepo : docker build -f backend/Dockerfile .
FROM node:22-alpine AS build
WORKDIR /app
RUN apk add --no-cache openssl
COPY package.json package-lock.json* ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm install --workspace backend --include-workspace-root
COPY backend backend
RUN npm run prisma:generate -w backend \
 && npm run build -w backend

FROM node:22-alpine AS runtime
WORKDIR /app
RUN apk add --no-cache openssl
ENV NODE_ENV=production
# Copie complete du build : npm peut ranger des dependances dans backend/node_modules (et pas seulement a la racine).
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4000
CMD ["sh", "-c", "node_modules/.bin/prisma migrate deploy --schema backend/prisma/schema.prisma && node backend/dist/main.js"]
