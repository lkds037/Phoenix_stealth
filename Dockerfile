FROM node:20-bookworm-slim

# Installe ffmpeg et yt-dlp
RUN apt-get update \
 && apt-get install -y --no-install-recommends ffmpeg yt-dlp \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

CMD ["node", "index.js"]
