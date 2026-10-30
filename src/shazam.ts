import { spawn } from 'child_process'
import { config } from './config'

export interface ShazamTrack {
	title: string
	artist: string
	album?: string
	year?: string
	coverUrl?: string
	shazamUrl?: string
	appleMusicUrl?: string
	isrc?: string
}

// ─────────────────── Pure-JS Shazam Signature Generator ───────────────────

class ComplexNumber {
	constructor(
		public real: number,
		public imag: number,
	) {}
	static add(a: ComplexNumber, b: ComplexNumber): ComplexNumber {
		return new ComplexNumber(a.real + b.real, a.imag + b.imag)
	}
	static subtract(a: ComplexNumber, b: ComplexNumber): ComplexNumber {
		return new ComplexNumber(a.real - b.real, a.imag - b.imag)
	}
	static multiply(a: ComplexNumber, b: ComplexNumber): ComplexNumber {
		return new ComplexNumber(a.real * b.real - a.imag * b.imag, a.real * b.imag + a.imag * b.real)
	}
}

function fft(input: ComplexNumber[]): ComplexNumber[] {
	const N = input.length
	if (N <= 1) return input
	const even = fft(input.filter((_, idx) => idx % 2 === 0))
	const odd = fft(input.filter((_, idx) => idx % 2 === 1))
	const result = new Array<ComplexNumber>(N)
	for (let k = 0; k < N / 2; k++) {
		const angle = (-2 * Math.PI * k) / N
		const twiddle = new ComplexNumber(Math.cos(angle), Math.sin(angle))
		const t = ComplexNumber.multiply(twiddle, odd[k])
		result[k] = ComplexNumber.add(even[k], t)
		result[k + N / 2] = ComplexNumber.subtract(even[k], t)
	}
	return result
}

const HANNING_MATRIX = Array.from({ length: 2050 }, (_, n) => 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / 2049)).slice(
	1,
	2049,
)

const pyMod = (a: number, b: number) => (a % b >= 0 ? a % b : b + (a % b))

function crc32(bytes: number[]): number {
	let c = 0 ^ -1
	for (let i = 0; i < bytes.length; i++) {
		let v = (c ^ bytes[i]) & 0xff
		for (let k = 0; k < 8; k++) {
			v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1
		}
		c = (c >>> 8) ^ v
	}
	return (c ^ -1) >>> 0
}

const writeUint32 = (e: number) => [e & 0xff, (e >> 8) & 0xff, (e >> 16) & 0xff, (e >> 24) & 0xff]
const writeInt32 = (e: number) => {
	const q = new DataView(new ArrayBuffer(4), 0)
	q.setInt32(0, e, true)
	return Array.from(new Uint8Array(q.buffer))
}
const writeInt16 = (e: number) => {
	const q = new DataView(new ArrayBuffer(2), 0)
	q.setInt16(0, e, true)
	return Array.from(new Uint8Array(q.buffer))
}

interface Peak {
	fftPassNumber: number
	peakMagnitude: number
	correctedPeakFrequencyBin: number
}

class RingBuffer<T> {
	public list: T[]
	public position = 0
	public written = 0
	constructor(
		public bufferSize: number,
		defaultValue: (() => T) | T,
	) {
		this.list =
			typeof defaultValue === 'function'
				? Array.from({ length: bufferSize }, () => (defaultValue as () => T)())
				: new Array<T>(bufferSize).fill(defaultValue)
	}
	append(val: T) {
		this.list[this.position] = val
		this.position = (this.position + 1) % this.bufferSize
		this.written++
	}
}

function encodeSignature(sampleRateHz: number, numberSamples: number, bands: Record<number, Peak[]>): string {
	let contentsBuf: number[] = []
	const sortedBands = Object.keys(bands)
		.map(Number)
		.sort((a, b) => a - b)

	for (const band of sortedBands) {
		const peaks = bands[band]
		const peaksBuffer: number[] = []
		let fftPassNumber = 0
		for (const p of peaks) {
			if (p.fftPassNumber - fftPassNumber >= 0xff) {
				peaksBuffer.push(0xff, ...writeInt32(p.fftPassNumber))
				fftPassNumber = p.fftPassNumber
			}
			peaksBuffer.push(
				p.fftPassNumber - fftPassNumber,
				...writeInt16(p.peakMagnitude - 1),
				...writeInt16(p.correctedPeakFrequencyBin - 1),
			)
			fftPassNumber = p.fftPassNumber
		}
		contentsBuf.push(...writeInt32(0x60030040 + band), ...writeInt32(peaksBuffer.length), ...peaksBuffer)
		const pad = (4 - (peaksBuffer.length % 4)) % 4
		for (let i = 0; i < pad; i++) contentsBuf.push(0)
	}

	const sizeMinusHeader = contentsBuf.length + 8
	const makeHeader = (crc: number) => {
		const b: number[] = []
		const w = (x: number) => b.push(...writeUint32(x))
		w(0xcafe2580)
		w(crc)
		w(sizeMinusHeader)
		w(0x94119c00)
		w(0)
		w(0)
		w(0)
		w(3 << 27) // _16000
		w(0)
		w(0)
		w(Math.round(numberSamples + sampleRateHz * 0.24))
		w((15 << 19) + 0x40000)
		return b
	}

	const buf = [...makeHeader(-1), ...writeInt32(0x40000000), ...writeInt32(sizeMinusHeader), ...contentsBuf]
	const crc = crc32(buf.slice(8))
	const realHeader = makeHeader(crc)
	buf.splice(0, realHeader.length, ...realHeader)
	return 'data:audio/vnd.shazam.sig;base64,' + Buffer.from(buf).toString('base64')
}

