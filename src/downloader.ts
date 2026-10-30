import fs from 'fs'
import path from 'path'
import { config } from './config'
import { t } from './i18n'
import { run } from './run'
import { Lang } from './store'

/** Foydalanuvchiga ko'rsatiladigan xatolik */
export class UserError extends Error {}

export type Quality = 'best' | 'q720' | 'q480' | 'up1440' | 'up2160' | 'audio'

export type Platform = 'instagram' | 'tiktok' | 'youtube' | 'pinterest' | 'other'

export function detectPlatform(url: string): Platform {
	const u = url.toLowerCase()
	if (u.includes('instagram.com') || u.includes('instagr.am')) return 'instagram'
	if (u.includes('tiktok.com')) return 'tiktok'
	if (u.includes('youtube.com') || u.includes('youtu.be')) return 'youtube'
	if (u.includes('pinterest.') || u.includes('pin.it')) return 'pinterest'
	return 'other'
}

export function platformTitle(p: Platform): string {
	switch (p) {
		case 'instagram':
			return 'Instagram'
		case 'tiktok':
			return 'TikTok'
		case 'youtube':
			return 'YouTube'
		case 'pinterest':
			return 'Pinterest'
		default:
			return 'Video'
	}
}

export interface EntryInfo {
	id: string
	title: string
	duration: number
	/** Videoning eng katta mavjud "qisqa tomoni" (720p, 1080p ...) */
	maxShortSide: number
	/** Taxminiy fayl hajmi (bayt) */
	approxBytes?: number
}

export interface MediaInfo {
	platform: Platform
	title: string
	uploader: string
	thumbnail?: string
	viewCount?: number
	likeCount?: number
	entries: EntryInfo[]
	maxShortSide: number
	totalDuration: number
	/** yt-dlp -J natijasi: ikkinchi marta saytni skanerlamasdan --load-info-json orqali 2x tez yuklash uchun */
	rawInfoJson?: string
}

interface YtFormat {
	vcodec?: string
	width?: number | null
	height?: number | null
	filesize?: number | null
	filesize_approx?: number | null
}

interface YtInfo {
	_type?: string
	id?: string
	title?: string
	description?: string
	uploader?: string
	channel?: string
	uploader_id?: string
	duration?: number
	width?: number
	height?: number
	thumbnail?: string
	view_count?: number
	like_count?: number
	formats?: YtFormat[]
	entries?: (YtInfo | null)[]
}

function commonArgs(needsJsRuntime = false): string[] {
	const args = [
		'--no-warnings',
		'--no-check-certificates',
		'--socket-timeout',
		'20',
		'--retries',
		'3',
		'--fragment-retries',
		'3',
		'--concurrent-fragments',
		'4',
		'--yes-playlist',
	]
	if (needsJsRuntime) {
		args.push('--js-runtimes', `node:${process.execPath}`)
	}
	if (config.cookiesFile) args.push('--cookies', config.cookiesFile)
	return args
}

/** yt-dlp xato matnini foydalanuvchi tanlagan tilda tushunarli xabarga aylantirish */
export function explainYtDlpError(stderr: string, lang: Lang = 'uz'): UserError {
	const d = t(lang)
	const s = stderr.toLowerCase()
	if (s.includes('no video') || s.includes('no media found') || s.includes('there is no video')) {
		return new UserError(d.errNoVideo)
	}
	if (s.includes('requested format is not available')) {
		return new UserError(d.errFormatUnavailable)
	}
	if (s.includes('unsupported url')) {
		return new UserError(d.errUnsupportedUrl)
	}
	if (
		s.includes('login required') ||
		s.includes('rate-limit') ||
		s.includes('rate limit') ||
		s.includes('not available') ||
		s.includes('private') ||
		s.includes('cookies') ||
		s.includes('401') ||
		s.includes('403')
	) {
		return new UserError(d.errPrivateOrRateLimit)
	}
	if (s.includes('404') || s.includes('does not exist')) {
		return new UserError(d.errNotFound)
	}
	return new UserError(d.errDownloadFailed)
}

