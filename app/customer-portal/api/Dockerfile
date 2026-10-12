# syntax=docker/dockerfile:1
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
# Numeric UID so Kubernetes 'runAsNonRoot' can verify it (pod security baseline).
USER 1000
EXPOSE 8080
CMD ["node", "src/index.js"]