function buildSignatureFromPcm(samples: Int16Array): { uri: string; samplems: number } {
	const ringSamples = new RingBuffer<number>(2048, 0)
	const fftOutputs = new RingBuffer<Float64Array>(256, () => new Float64Array(1025))
	const spreadOutputs = new RingBuffer<Float64Array>(256, () => new Float64Array(1025))
	const bands: Record<number, Peak[]> = {}

	for (let pos = 0; pos + 128 <= samples.length; pos += 128) {
		for (let i = 0; i < 128; i++) {
			ringSamples.list[(ringSamples.position + i) % 2048] = samples[pos + i]
		}
		ringSamples.position = (ringSamples.position + 128) % 2048
		ringSamples.written += 128

		const cplx = new Array<ComplexNumber>(2048)
		for (let i = 0; i < 2048; i++) {
			const s = ringSamples.list[(ringSamples.position + i) % 2048]
			cplx[i] = new ComplexNumber(s * HANNING_MATRIX[i], 0)
		}
		const fftRes = fft(cplx)
		const mag = new Float64Array(1025)
		for (let i = 0; i < 1025; i++) {
			const e = (fftRes[i].imag * fftRes[i].imag + fftRes[i].real * fftRes[i].real) / (1 << 17)
			mag[i] = e < 1e-10 ? 1e-10 : e
		}
		fftOutputs.append(mag)

		// Peak spreading
		const spread = new Float64Array(mag)
		for (let p = 0; p < 1025; p++) {
			if (p < 1023) {
				spread[p] = Math.max(spread[p], spread[p + 1], spread[p + 2])
			}
			let maxVal = spread[p]
			for (const off of [-1, -3, -6]) {
				const former = spreadOutputs.list[pyMod(spreadOutputs.position + off, spreadOutputs.bufferSize)]
				former[p] = maxVal = Math.max(former[p], maxVal)
			}
		}
		spreadOutputs.append(spread)

		if (spreadOutputs.written >= 46) {
			const fftMinus46 = fftOutputs.list[pyMod(fftOutputs.position - 46, fftOutputs.bufferSize)]
			const fftMinus49 = spreadOutputs.list[pyMod(spreadOutputs.position - 49, spreadOutputs.bufferSize)]
			const neighborOffsets = [-10, -7, -4, -3, 1, 2, 5, 8]
			const timeOffsets = [-53, -45, 165, 172, 179, 186, 193, 200, 214, 221, 228, 235, 242, 249]

			for (let bin = 10; bin < 1015; bin++) {
				if (fftMinus46[bin] >= 1 / 64 && fftMinus46[bin] >= fftMinus49[bin - 1]) {
					let maxNeighbor = 0
					for (const no of neighborOffsets) {
						maxNeighbor = Math.max(maxNeighbor, fftMinus49[bin + no] || 0)
					}
					if (fftMinus46[bin] > maxNeighbor) {
						let maxOther = maxNeighbor
						for (const to of timeOffsets) {
							const cand = spreadOutputs.list[pyMod(spreadOutputs.position + to, spreadOutputs.bufferSize)][bin - 1]
							maxOther = Math.max(maxOther, cand || 0)
						}
						if (fftMinus46[bin] > maxOther) {
							const fftNum = spreadOutputs.written - 46
							const pm = Math.log(Math.max(1 / 64, fftMinus46[bin])) * 1477.3 + 6144
							const pmBefore = Math.log(Math.max(1 / 64, fftMinus46[bin - 1])) * 1477.3 + 6144
							const pmAfter = Math.log(Math.max(1 / 64, fftMinus46[bin + 1])) * 1477.3 + 6144
							const var1 = pm * 2 - pmBefore - pmAfter
							const var2 = ((pmAfter - pmBefore) * 32) / var1
							const correctedBin = bin * 64 + var2
							const freqHz = correctedBin * (16000 / 2 / 1024 / 64)
							let band = -99
							if (freqHz >= 250 && freqHz <= 520) band = 0
							else if (freqHz > 520 && freqHz <= 1450) band = 1
							else if (freqHz > 1450 && freqHz <= 3500) band = 2
							else if (freqHz > 3500 && freqHz <= 5500) band = 3
							if (band >= 0) {
								;(bands[band] ||= []).push({
									fftPassNumber: fftNum,
									peakMagnitude: Math.round(pm),
									correctedPeakFrequencyBin: Math.round(correctedBin),
								})
							}
						}
					}
				}
			}
		}
	}

	return {
		uri: encodeSignature(16000, samples.length, bands),
		samplems: Math.round((samples.length / 16000) * 1000),
	}
}

