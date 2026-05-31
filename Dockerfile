FROM node:24.16-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

FROM node:24.16-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NODE_NO_WARNINGS=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data
VOLUME ["/app/data"]
# Флаг --experimental-sqlite — для единообразия с npm-скриптом start (баг #9).
# Сначала деплоим команды, затем запускаем бота.
CMD ["sh", "-c", "node --experimental-sqlite dist/deploy-commands.js && node --experimental-sqlite dist/index.js"]
