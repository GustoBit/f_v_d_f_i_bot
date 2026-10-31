import { config } from './config'
import { run } from './run'

export interface ProbeResult {
	duration: number
	width: number
	height: number
	vcodec: string
	acodec: string | null
}

/** ffmpeg yordamida video parametrlarini aniqlash (ffprobe shart emas) */
export async function probe(file: string): Promise<ProbeResult> {
	const res = await run(config.ffmpegPath, ['-hide_banner', '-i', file], { timeoutMs: 60_000 })
	const out = res.stderr
	const dur = out.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
	const video = out.match(/Stream #\d+:\d+.*?: Video: (\w+).*?, (\d{2,5})x(\d{2,5})/)
	const audio = out.match(/Stream #\d+:\d+.*?: Audio: (\w+)/)
	let width = video ? Number(video[2]) : 0
	let height = video ? Number(video[3]) : 0
	if (/rotation of -?90/.test(out)) [width, height] = [height, width]
	return {
		duration: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0,
		width,
		height,
		vcodec: video ? video[1].toLowerCase() : '',
		acodec: audio ? audio[1].toLowerCase() : null,
	}
}

export async function ffmpegAvailable(): Promise<boolean> {
	try {
		const res = await run(config.ffmpegPath, ['-version'], { timeoutMs: 15_000 })
		return res.code === 0
	} catch {
		return false
	}
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2)

/** Qisqa tomonini `short` ga yetkazadigan o'lchamlarni hisoblash (proporsiya saqlanadi) */
export function scaledSize(width: number, height: number, short: number): { width: number; height: number } {
	if (width >= height) return { width: even((width * short) / height), height: short }
	return { width: short, height: even((height * short) / width) }
}

/**
 * Berilgan hajm chegarasiga sig'ishi uchun maksimal video bitreyti (kbit/s).
 * 7% zaxira + audio bitreyti hisobga olinadi.
 */
export function bitrateBudgetKbps(durationSec: number, maxBytes: number, audioKbps = 192): number {
	if (!durationSec) return Number.POSITIVE_INFINITY
	return Math.floor(((maxBytes * 8) / 1000 / durationSec) * 0.93 - audioKbps)
}

export interface EncodeOptions {
	/** Qisqa tomon o'lchami (masalan 2160 = 4K). Berilmasa o'lcham o'zgarmaydi */
	targetShort?: number
	/** Video bitreyti yuqori chegarasi (kbit/s) — fayl hajmi limitga sig'ishi uchun */
	maxKbps?: number
	/** Sifat: kichikroq = sifatliroq (17-18 deyarli yo'qotishsiz) */
	crf?: number
	/** Upscale paytida yengil keskinlashtirish (sharpen) */
	sharpen?: boolean
	onProgress?: (percent: number) => void
	signal?: AbortSignal
}

/** Videoni H.264 (Telegram uchun eng mos) formatga qayta kodlash, kerak bo'lsa o'lchamini o'zgartirish */
export async function encodeVideo(
	input: string,
	output: string,
	src: ProbeResult,
	opts: EncodeOptions = {},
): Promise<void> {
	const filters: string[] = []
	if (opts.targetShort && src.width && src.height) {
		const { width, height } = scaledSize(src.width, src.height, opts.targetShort)
		// Lanczos — upscale uchun eng sifatli klassik algoritm
		filters.push(`scale=${width}:${height}:flags=lanczos`)
		if (opts.sharpen) filters.push('unsharp=5:5:0.6:5:5:0.0')
	}
	filters.push('format=yuv420p')

	const args = [
		'-hide_banner',
		'-y',
		'-i',
		input,
		'-map',
		'0:v:0',
		'-map',
		'0:a:0?',
		'-vf',
		filters.join(','),
		'-c:v',
		'libx264',
		'-preset',
		config.x264Preset,
		'-threads',
		'2',
		'-crf',
		String(opts.crf ?? 20),
		'-profile:v',
		'high',
	]
	if (opts.maxKbps && Number.isFinite(opts.maxKbps)) {
		args.push('-maxrate', `${opts.maxKbps}k`, '-bufsize', `${opts.maxKbps * 2}k`)
	}
	if (src.acodec === 'aac') args.push('-c:a', 'copy')
	else args.push('-c:a', 'aac', '-b:a', '192k')
	args.push('-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', output)

	const res = await run(config.ffmpegPath, args, {
		timeoutMs: 60 * 60_000,
		signal: opts.signal,
		onLine: (line) => {
			const m = line.match(/^out_time_(?:us|ms)=(\d+)/)
			if (m && src.duration && opts.onProgress) {
				const sec = Number(m[1]) / 1_000_000
				opts.onProgress(Math.min(100, (sec / src.duration) * 100))
			}
		},
	})
	if (res.code !== 0) {
		console.error('[ffmpeg encode]', res.stderr.slice(-2000))
		throw new Error('ffmpeg qayta kodlashda xatolik')
	}
}

/** Telegram uchun kichik muqova rasm (thumbnail, ≤320px JPEG) */
export async function makeThumbnail(input: string, output: string, duration: number): Promise<boolean> {
	const at = duration > 2 ? 1 : 0
	const res = await run(
		config.ffmpegPath,
		[
			'-hide_banner',
			'-y',
			'-ss',
			String(at),
			'-i',
			input,
			'-frames:v',
			'1',
			'-vf',
			'scale=320:320:force_original_aspect_ratio=decrease',
			'-q:v',
			'4',
			output,
		],
		{ timeoutMs: 60_000 },
	).catch(() => null)
	return !!res && res.code === 0
}

/** Videodan MP3 audio ajratib olish */
export async function extractMp3FromMedia(input: string, output: string, signal?: AbortSignal): Promise<void> {
	const res = await run(
		config.ffmpegPath,
		['-hide_banner', '-y', '-i', input, '-vn', '-c:a', 'libmp3lame', '-q:a', '2', output],
		{ timeoutMs: 5 * 60_000, signal },
	)
	if (res.code !== 0) {
		throw new Error('Audio ajratib olishda xatolik')
	}
}

export type AudioEffect = 'karaoke' | 'vocal' | 'slowed' | 'speedup' | 'bass' | '8d'

const AUDIO_EFFECT_FILTERS: Record<AudioEffect, string> = {
	// Karaoke (Minusovka / BGM fon): markazdagi vokalni olib tashlab, stereo musiqani qoldiradi
	karaoke: 'stereotools=mlev=0.015625,volume=1.8',
	// Acapella (Vokalni ajratish): markazdagi ovozni kuchaytirib, yon cholg'ularni pasaytiradi
	vocal: 'stereotools=slev=0.05,highpass=f=120,lowpass=f=10000,volume=1.6',
	// Slowed + Reverb (TikTok/Reels atmosfera foni)
	slowed: 'asetrate=44100*0.84,aresample=44100,aecho=0.8:0.88:60:0.35,bass=g=4',
	// Nightcore / Speed Up
	speedup: 'asetrate=44100*1.2,aresample=44100',
	// Bass Boosted (Kuchli bas)
	bass: 'bass=g=12:f=110:w=0.6,dynaudnorm',
	// 8D Audio (Quloqchinlarda aylanuvchi 3D ovoz)
	'8d': 'apulsator=hz=0.125,aecho=0.8:0.88:40:0.25',
}

/** Audio faylga maxsus studiya effektini (Karaoke/Minusovka, Slowed+Reverb, 8D va h.k.) qo'llash */
export async function applyAudioEffect(
	input: string,
	output: string,
	effect: AudioEffect,
	signal?: AbortSignal,
): Promise<void> {
	const filter = AUDIO_EFFECT_FILTERS[effect]
	const res = await run(
		config.ffmpegPath,
		[
			'-hide_banner',
			'-y',
			'-i',
			input,
			'-vn',
			'-af',
			filter,
			'-c:a',
			'libmp3lame',
			'-q:a',
			'2',
			output,
		],
		{ timeoutMs: 5 * 60_000, signal },
	)
	if (res.code !== 0) {
		console.error('[ffmpeg audio effect]', res.stderr.slice(-1000))
		throw new Error('Audio effekt qo\'llashda xatolik')
	}
}
