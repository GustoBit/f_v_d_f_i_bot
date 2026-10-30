import fs from 'fs'
import os from 'os'
import path from 'path'

const ROOT_DIR = fs.existsSync(path.resolve(__dirname, '..', 'package.json'))
	? path.resolve(__dirname, '..')
	: path.resolve(__dirname, '..', '..')

/**
 * Oddiy .env o'quvchi (qo'shimcha kutubxonasiz).
 * Mavjud muhit o'zgaruvchilarini (environment) qayta yozmaydi.
 */
function loadDotEnv(file: string): void {
	if (!fs.existsSync(file)) return
	const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/)
	for (const raw of lines) {
		const line = raw.trim()
		if (!line || line.startsWith('#')) continue
		const eq = line.indexOf('=')
		if (eq === -1) continue
		const key = line.slice(0, eq).trim()
		let value = line.slice(eq + 1).trim()
		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1)
		}
		if (process.env[key] === undefined) process.env[key] = value
	}
}

loadDotEnv(path.join(ROOT_DIR, '.env'))

function resolvePath(p: string): string {
	return path.isAbsolute(p) ? p : path.join(ROOT_DIR, p)
}

function resolveYtDlp(): string {
	if (process.env.YTDLP_PATH) return resolvePath(process.env.YTDLP_PATH)
	const binDir = path.join(ROOT_DIR, 'node_modules', 'youtube-dl-exec', 'bin')
	const file = process.platform === 'win32' ? 'yt-dlp.exe' : 'yt-dlp'
	const bundled = path.join(binDir, file)
	if (fs.existsSync(bundled)) return bundled
	return 'yt-dlp' // PATH dan qidiriladi
}

function resolveFfmpeg(): string {
	if (process.env.FFMPEG_PATH) return resolvePath(process.env.FFMPEG_PATH)
	try {
		// ffmpeg-static o'rnatilgan bo'lsa, tayyor binary yo'lini qaytaradi
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const p: unknown = require('ffmpeg-static')
		if (typeof p === 'string' && fs.existsSync(p)) return p
	} catch {
		/* ffmpeg-static yo'q — PATH dagi ffmpeg ishlatiladi */
	}
	return 'ffmpeg'
}

function resolveCookies(): string | undefined {
	const candidates = [
		process.env.COOKIES_FILE ? resolvePath(process.env.COOKIES_FILE) : undefined,
		path.join(ROOT_DIR, 'cookies.txt'),
	]
	return candidates.find((c): c is string => !!c && fs.existsSync(c))
}

const botToken = process.env.BOT_TOKEN?.trim()
if (!botToken) {
	console.error(
		"❌ BOT_TOKEN topilmadi. Loyiha papkasida .env fayl yarating va BOT_TOKEN=... deb yozing (.env.example ga qarang).",
	)
	process.exit(1)
}

const apiRoot = process.env.BOT_API_ROOT?.trim().replace(/\/+$/, '') || undefined

export const config = {
	rootDir: ROOT_DIR,
	botToken,
	/** Local Bot API server manzili (masalan http://localhost:8081). 2 GB gacha fayl yuborish imkonini beradi. */
	apiRoot,
	/** Telegramga yuboriladigan fayl hajmi chegarasi (MB). Oddiy Bot API = 50 MB. */
	maxUploadMb: Number(process.env.MAX_UPLOAD_MB || (apiRoot ? 2000 : 50)),
	ytdlpPath: resolveYtDlp(),
	ffmpegPath: resolveFfmpeg(),
	cookiesFile: resolveCookies(),
	/** Bir vaqtning o'zida nechta video qayta ishlanadi */
	maxConcurrentJobs: Math.max(1, Number(process.env.MAX_CONCURRENT_JOBS || 2)),
	/** Ishga tushganda yt-dlp ni avtomatik yangilash (Instagram tez-tez o'zgaradi) */
	autoUpdateYtdlp: (process.env.YTDLP_AUTO_UPDATE ?? 'true').toLowerCase() !== 'false',
	/** libx264 preset: ultrafast..veryslow. Sekinroq = sifatliroq/kichikroq fayl */
	x264Preset: process.env.FFMPEG_PRESET || 'medium',
	tmpDir: path.join(os.tmpdir(), 'ig-downloader-bot'),
}

export const MAX_UPLOAD_BYTES = config.maxUploadMb * 1024 * 1024
