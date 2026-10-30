# ── 1-BOSQICH: TypeScript kodni kompilyatsiya qilish (Builder) ──
FROM node:22-bookworm-slim AS builder
WORKDIR /app

COPY package.json package-lock.json ./
# Binary yuklashni builder bosqichida o'tkazib yuboramiz (tezlik uchun)
ENV YOUTUBE_DL_SKIP_DOWNLOAD=true
RUN npm ci --ignore-scripts

COPY tsconfig.json bot.ts ./
COPY src ./src
RUN npm run build

# ── 2-BOSQICH: Production Runtime (ffmpeg + yt-dlp + node) ──
FROM node:22-bookworm-slim
WORKDIR /app

# Tizim darajasida ffmpeg, python3, ca-certificates va curl o'rnatamiz
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    curl \
    ca-certificates \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
  && chmod a+rx /usr/local/bin/yt-dlp \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
ENV PORT=7860

COPY package.json package-lock.json ./
# ffmpeg va yt-dlp tizimda borligi uchun og'ir postinstall skriptlarni o'tkazib yuboramiz
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force

# Kompilyatsiya qilingan JS fayllar va brend animatsiyalarini ko'chirib olamiz
COPY --from=builder /app/dist ./dist
COPY assets ./assets

RUN mkdir -p /app/data && chmod -R 777 /app/data

EXPOSE 7860
CMD ["node", "dist/bot.js"]
