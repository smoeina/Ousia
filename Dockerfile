# Ousia — container distribution of the local AI research workspace.
# The Next.js UI and the Eve agent run in one image; project folders are mounted.
FROM node:24-bookworm-slim

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    HOSTNAME=0.0.0.0 \
    UI_HOST=0.0.0.0 \
    PORT=3000 \
    NEXT_TELEMETRY_DISABLED=1

# Python and a compiler toolchain for native deps and the optional research tools.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      python3 python3-venv python3-pip git curl ca-certificates build-essential \
 && rm -rf /var/lib/apt/lists/*

RUN npm install -g pnpm@11.17.0

WORKDIR /app

# Dependencies first for better layer caching.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile

# Build the Next UI and the Eve agent.
COPY . .
RUN pnpm build && pnpm build:eve

# Optional research toolchains (best-effort; the app degrades gracefully).
RUN bash scripts/findpapers/install.sh || true
RUN bash scripts/pdf/install.sh || true
RUN python3 -m pip install --break-system-packages --no-cache-dir jupyter nbconvert ipykernel || true
RUN curl --proto '=https' --tlsv1.2 -fsSL https://drop-sh.fullyjustified.net | sh || true \
 && ln -sf /root/.local/bin/tectonic /usr/local/bin/tectonic || true

# Application data (SQLite, secrets, tool venvs). Mount a volume to persist it.
VOLUME ["/app/.ousia"]

EXPOSE 3000
CMD ["node", "scripts/local-start.mjs"]