function shortSide(w?: number | null, h?: number | null): number {
	if (w && h) return Math.min(w, h)
	return w || h || 0
}

function entryFrom(info: YtInfo): EntryInfo {
	const videoFormats = (info.formats ?? []).filter((f) => f.vcodec && f.vcodec !== 'none')
	const maxFromFormats = videoFormats.reduce((m, f) => Math.max(m, shortSide(f.width, f.height)), 0)
	const maxBytes = videoFormats.reduce(
		(m, f) => Math.max(m, f.filesize ?? f.filesize_approx ?? 0),
		0,
	)
	return {
		id: info.id ?? '',
		title: info.title ?? '',
		duration: info.duration ?? 0,
		maxShortSide: maxFromFormats || shortSide(info.width, info.height),
		approxBytes: maxBytes || undefined,
	}
}

/** Video haqida ma'lumot olish (yuklamasdan) */
export async function fetchInfo(url: string, lang: Lang = 'uz'): Promise<MediaInfo> {
	const d = t(lang)
	const platform = detectPlatform(url)
	const res = await run(config.ytdlpPath, [...commonArgs(platform === 'youtube'), '-J', '--', url], {
		timeoutMs: 90_000,
	})
	if (res.code !== 0) {
		console.error('[yt-dlp info]', res.stderr.trim())
		throw explainYtDlpError(res.stderr, lang)
	}
	let info: YtInfo
	try {
		info = JSON.parse(res.stdout)
	} catch {
		throw new UserError(d.errDownloadFailed)
	}

	const rawEntries =
		info._type === 'playlist' ? (info.entries ?? []).filter((e): e is YtInfo => !!e) : [info]
	const entries = rawEntries.map(entryFrom)
	if (entries.length === 0) throw new UserError(d.errNoVideo)

	const firstEntry = rawEntries[0]
	const caption = (info.description || info.title || firstEntry?.description || firstEntry?.title || '')
		.replace(/\s+/g, ' ')
		.trim()
	return {
		platform,
		title: caption,
		uploader:
			info.uploader ||
			info.channel ||
			info.uploader_id ||
			firstEntry?.uploader ||
			firstEntry?.channel ||
			'',
		thumbnail: info.thumbnail || firstEntry?.thumbnail || undefined,
		viewCount: info.view_count ?? firstEntry?.view_count ?? undefined,
		likeCount: info.like_count ?? firstEntry?.like_count ?? undefined,
		entries,
		maxShortSide: entries.reduce((m, e) => Math.max(m, e.maxShortSide), 0),
		totalDuration: entries.reduce((s, e) => s + e.duration, 0),
		rawInfoJson: info._type !== 'playlist' ? res.stdout : undefined,
	}
}

function formatArgs(quality: Quality): string[] {
	// Eslatma: "res" — videoning qisqa tomoni (vertikal reels uchun ham to'g'ri ishlaydi).
	// h264 + aac afzal ko'riladi — Telegram barcha qurilmalarda muammosiz ijro etadi.
	switch (quality) {
		case 'audio':
			return ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
		case 'q720':
			return ['-f', 'bv*+ba/b', '-S', 'res:720,vcodec:h264,acodec:aac', '--merge-output-format', 'mp4']
		case 'q480':
			return ['-f', 'bv*+ba/b', '-S', 'res:480,vcodec:h264,acodec:aac', '--merge-output-format', 'mp4']
		default:
			// best / upscale: eng yuqori original sifat (alohida video + audio oqimlari birlashtiriladi)
			return ['-f', 'bv*+ba/b', '-S', 'res,fps,vcodec:h264,acodec:aac', '--merge-output-format', 'mp4']
	}
}

/**
 * Videoni (yoki karuseldagi barcha videolarni) yuklab olish.
 * @returns yuklangan fayllar ro'yxati (tartib bo'yicha)
 */
