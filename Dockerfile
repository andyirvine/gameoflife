# Runs ONLY the multiplayer WebSocket server (src/server) — not the static UI, which is
# deployed separately to Cloudflare. Node 24 is used deliberately: this project runs
# TypeScript directly with Node's native type-stripping (no build step, no ts-node), which
# needs a Node version where that lands stable by default.
FROM node:24-slim

WORKDIR /app

# Install dependencies first so this layer caches across deploys that only touch src/.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# The whole src/ tree, not just src/server — the server imports pure types/logic from
# src/engine (type-only imports get stripped, but copying everything avoids relying on that).
COPY src ./src

ENV PORT=8787
EXPOSE 8787

CMD ["node", "src/server/index.ts"]
