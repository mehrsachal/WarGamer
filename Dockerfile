# Tactical Hex Trainer — single container: Node server + built client + content. No internet needed at runtime.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production THT_PORT=8080 THT_DB=/var/lib/tht/tht.sqlite THT_CONTENT=/app THT_CLIENT=/app/packages/client/dist
COPY package.json package-lock.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/server/package.json packages/server/
COPY packages/client/package.json packages/client/
RUN npm ci --omit=dev --ignore-scripts -w @tht/server && npm cache clean --force
COPY --from=build /app/packages/server/dist packages/server/dist
COPY --from=build /app/packages/client/dist packages/client/dist
COPY data data
COPY maps maps
COPY scenarios scenarios
VOLUME ["/var/lib/tht"]
EXPOSE 8080
CMD ["node", "--no-warnings=ExperimentalWarning", "packages/server/dist/server.js"]