export async function download(
	url: string,
	quality: Quality,
	outDir: string,
	onProgress?: (percent: number) => void,
	signal?: AbortSignal,
	lang: Lang = 'uz',
	rawInfoJson?: string,
): Promise<string[]> {
	fs.mkdirSync(outDir, { recursive: true })
	const platform = detectPlatform(url)

	const listDownloadedFiles = () =>
		fs
			.readdirSync(outDir)
			// .part / vaqtinchalik va birlashtirilmagan (name.f123.mp4) hamda _info.json fayllarni tashlab ketamiz
			.filter(
				(f) =>
					f !== '_info.json' &&
					!/\.(part|ytdl|temp|jpg|jpeg|png|webp|json)$/i.test(f) &&
					!/\.f[^.]+\.[^.]+$/.test(f),
			)
			.sort()
			.map((f) => path.join(outDir, f))

	const runDownload = async (useInfoJson: boolean) => {
		const args = [
			...commonArgs(platform === 'youtube'),
			...formatArgs(quality),
			'--newline',
			'--progress-template',
			'download:__P__%(progress._percent_str)s',
			'-o',
			path.join(outDir, '%(autonumber)s_%(id)s.%(ext)s'),
		]
		if (config.ffmpegPath !== 'ffmpeg') args.push('--ffmpeg-location', config.ffmpegPath)
		if (useInfoJson && rawInfoJson) {
			const infoFile = path.join(outDir, '_info.json')
			fs.writeFileSync(infoFile, rawInfoJson)
			args.push('--load-info-json', infoFile)
		} else {
			args.push('--', url)
		}

		return await run(config.ytdlpPath, args, {
			timeoutMs: 15 * 60_000,
			signal,
			onLine: (line) => {
				const m = line.match(/__P__\s*([\d.]+)%/)
				if (m && onProgress) onProgress(Number(m[1]))
			},
		})
	}

	// Agar fetchInfo dan tayyor JSON bo'lsa, saytni ikkinchi marta skanerlamasdan to'g'ridan-to'g'ri oqimni yuklaymiz!
	let res = await runDownload(!!rawInfoJson)
	let files = listDownloadedFiles()

	if (files.length === 0 && rawInfoJson && !signal?.aborted) {
		res = await runDownload(false)
		files = listDownloadedFiles()
	}

	if (res.code !== 0 && files.length === 0) {
		console.error('[yt-dlp download]', res.stderr.trim())
		throw explainYtDlpError(res.stderr, lang)
	}
	if (files.length === 0) throw new UserError(t(lang).errDownloadFailed)
	return files
}

/** Qidiruv so'rovi bo'yicha to'liq MP3 qo'shiqni yuklab olish (Shazam topilgandan keyin) */
export async function downloadSongByQuery(
	query: string,
	outDir: string,
	signal?: AbortSignal,
	lang: Lang = 'uz',
): Promise<string> {
	fs.mkdirSync(outDir, { recursive: true })
	const args = [
		...commonArgs(true),
		'--no-playlist',
		'-f',
		'ba/b',
		'-x',
		'--audio-format',
		'mp3',
		'--audio-quality',
		'0',
		'-o',
		path.join(outDir, 'song.%(ext)s'),
	]
	if (config.ffmpegPath !== 'ffmpeg') args.push('--ffmpeg-location', config.ffmpegPath)
	args.push('--', `ytsearch1:${query}`)

	const res = await run(config.ytdlpPath, args, {
		timeoutMs: 4 * 60_000,
		signal,
	})
	const files = fs
		.readdirSync(outDir)
		.filter((f) => f.endsWith('.mp3'))
		.map((f) => path.join(outDir, f))
	if (res.code !== 0 || files.length === 0) {
		throw new UserError(t(lang).errSongDownloadFailed)
	}
	return files[0]
}

/** yt-dlp ni eng so'nggi versiyaga yangilash */
export async function updateYtDlp(): Promise<void> {
	try {
		const res = await run(config.ytdlpPath, ['-U'], { timeoutMs: 120_000 })
		const out = (res.stdout + res.stderr).trim().split(/\r?\n/).pop()
		console.log(`🔄 yt-dlp: ${out}`)
	} catch (e) {
		console.warn("⚠️ yt-dlp ni yangilab bo'lmadi:", (e as Error).message)
	}
}
