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

/** Tezkor (0ms) boshlang'ich MediaInfo — tugmalarni kutmasdan 0.1 soniyada chiqarish uchun */
export function quickMediaInfo(url: string): MediaInfo {
	return {
		platform: detectPlatform(url),
		title: '',
		uploader: '',
		entries: [{ id: '', title: '', duration: 0, maxShortSide: 0 }],
		maxShortSide: 0,
		totalDuration: 0,
	}
}

export function parseYtInfoToMediaInfo(info: YtInfo, url: string, rawJson?: string): MediaInfo {
	const rawEntries =
		info._type === 'playlist' ? (info.entries ?? []).filter((e): e is YtInfo => !!e) : [info]
	const entries = rawEntries.map(entryFrom)
	const firstEntry = rawEntries[0]
	const caption = (info.description || info.title || firstEntry?.description || firstEntry?.title || '')
		.replace(/\s+/g, ' ')
		.trim()
	return {
		platform: detectPlatform(url),
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
		entries: entries.length > 0 ? entries : [{ id: '', title: '', duration: 0, maxShortSide: 0 }],
		maxShortSide: entries.reduce((m, e) => Math.max(m, e.maxShortSide), 0),
		totalDuration: entries.reduce((s, e) => s + e.duration, 0),
		rawInfoJson: info._type !== 'playlist' ? rawJson : undefined,
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
	const parsed = parseYtInfoToMediaInfo(info, url, res.stdout)
	if (parsed.entries.length === 0) throw new UserError(d.errNoVideo)
	return parsed
}

function formatArgs(quality: Quality, platform: Platform): string[] {
	// MUHIM: Cloud 0.1 CPU da "Converting format..." (ffmpeg libx264) ga tushib qolmaslik uchun
	// har doim tayyor H.264 (avc1) + AAC MP4 oqimini birinchi o'rinda olamiz!
	switch (quality) {
		case 'audio':
			return ['-f', 'ba/b', '-x', '--audio-format', 'mp3', '--audio-quality', '0']
		case 'q720':
			return [
				'-f',
				'bv*[vcodec^=avc]+ba/b[ext=mp4]/bv*+ba/b',
				'-S',
				'vcodec:h264,res:720,acodec:aac',
				'--merge-output-format',
				'mp4',
			]
		case 'q480':
			return [
				'-f',
				'bv*[vcodec^=avc]+ba/b[ext=mp4]/bv*+ba/b',
				'-S',
				'vcodec:h264,res:480,acodec:aac',
				'--merge-output-format',
				'mp4',
			]
		default:
			if (platform === 'instagram' && quality === 'best') {
				// Instagram uchun tayyor H.264 MP4 ('b') 1 soniyada yuklanadi va hech qanday konvertatsiya talab qilmaydi!
				return ['-f', 'b[ext=mp4]/bv*[vcodec^=avc]+ba/bv*+ba/b', '--merge-output-format', 'mp4']
			}
			return [
				'-f',
				'bv*[vcodec^=avc]+ba/b[ext=mp4]/bv*+ba/b',
				'-S',
				'vcodec:h264,res,fps,acodec:aac',
				'--merge-output-format',
				'mp4',
			]
	}
}

export interface DownloadResult {
	files: string[]
	info?: MediaInfo
}

/**
 * Videoni (yoki karuseldagi barcha videolarni) yuklab olish.
 * Bir urunishda (--write-info-json bilan) ham videoni, ham ma'lumotlarni oladi!
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
	const res = await downloadWithInfo(url, quality, outDir, onProgress, signal, lang, rawInfoJson)
	return res.files
}

export async function downloadWithInfo(
	url: string,
	quality: Quality,
	outDir: string,
	onProgress?: (percent: number) => void,
	signal?: AbortSignal,
	lang: Lang = 'uz',
	rawInfoJson?: string,
): Promise<DownloadResult> {
	fs.mkdirSync(outDir, { recursive: true })
	const platform = detectPlatform(url)

	const listDownloadedFiles = () =>
		fs
			.readdirSync(outDir)
			// .part / vaqtinchalik va birlashtirilmagan (name.f123.mp4) hamda .json fayllarni tashlab ketamiz
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
			...formatArgs(quality, platform),
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
			args.push('--write-info-json', '--', url)
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

	// Yozilgan .info.json fayldan video tavsifi va muallifini o'qib olamiz (ikkinchi marta yt-dlp chaqirmaslik uchun!)
	let parsedInfo: MediaInfo | undefined
	try {
		const jsonFiles = fs
			.readdirSync(outDir)
			.filter((f) => f.endsWith('.info.json'))
			.sort()
		if (jsonFiles.length > 0) {
			const raw = fs.readFileSync(path.join(outDir, jsonFiles[0]), 'utf8')
			const ytInfo = JSON.parse(raw) as YtInfo
			parsedInfo = parseYtInfoToMediaInfo(ytInfo, url, raw)
		}
	} catch {
		/* info.json o'qilmasa ham videoni yuboraveramiz */
	}

	return { files, info: parsedInfo }
}

/**
 * Qidiruv so'rovi bo'yicha to'liq MP3 qo'shiqni yuklab olish (Shazam topilgandan keyin).
 * Cloud serverlarda (Render/AWS) YouTube bot-tekshiruvi chiqmasligi uchun:
 * 1) SoundCloud (scsearch1:) — cloud serverda eng tezkor va bloksiz
 * 2) YouTube (ytsearch1:) — localhost va uy internetida
 * 3) BiliBili (bilisearch1:) — global zaxira manba
 */
export async function downloadSongByQuery(
	query: string,
	outDir: string,
	signal?: AbortSignal,
	lang: Lang = 'uz',
): Promise<string> {
	fs.mkdirSync(outDir, { recursive: true })

	const searchTargets: { prefix: string; needsJs: boolean }[] = [
		{ prefix: 'scsearch1', needsJs: false },
		{ prefix: 'ytsearch1', needsJs: true },
		{ prefix: 'bilisearch1', needsJs: false },
	]

	for (const target of searchTargets) {
		if (signal?.aborted) break
		const args = [
			...commonArgs(target.needsJs),
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
		args.push('--', `${target.prefix}:${query}`)

		const res = await run(config.ytdlpPath, args, {
			timeoutMs: 2 * 60_000,
			signal,
		}).catch(() => ({ code: 1, stdout: '', stderr: '' }))

		const files = fs
			.readdirSync(outDir)
			.filter((f) => f.endsWith('.mp3'))
			.map((f) => path.join(outDir, f))
		if (res.code === 0 && files.length > 0) {
			return files[0]
		}
	}

	throw new UserError(t(lang).errSongDownloadFailed)
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
