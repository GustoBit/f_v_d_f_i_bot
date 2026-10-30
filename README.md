# 📥 Free Video Downloader from Instagram Bot

Instagram Reels / post / IGTV / karusel videolarini **eng yuqori sifatda** yuklab beruvchi Telegram bot.

## Imkoniyatlar

| Variant | Tavsif |
|---|---|
| 🎬 Eng yuqori sifat | Instagram'dagi eng yaxshi sifat (odatda 1080p). Video va audio alohida yuklanib, ffmpeg bilan birlashtiriladi |
| 📱 720p / 📉 480p | Kichikroq hajm |
| ✨ 2K / 🔥 4K (upscale) | Lanczos + sharpen bilan 1440p / 2160p ga kattalashtirish, H.264 CRF 17 |
| 🎵 Audio (MP3) | Faqat ovoz, eng yuqori bitreyt |
| 📁 Fayl sifatida | Video document ko'rinishida, asl holida yuboriladi |

Bundan tashqari: progress bar, navbat (bir vaqtda `MAX_CONCURRENT_JOBS` ta), karusel (bir nechta video), `instagram.com/share/...` havolalari, VP9/AV1 → H.264 avtomatik konvertatsiya, Telegram limitiga avtomatik moslash.

> ⚠️ **4K haqida:** Instagram videolarni serverida ko'pi bilan **1080p** da saqlaydi. Shuning uchun "haqiqiy" 4K mavjud emas — bot videoni sifatli algoritm bilan kattalashtiradi (upscale). Bu ekranda tiniqroq ko'rinadi, lekin yangi detallar qo'shilmaydi.

## O'rnatish (Windows)

```bash
npm install          # grammy, yt-dlp, ffmpeg (ffmpeg-static) o'rnatiladi
copy .env.example .env   # va BOT_TOKEN ni yozing
npm start
```

## Sozlamalar (`.env`)

- `BOT_TOKEN` — majburiy.
- `COOKIES_FILE` — Instagram "login required" / "rate-limit" xatosi bersa yoki story/yopiq akkauntlar uchun. Brauzerdan "Get cookies.txt LOCALLY" kengaytmasi bilan Instagram cookies'ni eksport qilib, `cookies.txt` nomi bilan loyiha papkasiga qo'ying.
- `BOT_API_ROOT` — [Local Bot API server](https://github.com/tdlib/telegram-bot-api). Oddiy Telegram Bot API **50 MB** gacha fayl qabul qiladi; 4K uzun videolar uchun local server (2 GB) tavsiya etiladi.
- `MAX_CONCURRENT_JOBS`, `FFMPEG_PRESET`, `YTDLP_AUTO_UPDATE`, `FFMPEG_PATH`, `YTDLP_PATH`.

## Tuzilma

```
bot.ts             — Telegram bot (tugmalar, navbat, yuborish)
src/config.ts      — .env va sozlamalar
src/downloader.ts  — yt-dlp: ma'lumot olish va yuklash
src/ffmpeg.ts      — probe, upscale, H.264 konvertatsiya, thumbnail
src/run.ts         — tashqi dasturlarni ishga tushirish
```
