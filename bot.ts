import { Bot, InlineKeyboard, InputFile } from 'grammy'
import crypto from 'crypto'
import fs from 'fs'
import http from 'http'
import path from 'path'
import { config, MAX_UPLOAD_BYTES } from './src/config'
import {
	detectPlatform,
	download,
	downloadSongByQuery,
	fetchInfo,
	MediaInfo,
	platformTitle,
	Quality,
	updateYtDlp,
	UserError,
} from './src/downloader'
import {
	applyAudioEffect,
	AudioEffect,
	bitrateBudgetKbps,
	encodeVideo,
	extractMp3FromMedia,
	ffmpegAvailable,
	makeThumbnail,
	probe,
	ProbeResult,
} from './src/ffmpeg'
import { autoQualityLabel, effectLabel, t } from './src/i18n'
import { CancelledError } from './src/run'
import { recognizeMusicFromFile, ShazamTrack } from './src/shazam'
import {
	getCachedMedia,
	getStats,
	getUserPrefs,
	Lang,
	recordDownload,
	setCachedMedia,
	updateUserPrefs,
	UserPrefs,
} from './src/store'

// Token endi .env faylidan olinadi
const bot = new Bot(config.botToken, {
	client: { apiRoot: config.apiRoot, timeoutSeconds: 900 },
})

let ffmpegOk = false

// ───────────────────────── Yordamchi funksiyalar va Navbat ─────────────────────────

/** Bir vaqtda ishlaydigan og'ir vazifalar sonini cheklash (navbat + /stop bekor qilish bilan) */
class Semaphore {
	private active = 0
	private queue: { resolve: () => void; reject: (err: Error) => void; signal?: AbortSignal }[] = []
	constructor(private readonly max: number) {}
	get waiting() {
		return this.queue.length
	}
	get isFull() {
		return this.active >= this.max
	}
	async acquire(signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new CancelledError()
		if (this.active < this.max) {
			this.active++
			return
		}
		await new Promise<void>((resolve, reject) => {
			const entry = { resolve, reject, signal }
			const onAbort = () => {
				const idx = this.queue.indexOf(entry)
				if (idx !== -1) this.queue.splice(idx, 1)
				reject(new CancelledError())
			}
			signal?.addEventListener('abort', onAbort, { once: true })
			this.queue.push(entry)
		})
	}
	release(): void {
		while (this.queue.length > 0) {
			const next = this.queue.shift()!
			if (next.signal?.aborted) continue
			next.resolve()
			return
		}
		this.active--
	}
}

const semaphore = new Semaphore(config.maxConcurrentJobs)

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s)

function resLabel(short: number): string {
	if (short >= 2160) return '4K'
	if (short >= 1440) return '2K'
	return `${short}p`
}

function fmtDuration(sec: number): string {
	const s = Math.round(sec)
	const m = Math.floor(s / 60)
	return `${m}:${String(s % 60).padStart(2, '0')}`
}

