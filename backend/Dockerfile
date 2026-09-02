ARG BACKEND_BASE_IMAGE=typstr-backend-texbase:latest

# ---- Build stage ----
FROM node:20-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci --loglevel=error
COPY . .
RUN npm run build

# ---- Runtime stage ----
FROM ${BACKEND_BASE_IMAGE} AS runtime
WORKDIR /app

ARG TARGETARCH

# Download typst binary for target architecture
ARG TYPST_VERSION=0.14.2
RUN case "${TARGETARCH}" in \
      amd64) TYPST_ASSET_ARCH="x86_64" ;; \
      arm64) TYPST_ASSET_ARCH="aarch64" ;; \
      *) echo "Unsupported TARGETARCH for typst: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/typst/typst/releases/download/v${TYPST_VERSION}/typst-${TYPST_ASSET_ARCH}-unknown-linux-musl.tar.xz" \
    | tar -xJf - --strip-components=1 -C /usr/local/bin "typst-${TYPST_ASSET_ARCH}-unknown-linux-musl/typst" \
 && chmod +x /usr/local/bin/typst

# Download tinymist binary (x86_64 / arm64 Linux musl)
ARG TINYMIST_VERSION=0.14.2
RUN case "${TARGETARCH}" in \
      amd64) TINYMIST_ASSET_ARCH="x86_64" ;; \
      arm64) TINYMIST_ASSET_ARCH="aarch64" ;; \
      *) echo "Unsupported TARGETARCH for tinymist: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/Myriad-Dreamin/tinymist/releases/download/v${TINYMIST_VERSION}/tinymist-${TINYMIST_ASSET_ARCH}-unknown-linux-musl.tar.gz" \
    | tar -xzf - --strip-components=1 -C /usr/local/bin "tinymist-${TINYMIST_ASSET_ARCH}-unknown-linux-musl/tinymist" \
 && chmod +x /usr/local/bin/tinymist

# Download texlab binary for the target architecture
ARG TEXLAB_VERSION=5.24.0
RUN case "${TARGETARCH}" in \
      amd64) TEXLAB_ASSET_ARCH="x86_64" ;; \
      arm64) TEXLAB_ASSET_ARCH="aarch64" ;; \
      *) echo "Unsupported TARGETARCH for texlab: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/latex-lsp/texlab/releases/download/v${TEXLAB_VERSION}/texlab-${TEXLAB_ASSET_ARCH}-linux.tar.gz" \
    | (tmpdir="$(mktemp -d)" \
      && tar -xzf - -C "$tmpdir" \
      && install "$(find "$tmpdir" -type f -name texlab | head -n 1)" /usr/local/bin/texlab \
      && chmod +x /usr/local/bin/texlab \
      && rm -rf "$tmpdir")

# Download pandoc binary for target architecture
ARG PANDOC_VERSION=3.8.3
RUN case "${TARGETARCH}" in \
      amd64) PANDOC_ASSET_ARCH="amd64" ;; \
      arm64) PANDOC_ASSET_ARCH="arm64" ;; \
      *) echo "Unsupported TARGETARCH for pandoc: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/jgm/pandoc/releases/download/${PANDOC_VERSION}/pandoc-${PANDOC_VERSION}-linux-${PANDOC_ASSET_ARCH}.tar.gz" \
    | tar -xzf - --strip-components=2 -C /usr/local/bin "pandoc-${PANDOC_VERSION}/bin/pandoc" \
 && chmod +x /usr/local/bin/pandoc

# Copy build output
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules

# Prepare writable cache/home paths before dropping privileges.
RUN mkdir -p /home/node/.cache && chown -R node:node /home/node
RUN mkdir -p /app/.local-storage && chown -R node:node /app/.local-storage
# Typst package cache (used in compiler.ts)
RUN mkdir -p /root/.cache/typst && chown -R node:node /root/.cache/typst

# Non-root user
USER node

ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000
CMD ["node", "dist/index.js"]
