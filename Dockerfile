# Stage 1: Build
FROM node:22.14-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
# --ignore-scripts skips the dev-only `prepare` (vp config, needs git — absent in
# this slim image) and optional native postinstalls (esbuild/sharp/onnxruntime)
# that the static Vite build does not require. `npm run build` still runs below.
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build

# Stage 2: Serve
FROM caddy:2.9-alpine
COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=builder /app/dist /srv
EXPOSE 3000