function fmtSize(bytes: number): string {
	const mb = bytes / 1024 / 1024
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

function fmtCount(n?: number): string {
	if (!n) return ''
	if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
	if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
	return String(n)
}

function progressBar(percent: number): string {
	const filled = Math.round(Math.min(100, Math.max(0, percent)) / 10)
	return `${'▰'.repeat(filled)}${'▱'.repeat(10 - filled)} ${percent.toFixed(0)}%`
}

/** Status xabarini tez-tez tahrirlab Telegram limitiga tushib qolmaslik uchun (+ /stop tugmasi bilan) */
function createStatus(chatId: number, messageId: number, lang: Lang) {
	let lastText = ''
	let lastAt = 0
	let pending: string | null = null
	let timer: NodeJS.Timeout | undefined
	let closed = false

	const stopMarkup = new InlineKeyboard().text(t(lang).btnStop, 'stop:now')

	const edit = async (text: string, withStop = true) => {
		if (text === lastText) return
		lastText = text
		lastAt = Date.now()
		await bot.api
			.editMessageText(chatId, messageId, text, {
				parse_mode: 'HTML',
				reply_markup: withStop ? stopMarkup : undefined,
			})
			.catch(() => {})
	}
	const flush = () => {
		timer = undefined
		if (closed || pending === null) return
		const text = pending
		pending = null
		void edit(text, true)
	}
	return {
		set(text: string) {
			if (closed) return
			pending = text
			const wait = 2500 - (Date.now() - lastAt)
			if (wait <= 0) flush()
			else if (!timer) timer = setTimeout(flush, wait)
		},
		/** Darhol tahrirlash (throttle siz) */
		async now(text: string) {
			if (closed) return
			pending = null
			if (timer) clearTimeout(timer)
			timer = undefined
			await edit(text, true)
		},
		async final(text: string) {
			closed = true
			if (timer) clearTimeout(timer)
			await edit(text, false)
		},
		async remove() {
			closed = true
			if (timer) clearTimeout(timer)
			await bot.api.deleteMessage(chatId, messageId).catch(() => {})
		},
	}
}
type Status = ReturnType<typeof createStatus>

/** Uzoq davom etadigan yuborish paytida "video yuborilmoqda..." holatini ko'rsatib turish */
async function withChatAction<T>(
	chatId: number,
	action: 'upload_video' | 'upload_document' | 'upload_voice',
	fn: () => Promise<T>,
): Promise<T> {
	const send = () => bot.api.sendChatAction(chatId, action).catch(() => {})
	void send()
	const interval = setInterval(send, 4500)
	try {
		return await fn()
	} finally {
		clearInterval(interval)
	}
}

/** Telegram serveridan faylni vaqtinchalik papkaga yuklab olish (video/audio/voice uchun) */
async function downloadTelegramFile(
	fileId: string,
	destPath: string,
	signal?: AbortSignal,
	lang: Lang = 'uz',
): Promise<void> {
	const file = await bot.api.getFile(fileId)
	if (!file.file_path) throw new UserError(t(lang).errDownloadFailed)
	if (path.isAbsolute(file.file_path) && fs.existsSync(file.file_path)) {
		fs.copyFileSync(file.file_path, destPath)
		return
	}
	const root = config.apiRoot || 'https://api.telegram.org'
	const url = `${root}/file/bot${config.botToken}/${file.file_path}`
	const res = await fetch(url, { signal })
	if (!res.ok) throw new UserError(t(lang).errDownloadFailed)
	const buf = Buffer.from(await res.arrayBuffer())
	fs.mkdirSync(path.dirname(destPath), { recursive: true })
	fs.writeFileSync(destPath, buf)
}

// ───────────────────────── Havolalarni aniqlash ─────────────────────────

const MEDIA_URL_RE =
	/https?:\/\/(?:[\w-]+\.)?(?:instagram\.com|instagr\.am|tiktok\.com|youtube\.com|youtu\.be|pinterest\.\w+|pin\.it)\/[^\s<>"']+/i
const IG_PATH_RE = /\/(p|reel|reels|tv|stories|share)\//i

async function extractMediaUrl(text: string): Promise<string | null> {
	const m = text.match(MEDIA_URL_RE)
	if (!m) return null
	let u: URL
	try {
		u = new URL(m[0])
	} catch {
		return null
	}
	const platform = detectPlatform(u.toString())

	if (platform === 'instagram') {
		if (!IG_PATH_RE.test(u.pathname)) return null
		if (/^\/share\//i.test(u.pathname)) {
			try {
				const res = await fetch(u.toString(), {
					redirect: 'follow',
					headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
					signal: AbortSignal.timeout(15_000),
				})
				u = new URL(res.url)
			} catch {
				/* asl havola bilan davom etamiz */
			}
		}
		return `https://www.instagram.com${u.pathname}`
	}

	return u.toString()
}

// ───────────────────────── So'rovlar va Media Sessiyalar ─────────────────────────

interface Job {
	id: string
	url: string
	info: MediaInfo
	userId: number
	chatId: number
	messageId: number
	asDocument: boolean
	lang: Lang
	createdAt: number
}

/** Audio Studiya / Shazam uchun manba (URL yoki Telegram file_id yoki qidiruv nomi) */
interface MediaSession {
	id: string
	userId: number
	chatId: number
	lang: Lang
	/** Manba turi: url = havola, tg = Telegramdagi video/audio/voice file_id, query = qo'shiq nomi */
	sourceType: 'url' | 'tg' | 'query'
	sourceValue: string
	title: string
	artist: string
	createdAt: number
}

const jobs = new Map<string, Job>()
const sessions = new Map<string, MediaSession>()

/** Foydalanuvchining hozirgi faol jarayonini /stop bilan to'xtatish uchun AbortController */
const activeUserControllers = new Map<number, AbortController>()

function startUserTask(userId: number): AbortController {
	const prev = activeUserControllers.get(userId)
	if (prev) prev.abort()
	const ctrl = new AbortController()
	activeUserControllers.set(userId, ctrl)
	return ctrl
}

function finishUserTask(userId: number, ctrl: AbortController): void {
	if (activeUserControllers.get(userId) === ctrl) {
		activeUserControllers.delete(userId)
	}
}

function stopUserTask(userId: number): boolean {
	const ctrl = activeUserControllers.get(userId)
	if (!ctrl) return false
	ctrl.abort()
	activeUserControllers.delete(userId)
	return true
}

// Eski so'rovlarni xotiradan tozalash
setInterval(() => {
	const limit = Date.now() - 60 * 60_000
	for (const [id, job] of jobs) if (job.createdAt < limit) jobs.delete(id)
	for (const [id, s] of sessions) if (s.createdAt < limit) sessions.delete(id)
}, 10 * 60_000).unref()

function createSession(
	userId: number,
	chatId: number,
	lang: Lang,
	sourceType: MediaSession['sourceType'],
	sourceValue: string,
	title = 'Audio',
	artist = '',
): MediaSession {
	const id = crypto.randomBytes(6).toString('base64url')
	const s: MediaSession = {
		id,
		userId,
		chatId,
		lang,
		sourceType,
		sourceValue,
		title,
		artist,
		createdAt: Date.now(),
	}
	sessions.set(id, s)
	return s
}

const QUALITIES: Record<Quality, string> = {
	best: 'Original',
	q720: '720p',
	q480: '480p',
	up1440: '2K (upscale)',
	up2160: '4K (upscale)',
	audio: 'MP3',
}

function buildKeyboard(job: Job): InlineKeyboard {
	const d = t(job.lang)
	const max = job.info.maxShortSide
	const kb = new InlineKeyboard()
	kb.text(d.qBest(max ? resLabel(max) : undefined), `dl:${job.id}:best`).row()

	if (!max || max > 720) kb.text(d.q720, `dl:${job.id}:q720`)
	if (!max || max > 480) kb.text(d.q480, `dl:${job.id}:q480`)
	kb.row()

	if (ffmpegOk) {
		if (!max || max < 1440) kb.text(d.q2k, `dl:${job.id}:up1440`)
		if (!max || max < 2160) kb.text(d.q4k, `dl:${job.id}:up2160`)
		kb.row()
	}

	// Audio, Shazam va Karaoke/Studio tugmalari
	const sess = createSession(
		job.userId,
		job.chatId,
		job.lang,
		'url',
		job.url,
		job.info.title || 'Audio',
		job.info.uploader,
	)
	kb.text(d.qAudio, `dl:${job.id}:audio`).text(d.qShazam, `shz:${sess.id}`).row()
	kb.text(d.btnStudioEffects, `stu:${sess.id}`).row()
	kb.text(d.sendAsDoc(job.asDocument), `tg:${job.id}`).row()
	kb.text(d.btnSettings, 'st:open').text(d.btnCancel, `cx:${job.id}`)
	return kb
}

function postDownloadKeyboard(job: Job, usedQuality: Quality): InlineKeyboard {
	const d = t(job.lang)
	const sess = createSession(
		job.userId,
		job.chatId,
		job.lang,
		'url',
		job.url,
		job.info.title || 'Audio',
		job.info.uploader,
	)
	const kb = new InlineKeyboard()
	if (usedQuality !== 'audio') {
		const audioJobId = crypto.randomBytes(6).toString('base64url')
		jobs.set(audioJobId, { ...job, id: audioJobId, createdAt: Date.now() })
		kb.text(d.btnExtractMp3, `quick:${audioJobId}:audio`)
	}
	kb.text(d.btnFindSong, `shz:${sess.id}`).row()
	kb.text(d.btnStudioEffects, `stu:${sess.id}`).url(d.btnOpenPost, job.url)
	return kb
}

function studioEffectsKeyboard(sess: MediaSession, includeShazam = false): InlineKeyboard {
	const d = t(sess.lang)
	const kb = new InlineKeyboard()
	if (includeShazam) {
		kb.text(d.qShazam, `shz:${sess.id}`).text(d.btnExtractMp3, `fx:${sess.id}:orig`).row()
	}
	kb.text(d.effectKaraoke, `fx:${sess.id}:karaoke`).text(d.effectVocal, `fx:${sess.id}:vocal`).row()
	kb.text(d.effectSlowed, `fx:${sess.id}:slowed`).text(d.effectSpeedup, `fx:${sess.id}:speedup`).row()
	kb.text(d.effectBass, `fx:${sess.id}:bass`).text(d.effect8d, `fx:${sess.id}:8d`)
	return kb
}

function infoText(job: Job): string {
	const d = t(job.lang)
	const { info } = job
	const pTitle = platformTitle(info.platform)
	const lines = [d.videoFound(pTitle), '']
	if (info.uploader) lines.push(`👤 <b>${escapeHtml(info.uploader)}</b>`)
	if (info.title) lines.push(`📝 ${escapeHtml(truncate(info.title, 160))}`)
	const meta: string[] = []
	if (info.totalDuration) meta.push(`⏱ ${fmtDuration(info.totalDuration)}`)
	if (info.entries.length > 1) meta.push(d.videosCount(info.entries.length))
	if (info.maxShortSide) meta.push(`📐 ${d.originalLabel}: ${resLabel(info.maxShortSide)}`)
	if (info.viewCount) meta.push(`👁 ${fmtCount(info.viewCount)}`)
	if (info.likeCount) meta.push(`❤️ ${fmtCount(info.likeCount)}`)
	if (meta.length) lines.push(meta.join('  •  '))
	lines.push('', d.chooseFormat)
	if (ffmpegOk && info.maxShortSide && info.maxShortSide < 2160) {
		lines.push('', d.upscaleHint)
	}
	return lines.join('\n')
}

// ───────────────────────── Videoni tayyorlash va yuborish ─────────────────────────

interface Prepared {
	file: string
	meta: ProbeResult | null
}

async function prepareVideo(
	file: string,
	quality: Quality,
	workDir: string,
	status: Status,
	prefix: string,
	lang: Lang,
	signal: AbortSignal,
): Promise<Prepared> {
	const d = t(lang)
	const upTarget = quality === 'up2160' ? 2160 : quality === 'up1440' ? 1440 : 0
	if (!ffmpegOk) {
		if (upTarget) throw new UserError(d.errNoFfmpeg)
		return { file, meta: null }
	}

	const base = path.parse(file).name
	let current = file
	let meta = await probe(current)
	const srcShort = Math.min(meta.width, meta.height)

	// 1) 2K / 4K upscale
	if (upTarget && srcShort && srcShort < upTarget) {
		const label = resLabel(upTarget)
		const budget = bitrateBudgetKbps(meta.duration, MAX_UPLOAD_BYTES)
		const minKbps = upTarget === 2160 ? 2500 : 1500
		if (budget < minKbps) {
			throw new UserError(d.longVideoUpscaleError(fmtDuration(meta.duration), label, config.maxUploadMb))
		}
		const out = path.join(workDir, `${base}_${label}.mp4`)
		await encodeVideo(current, out, meta, {
			targetShort: upTarget,
			maxKbps: budget,
			crf: 17,
			sharpen: true,
			signal,
			onProgress: (p) => status.set(`${prefix}${d.upscaling(label)}\n${progressBar(p)}`),
		})
		current = out
		meta = await probe(current)
	} else if (!['h264', 'hevc'].includes(meta.vcodec)) {
		// 2) VP9/AV1 bo'lsa — barcha qurilmalarda ishlashi uchun H.264 ga o'tkazish
		const out = path.join(workDir, `${base}_h264.mp4`)
		await encodeVideo(current, out, meta, {
			crf: 18,
			maxKbps: bitrateBudgetKbps(meta.duration, MAX_UPLOAD_BYTES),
			signal,
			onProgress: (p) => status.set(`${prefix}${d.converting}\n${progressBar(p)}`),
		})
		current = out
		meta = await probe(current)
	}

	// 3) Telegram limitidan katta bo'lsa — siqish
	if (fs.statSync(current).size > MAX_UPLOAD_BYTES) {
		const budget = bitrateBudgetKbps(meta.duration, MAX_UPLOAD_BYTES)
		if (upTarget || budget < 300) {
			throw new UserError(d.tooLargeError(config.maxUploadMb))
		}
		const out = path.join(workDir, `${base}_fit.mp4`)
		await encodeVideo(current, out, meta, {
			crf: 20,
			maxKbps: budget,
			signal,
			onProgress: (p) => status.set(`${prefix}${d.compressing}\n${progressBar(p)}`),
		})
		current = out
		meta = await probe(current)
		if (fs.statSync(current).size > MAX_UPLOAD_BYTES) {
			throw new UserError(d.tooLargeError(config.maxUploadMb))
		}
	}
	return { file: current, meta }
}

function buildFinalCaption(job: Job, badge: string, sizeBytes: number, prefix: string): string {
	const parts: string[] = []
	if (job.info.uploader) parts.push(`👤 <b>${escapeHtml(job.info.uploader)}</b>`)
	if (job.info.title) parts.push(`📝 ${escapeHtml(truncate(job.info.title, 220))}`)
	parts.push(
		`${prefix}✅ <b>${escapeHtml(badge)}</b> • ${fmtSize(sizeBytes)}\n🤖 @${bot.botInfo.username}`,
	)
	return parts.join('\n\n')
}

async function sendFromCache(job: Job, quality: Quality, index: number, prefix: string): Promise<boolean> {
	const cached = getCachedMedia(job.url, quality, job.asDocument, index)
	if (!cached) return false
	const caption = buildFinalCaption(job, cached.resLabel, cached.sizeBytes, prefix)
	const reply_markup = index === 0 ? postDownloadKeyboard(job, quality) : undefined
	try {
		if (cached.kind === 'document') {
			await bot.api.sendDocument(job.chatId, cached.fileId, {
				caption,
				parse_mode: 'HTML',
				reply_markup,
			})
		} else if (cached.kind === 'audio') {
			await bot.api.sendAudio(job.chatId, cached.fileId, {
				caption,
				parse_mode: 'HTML',
				reply_markup,
			})
		} else {
			await bot.api.sendVideo(job.chatId, cached.fileId, {
				caption,
				parse_mode: 'HTML',
				supports_streaming: true,
				reply_markup,
			})
		}
		return true
	} catch {
		return false
	}
}

async function sendVideo(
	job: Job,
	quality: Quality,
	prepared: Prepared,
	index: number,
	prefix: string,
	workDir: string,
) {
	const { file, meta } = prepared
	const size = fs.statSync(file).size
	const resText = meta?.width ? resLabel(Math.min(meta.width, meta.height)) : QUALITIES[quality]
	const badge = `${resText}${quality.startsWith('up') ? ' (upscale)' : ''}`
	const caption = buildFinalCaption(job, badge, size, prefix)
	const fileName = `video_${resText}_${index + 1}.mp4`
	const reply_markup = index === 0 ? postDownloadKeyboard(job, quality) : undefined

	let thumbnail: InputFile | undefined
	if (meta) {
		const thumbPath = path.join(workDir, `thumb_${index}.jpg`)
		if (await makeThumbnail(file, thumbPath, meta.duration)) thumbnail = new InputFile(thumbPath)
	}

	if (job.asDocument) {
		const msg = await withChatAction(job.chatId, 'upload_document', () =>
			bot.api.sendDocument(job.chatId, new InputFile(file, fileName), {
				caption,
				parse_mode: 'HTML',
				thumbnail,
				reply_markup,
			}),
		)
		if (msg.document?.file_id) {
			setCachedMedia(job.url, quality, true, index, {
				fileId: msg.document.file_id,
				kind: 'document',
				resLabel: badge,
				sizeBytes: size,
				uploader: job.info.uploader,
				title: job.info.title,
			})
		}
	} else {
		const msg = await withChatAction(job.chatId, 'upload_video', () =>
			bot.api.sendVideo(job.chatId, new InputFile(file, fileName), {
				caption,
				parse_mode: 'HTML',
				thumbnail,
				supports_streaming: true,
				reply_markup,
				...(meta?.width ? { width: meta.width, height: meta.height } : {}),
				...(meta?.duration ? { duration: Math.round(meta.duration) } : {}),
			}),
		)
		if (msg.video?.file_id) {
			setCachedMedia(job.url, quality, false, index, {
				fileId: msg.video.file_id,
				kind: 'video',
				resLabel: badge,
				sizeBytes: size,
				uploader: job.info.uploader,
				title: job.info.title,
			})
		}
	}
}

async function sendAudio(job: Job, file: string, index: number, prefix: string) {
	const d = t(job.lang)
	const size = fs.statSync(file).size
	if (size > MAX_UPLOAD_BYTES) throw new UserError(d.tooLargeError(config.maxUploadMb))
	const caption = buildFinalCaption(job, 'MP3 Audio', size, prefix)
	const title = truncate(job.info.title || 'Audio', 60)
	const fileName = `audio_${index + 1}.mp3`
	const reply_markup = index === 0 ? postDownloadKeyboard(job, 'audio') : undefined

	if (job.asDocument) {
		const msg = await withChatAction(job.chatId, 'upload_document', () =>
			bot.api.sendDocument(job.chatId, new InputFile(file, fileName), {
				caption,
				parse_mode: 'HTML',
				reply_markup,
			}),
		)
		if (msg.document?.file_id) {
			setCachedMedia(job.url, 'audio', true, index, {
				fileId: msg.document.file_id,
				kind: 'document',
				resLabel: 'MP3 Audio',
				sizeBytes: size,
				uploader: job.info.uploader,
				title: job.info.title,
			})
		}
	} else {
		const msg = await withChatAction(job.chatId, 'upload_voice', () =>
			bot.api.sendAudio(job.chatId, new InputFile(file, fileName), {
				caption,
				parse_mode: 'HTML',
				title,
				performer: job.info.uploader || undefined,
				reply_markup,
			}),
		)
		if (msg.audio?.file_id) {
			setCachedMedia(job.url, 'audio', false, index, {
				fileId: msg.audio.file_id,
				kind: 'audio',
				resLabel: 'MP3 Audio',
				sizeBytes: size,
				uploader: job.info.uploader,
				title: job.info.title,
			})
		}
	}
}

async function processJob(job: Job, quality: Quality): Promise<void> {
	const d = t(job.lang)
	const ctrl = startUserTask(job.userId)
	const signal = ctrl.signal
	const workDir = path.join(config.tmpDir, job.id)
	const status = createStatus(job.chatId, job.messageId, job.lang)
	try {
		// 1) Keshda tayyor file_id bo'lsa — 0.5 soniyada yuboramiz!
		if (job.info.entries.length === 1) {
			const hit = await sendFromCache(job, quality, 0, '')
			if (hit) {
				recordDownload(job.userId)
				await status.remove()
				return
			}
		}

		if (semaphore.isFull) await status.now(d.queued(semaphore.waiting + 1))
		await semaphore.acquire(signal)
		try {
			const what = QUALITIES[quality]
			status.set(d.downloading(what))
			const files = await download(
				job.url,
				quality,
				path.join(workDir, 'dl'),
				(p) => status.set(`${d.downloading(what)}\n${progressBar(p)}`),
				signal,
				job.lang,
			)

			for (const [i, file] of files.entries()) {
				if (signal.aborted) throw new CancelledError()
				const prefix = files.length > 1 ? `(${i + 1}/${files.length}) ` : ''
				if (quality === 'audio') {
					status.set(`${prefix}${d.uploading}`)
					await sendAudio(job, file, i, prefix)
				} else {
					const prepared = await prepareVideo(file, quality, workDir, status, prefix, job.lang, signal)
					status.set(`${prefix}${d.uploading}`)
					await sendVideo(job, quality, prepared, i, prefix, workDir)
				}
			}
			recordDownload(job.userId)
		} finally {
			semaphore.release()
		}
		await status.remove()
	} catch (err) {
		if (err instanceof CancelledError) {
			await status.final(d.stoppedSuccess)
		} else if (err instanceof UserError) {
			await status.final(err.message)
		} else {
			console.error('Kutilmagan xatolik:', err)
			const tooBig = String((err as Error)?.message).includes('Request Entity Too Large')
			await status.final(tooBig ? d.tooLargeError(config.maxUploadMb) : d.genericError)
		}
	} finally {
		finishUserTask(job.userId, ctrl)
		fs.rm(workDir, { recursive: true, force: true }, () => {})
	}
}

// ───────────────── Shazam va Audio Studiya (Karaoke / Slowed / 8D) ─────────────────

/** MediaSession dan foydalanib manba audio/video faylini diskka tayyorlab beradi */
async function obtainSessionMediaFile(sess: MediaSession, workDir: string, signal: AbortSignal): Promise<string> {
	fs.mkdirSync(workDir, { recursive: true })
	if (sess.sourceType === 'tg') {
		const dest = path.join(workDir, 'input_media')
		await downloadTelegramFile(sess.sourceValue, dest, signal, sess.lang)
		return dest
	}
	if (sess.sourceType === 'query') {
		return await downloadSongByQuery(sess.sourceValue, workDir, signal, sess.lang)
	}
	const files = await download(sess.sourceValue, 'audio', workDir, undefined, signal, sess.lang)
	return files[0]
}

async function runShazamTask(sess: MediaSession, statusMsgId: number): Promise<void> {
	const d = t(sess.lang)
	const ctrl = startUserTask(sess.userId)
	const signal = ctrl.signal
	const workDir = path.join(config.tmpDir, `shz_${sess.id}_${Date.now()}`)
	const status = createStatus(sess.chatId, statusMsgId, sess.lang)

	try {
		if (semaphore.isFull) await status.now(d.queued(semaphore.waiting + 1))
		await semaphore.acquire(signal)
		let track: ShazamTrack | null = null
		try {
			await status.now(d.shazamSearching)
			const mediaFile = await obtainSessionMediaFile(sess, workDir, signal)
			if (signal.aborted) throw new CancelledError()
			track = await recognizeMusicFromFile(mediaFile)
		} finally {
			semaphore.release()
		}

		if (!track) {
			await bot.api
				.editMessageText(sess.chatId, statusMsgId, d.shazamNotFound, {
					parse_mode: 'HTML',
					reply_markup: studioEffectsKeyboard(sess, false),
				})
				.catch(() => {})
			return
		}

		// Topilgan qo'shiq uchun yangi session yaratamiz (to'liq qo'shiq va uning Karaoke/Slowed versiyalarini olish uchun)
		const songQuery = `${track.artist} - ${track.title}`
		const songSess = createSession(
			sess.userId,
			sess.chatId,
			sess.lang,
			'query',
			songQuery,
			track.title,
			track.artist,
		)

		const lines = [
			d.shazamFoundTitle,
			'',
			`🎵 <b>${escapeHtml(track.title)}</b>`,
			`👤 <b>${escapeHtml(track.artist)}</b>`,
		]
		if (track.album) lines.push(`${d.shazamAlbum}: ${escapeHtml(track.album)}`)
		if (track.year) lines.push(`${d.shazamYear}: ${escapeHtml(track.year)}`)

		const kb = new InlineKeyboard()
			.text(d.btnFullSong, `full:${songSess.id}`)
			.row()
			.text(d.effectKaraoke, `fx:${songSess.id}:karaoke`)
			.text(d.effectVocal, `fx:${songSess.id}:vocal`)
			.row()
			.text(d.effectSlowed, `fx:${songSess.id}:slowed`)
			.text(d.effectSpeedup, `fx:${songSess.id}:speedup`)
			.row()
			.text(d.effectBass, `fx:${songSess.id}:bass`)
			.text(d.effect8d, `fx:${songSess.id}:8d`)

		if (track.shazamUrl) {
			kb.row().url('🔗 Shazam', track.shazamUrl)
		}

		await status.remove()
		if (track.coverUrl) {
			try {
				await bot.api.sendPhoto(sess.chatId, track.coverUrl, {
					caption: lines.join('\n'),
					parse_mode: 'HTML',
					reply_markup: kb,
				})
				return
			} catch {
				/* rasm o'tmasa oddiy xabar yuboramiz */
			}
		}
		await bot.api.sendMessage(sess.chatId, lines.join('\n'), {
			parse_mode: 'HTML',
			reply_markup: kb,
		})
	} catch (err) {
		if (err instanceof CancelledError) {
			await status.final(d.stoppedSuccess)
		} else if (err instanceof UserError) {
			await status.final(err.message)
		} else {
			console.error('Shazam xatolik:', err)
			await status.final(d.genericError)
		}
	} finally {
		finishUserTask(sess.userId, ctrl)
		fs.rm(workDir, { recursive: true, force: true }, () => {})
	}
}

async function runAudioStudioTask(
	sess: MediaSession,
	mode: 'orig' | 'full' | AudioEffect,
	statusMsgId: number,
): Promise<void> {
	const d = t(sess.lang)
	const ctrl = startUserTask(sess.userId)
	const signal = ctrl.signal
	const workDir = path.join(config.tmpDir, `fx_${sess.id}_${Date.now()}`)
	const status = createStatus(sess.chatId, statusMsgId, sess.lang)

	try {
		if (semaphore.isFull) await status.now(d.queued(semaphore.waiting + 1))
		await semaphore.acquire(signal)
		try {
			await status.now(
				mode === 'full'
					? d.downloadingFullSong
					: mode === 'orig'
						? d.extractingAudio
						: d.applyingEffect(effectLabel(sess.lang, mode)),
			)

			const srcFile = await obtainSessionMediaFile(sess, workDir, signal)
			if (signal.aborted) throw new CancelledError()

			const outMp3 = path.join(workDir, 'output.mp3')
			let badge = 'MP3 Audio'
			if (mode === 'orig' || mode === 'full') {
				if (srcFile.endsWith('.mp3')) {
					fs.copyFileSync(srcFile, outMp3)
				} else {
					await extractMp3FromMedia(srcFile, outMp3, signal)
				}
				badge = mode === 'full' ? 'Original Full Song' : 'MP3 Audio'
			} else {
				await applyAudioEffect(srcFile, outMp3, mode, signal)
				badge = effectLabel(sess.lang, mode)
			}

			const size = fs.statSync(outMp3).size
			if (size > MAX_UPLOAD_BYTES) throw new UserError(d.tooLargeError(config.maxUploadMb))

			await status.now(d.uploading)
			const titleSuffix = mode === 'orig' || mode === 'full' ? '' : ` (${mode.toUpperCase()})`
			const trackTitle = truncate(`${sess.title || 'Audio'}${titleSuffix}`, 60)
			const cleanName = trackTitle.replace(/[^\w\s()-]/g, '').trim() || 'audio'
			const caption = [
				sess.artist ? `👤 <b>${escapeHtml(sess.artist)}</b>` : '',
				`🎵 <b>${escapeHtml(trackTitle)}</b>`,
				`✨ ${escapeHtml(badge)} • ${fmtSize(size)}\n🤖 @${bot.botInfo.username}`,
			]
				.filter(Boolean)
				.join('\n')

			await withChatAction(sess.chatId, 'upload_voice', () =>
				bot.api.sendAudio(sess.chatId, new InputFile(outMp3, `${cleanName}.mp3`), {
					caption,
					parse_mode: 'HTML',
					title: trackTitle,
					performer: sess.artist || `@${bot.botInfo.username}`,
					reply_markup: studioEffectsKeyboard(sess, false),
				}),
			)
			recordDownload(sess.userId)
		} finally {
			semaphore.release()
		}
		await status.remove()
	} catch (err) {
		if (err instanceof CancelledError) {
			await status.final(d.stoppedSuccess)
		} else if (err instanceof UserError) {
			await status.final(err.message)
		} else {
			console.error('Audio studio xatolik:', err)
			await status.final(d.genericError)
		}
	} finally {
		finishUserTask(sess.userId, ctrl)
		fs.rm(workDir, { recursive: true, force: true }, () => {})
	}
}

// ───────────────────────── Til va Sozlamalar menyusi ─────────────────────────

function languageKeyboard(): InlineKeyboard {
	return new InlineKeyboard()
		.text("🇺🇿 O'zbekcha", 'lang:uz')
		.text('🇷🇺 Русский', 'lang:ru')
		.text('🇬🇧 English', 'lang:en')
}

function settingsText(prefs: UserPrefs): string {
	const d = t(prefs.lang)
	return [
		d.settingsTitle,
		'',
		`${d.settingsLang} <b>${d.langName}</b>`,
		`${d.settingsAutoQuality} <b>${autoQualityLabel(prefs.lang, prefs.autoQuality)}</b>`,
		`${d.settingsDocMode} <b>${prefs.asDocument ? '✅' : '❌'}</b>`,
		`${d.settingsDownloads} <b>${prefs.downloads}</b>`,
		'',
		d.settingsHint,
	].join('\n')
}

function welcomeKeyboard(prefs: UserPrefs): InlineKeyboard {
	const d = t(prefs.lang)
	const kb = new InlineKeyboard().text(d.btnSettings, 'st:open').text(d.btnLanguage, 'st:lang')
	if (!prefs.langSelected) {
		kb.row()
			.text("🇺🇿 O'zbekcha", 'lang:uz')
			.text('🇷🇺 Русский', 'lang:ru')
			.text('🇬🇧 English', 'lang:en')
	}
	return kb
}

function settingsKeyboard(prefs: UserPrefs): InlineKeyboard {
	const d = t(prefs.lang)
	const kb = new InlineKeyboard()

	const options: UserPrefs['autoQuality'][] = ['ask', 'best', 'q720', 'up1440', 'up2160', 'audio']
	for (const [idx, opt] of options.entries()) {
		const active = prefs.autoQuality === opt ? '✅ ' : ''
		kb.text(`${active}${autoQualityLabel(prefs.lang, opt)}`, `st:q:${opt}`)
		if (idx % 2 === 1) kb.row()
	}
	kb.row()
	kb.text(d.sendAsDoc(prefs.asDocument), 'st:doc').row()
	kb.text(`${d.btnLanguage} (${d.langName})`, 'st:lang')
	return kb
}

// ───────────────────────── Bot komandalari va handlerlari ─────────────────────────

const START_ANIM_PATH = path.join(config.rootDir, 'assets', 'brand', 'bot_animation.mp4')
let startAnimFileId: string | undefined

bot.command(['start', 'help'], async (ctx) => {
	const prefs = ctx.from ? getUserPrefs(ctx.from.id, ctx.from.language_code) : getUserPrefs(0)
	const d = t(prefs.lang)
	const kb = welcomeKeyboard(prefs)

	if (fs.existsSync(START_ANIM_PATH)) {
		try {
			const msg = await ctx.replyWithAnimation(
				startAnimFileId ?? new InputFile(START_ANIM_PATH),
				{ caption: d.welcome, parse_mode: 'HTML', reply_markup: kb },
			)
			if (msg.animation?.file_id) startAnimFileId = msg.animation.file_id
			return
		} catch {
			/* animatsiya o'tmasa oddiy matn yuboriladi */
		}
	}
	await ctx.reply(d.welcome, { parse_mode: 'HTML', reply_markup: kb })
})

bot.command('lang', async (ctx) => {
	const prefs = ctx.from ? getUserPrefs(ctx.from.id, ctx.from.language_code) : getUserPrefs(0)
	await ctx.reply(t(prefs.lang).chooseLangPrompt, {
		parse_mode: 'HTML',
		reply_markup: languageKeyboard(),
	})
})

bot.command('stop', async (ctx) => {
	if (!ctx.from) return
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const d = t(prefs.lang)
	const stopped = stopUserTask(ctx.from.id)
	await ctx.reply(stopped ? d.stoppedSuccess : d.nothingToStop, { parse_mode: 'HTML' })
})

bot.command('settings', async (ctx) => {
	if (!ctx.from) return
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	await ctx.reply(settingsText(prefs), {
		parse_mode: 'HTML',
		reply_markup: settingsKeyboard(prefs),
	})
})

bot.command('stats', async (ctx) => {
	const s = getStats()
	const prefs = ctx.from ? getUserPrefs(ctx.from.id, ctx.from.language_code) : getUserPrefs(0)
	const d = t(prefs.lang)
	const text = [
		d.statsTitle,
		'',
		d.statsUsers(s.totalUsers, s.activeToday),
		d.statsTotalDownloads(s.totalDownloads),
		d.statsCached(s.cachedFiles),
		d.statsYours(prefs.downloads),
	].join('\n')
	await ctx.reply(text, { parse_mode: 'HTML' })
})

async function handleLink(
	chatId: number,
	userId: number,
	replyTo: number,
	url: string,
	langCode?: string,
): Promise<void> {
	const prefs = getUserPrefs(userId, langCode)
	const d = t(prefs.lang)
	const statusMsg = await bot.api.sendMessage(chatId, d.checkingLink, {
		reply_parameters: { message_id: replyTo, allow_sending_without_reply: true },
	})
	let info: MediaInfo
	try {
		info = await fetchInfo(url, prefs.lang)
	} catch (err) {
		if (!(err instanceof UserError)) console.error('Info xatolik:', err)
		const text = err instanceof UserError ? err.message : d.genericError
		await bot.api.editMessageText(chatId, statusMsg.message_id, text).catch(() => {})
		return
	}
	const job: Job = {
		id: crypto.randomBytes(6).toString('base64url'),
		url,
		info,
		userId,
		chatId,
		messageId: statusMsg.message_id,
		asDocument: prefs.asDocument,
		lang: prefs.lang,
		createdAt: Date.now(),
	}

	if (prefs.autoQuality !== 'ask' && !activeUserControllers.has(userId)) {
		const q = prefs.autoQuality
		await bot.api
			.editMessageText(chatId, statusMsg.message_id, `${d.starting} (${QUALITIES[q]})`)
			.catch(() => {})
		processJob(job, q).catch((e) => console.error('processJob xatolik:', e))
		return
	}

	jobs.set(job.id, job)
	await bot.api.editMessageText(chatId, statusMsg.message_id, infoText(job), {
		parse_mode: 'HTML',
		reply_markup: buildKeyboard(job),
		link_preview_options: { is_disabled: true },
	})
}

bot.on('message:text', async (ctx) => {
	const text = ctx.message.text
	if (text.startsWith('/')) return
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const url = await extractMediaUrl(text)
	if (!url) {
		if (ctx.chat.type === 'private') {
			await ctx.reply(t(prefs.lang).invalidLink, { link_preview_options: { is_disabled: true } })
		}
		return
	}
	handleLink(ctx.chat.id, ctx.from.id, ctx.message.message_id, url, ctx.from.language_code).catch((e) =>
		console.error('handleLink xatolik:', e),
	)
})

// Foydalanuvchi to'g'ridan-to'g'ri video, audio, voice yoki video_note tashlaganda -> Shazam + Karaoke Studiya!
bot.on(['message:video', 'message:audio', 'message:voice', 'message:video_note'], async (ctx) => {
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const d = t(prefs.lang)
	const media =
		ctx.message.video || ctx.message.audio || ctx.message.voice || ctx.message.video_note
	if (!media) return

	if (media.file_size && media.file_size > 20 * 1024 * 1024 && !config.apiRoot) {
		await ctx.reply(d.tooLargeError(20))
		return
	}

	const title =
		(ctx.message.audio && (ctx.message.audio.title || ctx.message.audio.file_name)) ||
		(ctx.message.video && ctx.message.video.file_name) ||
		'Media Audio'
	const artist = (ctx.message.audio && ctx.message.audio.performer) || ''

	const sess = createSession(
		ctx.from.id,
		ctx.chat.id,
		prefs.lang,
		'tg',
		media.file_id,
		title,
		artist,
	)

	// Darhol Shazam qidiruvini boshlaymiz va foydalanuvchiga ham Shazam natijasini, ham Karaoke/Slowed tugmalarini chiqaramiz!
	const statusMsg = await ctx.reply(d.shazamSearching, {
		reply_parameters: { message_id: ctx.message.message_id, allow_sending_without_reply: true },
	})
	runShazamTask(sess, statusMsg.message_id).catch((e) => console.error('media shazam xatolik:', e))
})

// ───────────────────────── Callback Query Handlerlar ─────────────────────────

// /stop inline tugmasi
bot.callbackQuery('stop:now', async (ctx) => {
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const d = t(prefs.lang)
	const stopped = stopUserTask(ctx.from.id)
	await ctx.answerCallbackQuery({
		text: (stopped ? d.stoppedSuccess : d.nothingToStop).replace(/<[^>]+>/g, ''),
		show_alert: true,
	})
})

// Tilni o'zgartirish (lang:uz | lang:ru | lang:en)
bot.callbackQuery(/^lang:(uz|ru|en)$/, async (ctx) => {
	const newLang = ctx.match[1] as Lang
	const prefs = updateUserPrefs(ctx.from.id, { lang: newLang, langSelected: true })
	const d = t(newLang)
	await ctx.answerCallbackQuery({ text: d.langSaved })

	const kb = welcomeKeyboard(prefs)

	if (ctx.callbackQuery.message?.caption !== undefined) {
		await ctx
			.editMessageCaption({ caption: d.welcome, parse_mode: 'HTML', reply_markup: kb })
			.catch(() => {})
	} else {
		await ctx
			.editMessageText(settingsText(prefs), {
				parse_mode: 'HTML',
				reply_markup: settingsKeyboard(prefs),
			})
			.catch(() => {})
	}
})

// Sozlamalar callbacklari
bot.callbackQuery(/^st:(open|lang|doc|q:(\w+))$/, async (ctx) => {
	const action = ctx.match[1]
	const qArg = ctx.match[2] as UserPrefs['autoQuality'] | undefined
	let prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const d = t(prefs.lang)

	if (action === 'lang') {
		await ctx.answerCallbackQuery()
		await ctx.reply(d.chooseLangPrompt, {
			parse_mode: 'HTML',
			reply_markup: languageKeyboard(),
		})
		return
	}
	if (action === 'open') {
		await ctx.answerCallbackQuery()
		await ctx.reply(settingsText(prefs), {
			parse_mode: 'HTML',
			reply_markup: settingsKeyboard(prefs),
		})
		return
	}
	if (action === 'doc') {
		prefs = updateUserPrefs(ctx.from.id, { asDocument: !prefs.asDocument })
		await ctx.answerCallbackQuery({ text: d.docModeToast(prefs.asDocument) })
	} else if (qArg) {
		prefs = updateUserPrefs(ctx.from.id, { autoQuality: qArg })
		await ctx.answerCallbackQuery({ text: `🎯 ${autoQualityLabel(prefs.lang, qArg)}` })
	}
	await ctx
		.editMessageText(settingsText(prefs), {
			parse_mode: 'HTML',
			reply_markup: settingsKeyboard(prefs),
		})
		.catch(() => {})
})

// Shazam tugmasi bosilganda (shz:<sessionId>)
bot.callbackQuery(/^shz:([\w-]+)$/, async (ctx) => {
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const d = t(prefs.lang)
	const sess = sessions.get(ctx.match[1])
	if (!sess) {
		await ctx.answerCallbackQuery({ text: d.expiredRequest, show_alert: true })
		return
	}
	if (activeUserControllers.has(ctx.from.id)) {
		await ctx.answerCallbackQuery({ text: d.alreadyBusy, show_alert: true })
		return
	}
	sess.lang = prefs.lang
	await ctx.answerCallbackQuery({ text: d.shazamSearching })
	const statusMsg = await bot.api.sendMessage(sess.chatId, d.shazamSearching)
	runShazamTask({ ...sess, userId: ctx.from.id }, statusMsg.message_id).catch((e) =>
		console.error('shz callback xatolik:', e),
	)
})

// Audio Studiya menyusini ochish (stu:<sessionId>)
bot.callbackQuery(/^stu:([\w-]+)$/, async (ctx) => {
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const d = t(prefs.lang)
	const sess = sessions.get(ctx.match[1])
	if (!sess) {
		await ctx.answerCallbackQuery({ text: d.expiredRequest, show_alert: true })
		return
	}
	sess.lang = prefs.lang
	await ctx.answerCallbackQuery()
	await bot.api.sendMessage(sess.chatId, `${d.studioTitle}\n\n${d.studioSubtitle}`, {
		parse_mode: 'HTML',
		reply_markup: studioEffectsKeyboard(sess, true),
	})
})

// To'liq qo'shiqni yuklash (full:<sessionId>) yoki Audio effekt qo'llash (fx:<sessionId>:<effect>)
bot.callbackQuery(/^(?:(full):([\w-]+)|fx:([\w-]+):(orig|karaoke|vocal|slowed|speedup|bass|8d))$/, async (ctx) => {
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const d = t(prefs.lang)
	const isFull = ctx.match[1] === 'full'
	const sessId = isFull ? ctx.match[2] : ctx.match[3]
	const mode = (isFull ? 'full' : ctx.match[4]) as 'orig' | 'full' | AudioEffect

	const sess = sessions.get(sessId)
	if (!sess) {
		await ctx.answerCallbackQuery({ text: d.expiredRequest, show_alert: true })
		return
	}
	if (activeUserControllers.has(ctx.from.id)) {
		await ctx.answerCallbackQuery({ text: d.alreadyBusy, show_alert: true })
		return
	}
	sess.lang = prefs.lang
	await ctx.answerCallbackQuery({ text: d.starting })
	const statusMsg = await bot.api.sendMessage(sess.chatId, d.starting)
	runAudioStudioTask({ ...sess, userId: ctx.from.id }, mode, statusMsg.message_id).catch((e) =>
		console.error('fx callback xatolik:', e),
	)
})

// Video ostidagi tezkor MP3 tugmasi
bot.callbackQuery(/^quick:([\w-]+):audio$/, async (ctx) => {
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const d = t(prefs.lang)
	const id = ctx.match[1]
	const baseJob = jobs.get(id)
	if (!baseJob) {
		await ctx.answerCallbackQuery({ text: d.expiredRequest, show_alert: true })
		return
	}
	if (activeUserControllers.has(ctx.from.id)) {
		await ctx.answerCallbackQuery({ text: d.alreadyBusy, show_alert: true })
		return
	}
	await ctx.answerCallbackQuery({ text: d.extractingAudio })
	const statusMsg = await bot.api.sendMessage(baseJob.chatId, d.extractingAudio)
	const audioJob: Job = {
		...baseJob,
		id: crypto.randomBytes(6).toString('base64url'),
		userId: ctx.from.id,
		lang: prefs.lang,
		messageId: statusMsg.message_id,
		asDocument: false,
	}
	processJob(audioJob, 'audio').catch((e) => console.error('quick audio xatolik:', e))
})

bot.callbackQuery(/^(dl|tg|cx):([\w-]+)(?::(\w+))?$/, async (ctx) => {
	const prefs = getUserPrefs(ctx.from.id, ctx.from.language_code)
	const d = t(prefs.lang)
	const [, action, id, q] = ctx.match
	const job = jobs.get(id)
	if (!job) {
		await ctx.answerCallbackQuery({ text: d.expiredRequest, show_alert: true })
		return
	}
	if (ctx.from.id !== job.userId) {
		await ctx.answerCallbackQuery({ text: d.notYourButton })
		return
	}
	job.lang = prefs.lang

	if (action === 'tg') {
		job.asDocument = !job.asDocument
		await ctx.editMessageReplyMarkup({ reply_markup: buildKeyboard(job) }).catch(() => {})
		await ctx.answerCallbackQuery({ text: d.docModeToast(job.asDocument) })
		return
	}

	if (action === 'cx') {
		jobs.delete(id)
		await ctx.answerCallbackQuery({ text: d.cancelledToast })
		await ctx.deleteMessage().catch(() => {})
		return
	}

	const quality = q as Quality
	if (!(quality in QUALITIES)) {
		await ctx.answerCallbackQuery()
		return
	}
	if (activeUserControllers.has(job.userId)) {
		await ctx.answerCallbackQuery({ text: d.alreadyBusy, show_alert: true })
		return
	}
	jobs.delete(id)
	await ctx.answerCallbackQuery({ text: `${d.starting} (${QUALITIES[quality]})` })
	await ctx.editMessageText(d.starting).catch(() => {})
	processJob(job, quality).catch((e) => console.error('processJob xatolik:', e))
})

bot.on('callback_query:data', (ctx) => ctx.answerCallbackQuery())

bot.catch((err) => {
	console.error('Bot xatolik:', err.error)
})

// ───────────────────────── Ishga tushirish ─────────────────────────

async function main() {
	fs.rmSync(config.tmpDir, { recursive: true, force: true })
	fs.mkdirSync(config.tmpDir, { recursive: true })

	ffmpegOk = await ffmpegAvailable()
	if (!ffmpegOk) {
		console.warn(
			"⚠️ ffmpeg topilmadi! Eng yuqori sifat (video+audio birlashtirish), 2K/4K upscale va Audio Studio ishlamaydi.\n" +
				"   Yechim: `npm install` (ffmpeg-static) yoki .env da FFMPEG_PATH ni ko'rsating.",
		)
	}
	if (config.autoUpdateYtdlp) await updateYtDlp()

	console.log(`ℹ️ yt-dlp:  ${config.ytdlpPath}`)
	console.log(`ℹ️ ffmpeg:  ${ffmpegOk ? config.ffmpegPath : "yo'q"}`)
	console.log(`ℹ️ cookies: ${config.cookiesFile ?? "yo'q (yopiq/story kontent uchun kerak bo'lishi mumkin)"}`)
	console.log(`ℹ️ Fayl limiti: ${config.maxUploadMb} MB, parallel vazifalar: ${config.maxConcurrentJobs}`)

	await bot.api
		.setMyCommands([
			{ command: 'start', description: '🚀 Botni ishga tushirish' },
			{ command: 'lang', description: '🌍 Tilni o\'zgartirish' },
			{ command: 'settings', description: '⚙️ Sozlamalar' },
			{ command: 'stop', description: "🛑 Jarayonni to'xtatish" },
			{ command: 'stats', description: '📊 Statistika' },
			{ command: 'help', description: '📖 Yordam' },
		])
		.catch(() => {})
	await bot.api
		.setMyCommands(
			[
				{ command: 'start', description: '🚀 Запустить бота' },
				{ command: 'lang', description: '🌍 Изменить язык' },
				{ command: 'settings', description: '⚙️ Настройки' },
				{ command: 'stop', description: '🛑 Остановить процесс' },
				{ command: 'stats', description: '📊 Статистика' },
				{ command: 'help', description: '📖 Помощь' },
			],
			{ language_code: 'ru' },
		)
		.catch(() => {})
	await bot.api
		.setMyCommands(
			[
				{ command: 'start', description: '🚀 Start bot' },
				{ command: 'lang', description: '🌍 Change language' },
				{ command: 'settings', description: '⚙️ Settings' },
				{ command: 'stop', description: '🛑 Stop active task' },
				{ command: 'stats', description: '📊 Statistics' },
				{ command: 'help', description: '📖 Help' },
			],
			{ language_code: 'en' },
		)
		.catch(() => {})

	// Cloud platformalar (Render, Koyeb, HuggingFace, Railway) uchun Health-Check HTTP server
	const port = Number(process.env.PORT || 0)
	if (port > 0) {
		http
			.createServer((_req, res) => {
				res.writeHead(200, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify({ ok: true, status: 'running', stats: getStats() }))
			})
			.listen(port, '0.0.0.0', () => {
				console.log(`🌐 Health-check server port ${port} da ishga tushdi`)
			})
	}

	const stop = () => bot.stop()
	process.once('SIGINT', stop)
	process.once('SIGTERM', stop)

	await bot.start({
		onStart: (botInfo) => console.log(`✅ @${botInfo.username} (GOD-TIER) muvaffaqiyatli ishga tushdi!`),
	})
}

main().catch((err) => {
	console.error("❌ Botni ishga tushirib bo'lmadi:", err)
	process.exit(1)
})
