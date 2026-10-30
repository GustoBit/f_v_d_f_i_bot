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

# Tizim darajasida ffmpeg, python3, pip va ca-certificates o'rnatamiz.
# yt-dlp ni zip-arxiv o'rniga pip orqali (.pyc bayt-kodga oldindan kompilyatsiya qilingan holda) o'rnatamiz —
# bu Render 0.1 CPU da yt-dlp ishga tushish tezligini 5-8 barobarga oshiradi!
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    curl \
    ca-certificates \
  && pip3 install --no-cache-dir --break-system-packages --upgrade yt-dlp \
  && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV FFMPEG_PATH=/usr/bin/ffmpeg
ENV YTDLP_PATH=/usr/local/bin/yt-dlp
# Cloud 0.1 CPU uchun eng tezkor video kodlash rejimi
ENV FFMPEG_PRESET=superfast
# Docker build paytida eng oxirgi yt-dlp o'rnatilgani uchun ishga tushganda GitHub API limitiga tushmaslik
ENV YTDLP_AUTO_UPDATE=false
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
