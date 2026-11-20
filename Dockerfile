FROM node:20-bookworm-slim

# 1. Installer ffmpeg, python3 et les outils nécessaires
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pip curl unzip \
    && rm -rf /var/lib/apt/lists/*

# 2. Installer yt-dlp avec le support complet (EJS)
RUN pip3 install --break-system-packages "yt-dlp[default]"

# 3. Installer Deno (runtime JS pour résoudre les challenges YouTube)
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh
ENV PATH="/usr/local/bin:${PATH}"

WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .

CMD ["node", "index.js"]
