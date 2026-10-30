import { spawn, ChildProcess } from 'child_process'

export class CancelledError extends Error {
	constructor() {
		super('Job cancelled by user')
	}
}

export interface RunResult {
	code: number | null
	stdout: string
	stderr: string
}

export interface RunOptions {
	timeoutMs?: number
	/** Har bir yangi qator chiqqanda chaqiriladi (stdout va stderr) */
	onLine?: (line: string) => void
	/** Foydalanuvchi /stop bosganda jarayonni darhol to'xtatish uchun signal */
	signal?: AbortSignal
}

/** Hozirda ishlab turgan barcha bola jarayonlar (global /stop uchun) */
const activeChildren = new Set<ChildProcess>()

export function killAllActiveProcesses(): number {
	let count = 0
	for (const ch of activeChildren) {
		try {
			ch.kill('SIGKILL')
			count++
		} catch {}
	}
	activeChildren.clear()
	return count
}

/** Tashqi dasturni (yt-dlp, ffmpeg) ishga tushirish */
export function run(cmd: string, args: string[], opts: RunOptions = {}): Promise<RunResult> {
	return new Promise((resolve, reject) => {
		if (opts.signal?.aborted) {
			reject(new CancelledError())
			return
		}

		const child = spawn(cmd, args, { windowsHide: true })
		activeChildren.add(child)

		let stdout = ''
		let stderr = ''
		let killedByTimeout = false
		let killedByAbort = false

		const onAbort = () => {
			killedByAbort = true
			try {
				child.kill('SIGKILL')
			} catch {}
		}
		opts.signal?.addEventListener('abort', onAbort, { once: true })

		const timer = opts.timeoutMs
			? setTimeout(() => {
					killedByTimeout = true
					try {
						child.kill('SIGKILL')
					} catch {}
				}, opts.timeoutMs)
			: undefined

		const cleanup = () => {
			activeChildren.delete(child)
			if (timer) clearTimeout(timer)
			opts.signal?.removeEventListener('abort', onAbort)
		}

		const lineSplitter = () => {
			let buf = ''
			return (chunk: string) => {
				if (!opts.onLine) return
				buf += chunk
				const parts = buf.split(/\r?\n|\r/)
				buf = parts.pop() ?? ''
				for (const p of parts) if (p.trim()) opts.onLine(p)
			}
		}
		const outLines = lineSplitter()
		const errLines = lineSplitter()

		child.stdout.setEncoding('utf8')
		child.stderr.setEncoding('utf8')
		child.stdout.on('data', (d: string) => {
			stdout += d
			outLines(d)
		})
		child.stderr.on('data', (d: string) => {
			stderr += d
			errLines(d)
		})
		child.on('error', (err) => {
			cleanup()
			reject(err)
		})
		child.on('close', (code) => {
			cleanup()
			if (killedByAbort) {
				reject(new CancelledError())
				return
			}
			if (killedByTimeout) {
				reject(new Error(`${cmd} vaqt chegarasidan oshdi (timeout)`))
				return
			}
			resolve({ code, stdout, stderr })
		})
	})
}
