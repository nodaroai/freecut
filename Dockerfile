# Stage 1: Build
FROM node:22.14-slim AS builder
# vite-plus >= 0.2 is a Rust binary that initializes an HTTPS client at startup
# and aborts ("No CA certificates were loaded from the system") on slim images,
# which ship without a CA store.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
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