function extractPcmSegment(mediaPath: string, startSec: number, durationSec: number): Promise<Int16Array> {
	return new Promise((resolve, reject) => {
		const args = [
			'-hide_banner',
			'-loglevel',
			'error',
			'-ss',
			String(startSec),
			'-t',
			String(durationSec),
			'-i',
			mediaPath,
			'-vn',
			'-ac',
			'1',
			'-ar',
			'16000',
			'-f',
			's16le',
			'pipe:1',
		]
		const child = spawn(config.ffmpegPath, args, { windowsHide: true })
		const chunks: Buffer[] = []
		child.stdout.on('data', (c: Buffer) => chunks.push(c))
		child.on('error', reject)
		child.on('close', (code) => {
			if (code !== 0 && chunks.length === 0) {
				reject(new Error('ffmpeg audio extract failed'))
				return
			}
			const buf = Buffer.concat(chunks)
			resolve(new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2)))
		})
	})
}

function uuid(): string {
	return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
		.replace(/[xy]/g, (c) => {
			const r = (Math.random() * 16) | 0
			return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
		})
		.toUpperCase()
}

async function queryShazam(sig: { uri: string; samplems: number }): Promise<ShazamTrack | null> {
	const url = `https://amp.shazam.com/discovery/v5/en/US/iphone/-/tag/${uuid()}/${uuid()}?sync=true&webv3=true&sampling=true&connected=&shazamapiversion=v3&sharehub=true&hubv5minorversion=v5.1&hidelb=true&video=v3`
	const body = JSON.stringify({
		timezone: 'Europe/Paris',
		signature: sig,
		timestamp: Date.now(),
		context: {},
		geolocation: {},
	})
	const res = await fetch(url, {
		method: 'POST',
		headers: {
			'X-Shazam-Platform': 'IPHONE',
			'X-Shazam-AppVersion': '14.1.0',
			Accept: '*/*',
			'Content-Type': 'application/json',
			'Accept-Language': 'en',
			'User-Agent': 'Dalvik/2.1.0 (Linux; U; Android 6.0.1; SM-G920F Build/MMB29K)',
		},
		body,
		signal: AbortSignal.timeout(15_000),
	})
	if (!res.ok) return null
	const data = (await res.json()) as any
	const track = data?.track
	if (!track?.title) return null

	const songSec = (track.sections || []).find((s: any) => s.type === 'SONG')
	const meta: { title?: string; text?: string }[] = songSec?.metadata || []
	const album = meta.find((m) => m.title === 'Album')?.text
	const year = meta.find((m) => m.title === 'Released')?.text

	return {
		title: String(track.title),
		artist: String(track.subtitle || ''),
		album,
		year,
		coverUrl: track.images?.coverarthq || track.images?.coverart || undefined,
		shazamUrl: track.share?.href || track.url || undefined,
		isrc: track.isrc || undefined,
	}
}

/**
 * Har qanday video, audio yoki ovozli xabardan musiqani Shazam orqali aniqlash.
 * Birinchi urinishda topilmasa, videoning o'rtasidan (5-soniyadan) qayta tekshiradi.
 */
export async function recognizeMusicFromFile(mediaPath: string): Promise<ShazamTrack | null> {
	for (const offset of [0, 6, 15]) {
		try {
			const samples = await extractPcmSegment(mediaPath, offset, 10)
			if (samples.length < 16000 * 2) continue
			const sig = buildSignatureFromPcm(samples)
			const match = await queryShazam(sig)
			if (match) return match
		} catch {
			// keyingi offsetni sinab ko'ramiz
		}
	}
	return null
}
