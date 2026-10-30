import fs from 'fs'
import path from 'path'
import { config } from './config'
import { Quality } from './downloader'

export type Lang = 'uz' | 'ru' | 'en'

export interface UserPrefs {
	lang: Lang
	/** Foydalanuvchi tilni o'zi tanlaganmi */
	langSelected?: boolean
	/** 'ask' bo'lsa har safar tugma chiqadi; aks holda tanlangan sifatda darhol yuklaydi */
	autoQuality: 'ask' | Quality
	asDocument: boolean
	downloads: number
	firstSeen: number
	lastSeen: number
}

interface CacheEntry {
	fileId: string
	kind: 'video' | 'audio' | 'document'
	resLabel: string
	sizeBytes: number
	uploader: string
	title: string
	savedAt: number
}

interface StoreData {
	users: Record<string, UserPrefs>
	cache: Record<string, CacheEntry>
	totalDownloads: number
}

const DATA_DIR = path.join(config.rootDir, 'data')
const STORE_FILE = path.join(DATA_DIR, 'store.json')

function loadStore(): StoreData {
	try {
		if (fs.existsSync(STORE_FILE)) {
			const raw = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8'))
			return {
				users: raw.users ?? {},
				cache: raw.cache ?? {},
				totalDownloads: Number(raw.totalDownloads ?? 0),
			}
		}
	} catch (e) {
		console.warn('⚠️ store.json o\'qishda xatolik:', (e as Error).message)
	}
	return { users: {}, cache: {}, totalDownloads: 0 }
}

const state: StoreData = loadStore()
let saveTimer: NodeJS.Timeout | undefined

function scheduleSave(): void {
	if (saveTimer) return
	saveTimer = setTimeout(() => {
		saveTimer = undefined
		try {
			fs.mkdirSync(DATA_DIR, { recursive: true })
			fs.writeFileSync(STORE_FILE, JSON.stringify(state, null, 2), 'utf8')
		} catch (e) {
			console.warn('⚠️ store.json saqlashda xatolik:', (e as Error).message)
		}
	}, 1500)
	saveTimer.unref()
}

export function getUserPrefs(userId: number, tgLangCode?: string): UserPrefs {
	const key = String(userId)
	let prefs = state.users[key]
	if (!prefs) {
		const code = (tgLangCode || '').toLowerCase()
		const lang: Lang = code.startsWith('ru') ? 'ru' : code.startsWith('en') ? 'en' : 'uz'
		prefs = {
			lang,
			autoQuality: 'ask',
			asDocument: false,
			downloads: 0,
			firstSeen: Date.now(),
			lastSeen: Date.now(),
		}
		state.users[key] = prefs
		scheduleSave()
	} else {
		prefs.lastSeen = Date.now()
	}
	return prefs
}

export function updateUserPrefs(userId: number, patch: Partial<UserPrefs>): UserPrefs {
	const prefs = getUserPrefs(userId)
	Object.assign(prefs, patch, { lastSeen: Date.now() })
	scheduleSave()
	return prefs
}

export function recordDownload(userId: number): void {
	const prefs = getUserPrefs(userId)
	prefs.downloads = (prefs.downloads || 0) + 1
	state.totalDownloads = (state.totalDownloads || 0) + 1
	scheduleSave()
}

function cacheKey(url: string, quality: Quality, asDocument: boolean, index: number): string {
	return `${url}|${quality}|${asDocument ? 'doc' : 'media'}|${index}`
}

export function getCachedMedia(
	url: string,
	quality: Quality,
	asDocument: boolean,
	index = 0,
): CacheEntry | undefined {
	return state.cache[cacheKey(url, quality, asDocument, index)]
}

export function setCachedMedia(
	url: string,
	quality: Quality,
	asDocument: boolean,
	index: number,
	entry: Omit<CacheEntry, 'savedAt'>,
): void {
	// Kesh juda kattalashib ketmasligi uchun eng eski yozuvlarni tozalaymiz (max 2000 ta)
	const keys = Object.keys(state.cache)
	if (keys.length > 2000) {
		const sorted = keys.sort((a, b) => (state.cache[a]?.savedAt ?? 0) - (state.cache[b]?.savedAt ?? 0))
		for (const k of sorted.slice(0, 300)) delete state.cache[k]
	}
	state.cache[cacheKey(url, quality, asDocument, index)] = {
		...entry,
		savedAt: Date.now(),
	}
	scheduleSave()
}

export function getStats() {
	const users = Object.values(state.users)
	const dayAgo = Date.now() - 24 * 3600_000
	return {
		totalUsers: users.length,
		activeToday: users.filter((u) => u.lastSeen >= dayAgo).length,
		totalDownloads: state.totalDownloads,
		cachedFiles: Object.keys(state.cache).length,
	}
}
