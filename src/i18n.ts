import { Quality } from './downloader'
import { AudioEffect } from './ffmpeg'
import { Lang } from './store'

export interface Dict {
	langName: string
	welcome: string
	chooseLangPrompt: string
	langSaved: string
	btnSettings: string
	btnLanguage: string
	btnHelp: string
	btnStats: string
	btnStop: string
	btnCancel: string
	btnBack: string

	// Havola va tahlil
	checkingLink: string
	invalidLink: string
	videoFound: (platform: string) => string
	originalLabel: string
	videosCount: (n: number) => string
	chooseFormat: string
	upscaleHint: string

	// Sifat tugmalari
	qBest: (res?: string) => string
	q720: string
	q480: string
	q2k: string
	q4k: string
	qAudio: string
	qShazam: string
	sendAsDoc: (on: boolean) => string
	docModeToast: (on: boolean) => string

	// Jarayon va navbat
	starting: string
	queued: (pos: number) => string
	downloading: (what: string) => string
	upscaling: (label: string) => string
	converting: string
	compressing: string
	uploading: string
	extractingAudio: string
	applyingEffect: (effName: string) => string
	shazamSearching: string
	downloadingFullSong: string

	// Post-yuklash tugmalari
	btnExtractMp3: string
	btnFindSong: string
	btnOpenPost: string
	btnFullSong: string
	btnStudioEffects: string

	// Audio Studio effekt nomlari
	effectKaraoke: string
	effectVocal: string
	effectSlowed: string
	effectSpeedup: string
	effectBass: string
	effect8d: string
	studioTitle: string
	studioSubtitle: string

	// Shazam natijalari
	shazamFoundTitle: string
	shazamAlbum: string
	shazamYear: string
	shazamNotFound: string
	mediaReceivedPrompt: string

	// /stop va xatolar
	stoppedSuccess: string
	nothingToStop: string
	alreadyBusy: string
	expiredRequest: string
	notYourButton: string
	cancelledToast: string
	tooLargeError: (maxMb: number) => string
	longVideoUpscaleError: (dur: string, label: string, maxMb: number) => string
	genericError: string
	errNoVideo: string
	errFormatUnavailable: string
	errUnsupportedUrl: string
	errPrivateOrRateLimit: string
	errNotFound: string
	errDownloadFailed: string
	errSongDownloadFailed: string
	errNoFfmpeg: string

	// /settings va /stats
	settingsTitle: string
	settingsAutoQuality: string
	settingsDocMode: string
	settingsDownloads: string
	settingsLang: string
	settingsHint: string
	autoAsk: string
	statsTitle: string
	statsUsers: (total: number, today: number) => string
	statsTotalDownloads: (n: number) => string
	statsCached: (n: number) => string
	statsYours: (n: number) => string
}

const uz: Dict = {
	langName: "🇺🇿 O'zbekcha",
	welcome: [
		'👋 <b>Salom! Men GOD-TIER Video Downloader & Shazam Studio botman.</b>',
		'',
		'🔥 <b>Men nimalar qila olaman:</b>',
		'1️⃣ <b>Video yuklash:</b> Instagram (Reels, Post, IGTV, Karusel), TikTok, YouTube Shorts va Pinterest havolalarini <b>1080p, 2K va 4K (upscale)</b> sifatda yuklab beraman.',
		'2️⃣ <b>🔍 Shazam (Qo\'shiqni topish):</b> Menga istalgan <b>video fayl, audio, ovozli xabar (voice) yoki dumaloq video</b> yuboring — ichidagi qo\'shiqni topib, to\'liq MP3 variantini yuklab beraman!',
		'3️⃣ <b>🎛 Audio Studiya (Karaoke / Fon):</b> Har qanday qo\'shiq yoki videoni <b>🎤 Karaoke (Minusovka / Carazerro fon)</b>, <b>🗣 Vokal (Acapella)</b>, <b>🌙 Slowed + Reverb</b>, <b>⚡ Speed Up</b>, <b>🔊 Bass Boost</b> va <b>🎧 8D Audio</b> formatlariga aylantirib beraman!',
		'',
		'⚙️ /settings — Til, Avto-yuklash va sifat sozlamalari',
		'🛑 /stop — Hozirgi yuklash yoki kodlash jarayonini darhol to\'xtatish',
		'🌍 /lang — Tilni o\'zgartirish (🇺🇿 / 🇷🇺 / 🇬🇧)',
		'📊 /stats — Bot statistikasi',
	].join('\n'),
	chooseLangPrompt: '🌍 <b>Tilni tanlang:</b>',
	langSaved: "✅ Til o'zgartirildi: 🇺🇿 O'zbekcha",
	btnSettings: '⚙️ Sozlamalar',
	btnLanguage: '🌍 Til',
	btnHelp: '📖 Yordam',
	btnStats: '📊 Statistika',
	btnStop: "🛑 To'xtatish (/stop)",
	btnCancel: '✖️ Bekor qilish',
	btnBack: '⬅️ Orqaga',

	checkingLink: '🔍 Havola tekshirilmoqda...',
	invalidLink:
		"❌ Iltimos, to'g'ri Instagram, TikTok, YouTube Shorts yoki Pinterest havolasini yuboring (yoki qo'shiqni topish uchun menga to'g'ridan-to'g'ri video/audio fayl tashlang!).",
	videoFound: (p) => `🎞 <b>${p} video topildi</b>`,
	originalLabel: 'Original',
	videosCount: (n) => `🧩 ${n} ta video`,
	chooseFormat: 'Kerakli format yoki amalni tanlang 👇',
	upscaleHint:
		'<i>ℹ️ 2K/4K — videoni Lanczos algoritmi bilan kattalashtirish (upscale) va tiniqlashtirish.</i>',

	qBest: (res) => `🎬 Eng yuqori sifat${res ? ` (${res})` : ''}`,
	q720: '📱 720p',
	q480: '📉 480p',
	q2k: '✨ 2K (upscale)',
	q4k: '🔥 4K (upscale)',
	qAudio: '🎵 Audio (MP3)',
	qShazam: "🔍 Qo'shiqni topish (Shazam)",
	sendAsDoc: (on) => `📁 Fayl sifatida yuborish: ${on ? '✅' : '❌'}`,
	docModeToast: (on) => (on ? '📁 Fayl (document) sifatida yuboriladi' : '🎬 Video sifatida yuboriladi'),

	starting: '⏳ Boshlanmoqda...',
	queued: (pos) => `🕒 Navbatdasiz (${pos}-o'rin). Biroz kuting...`,
	downloading: (what) => `⬇️ Yuklanmoqda (${what})...`,
	upscaling: (label) => `🔥 ${label} ga kattalashtirilmoqda...`,
	converting: '⚙️ Formatga moslanmoqda...',
	compressing: '🗜 Telegram limitiga moslanmoqda...',
	uploading: '📤 Telegramga yuborilmoqda...',
	extractingAudio: '🎵 MP3 audio ajratib olinmoqda...',
	applyingEffect: (eff) => `🎛 Studiya effekti qo'llanmoqda: ${eff}...`,
	shazamSearching: "🔍 Shazam orqali qo'shiq aniqlanmoqda...",
	downloadingFullSong: "⬇️ To'liq qo'shiq (Original MP3) yuklanmoqda...",

	btnExtractMp3: '🎵 MP3 Audio',
	btnFindSong: '🔍 Shazam (Musiqani topish)',
	btnOpenPost: "🔗 Postga o'tish",
	btnFullSong: "💿 To'liq qo'shiqni yuklash (MP3)",
	btnStudioEffects: '🎛 Karaoke / Fon / Effektlar',

	effectKaraoke: '🎤 Karaoke (Minusovka / Fon)',
	effectVocal: '🗣 Faqat Vokal (Acapella)',
	effectSlowed: '🌙 Slowed + Reverb (Fon)',
	effectSpeedup: '⚡ Speed Up (Nightcore)',
	effectBass: '🔊 Bass Boosted',
	effect8d: '🎧 8D Audio (360°)',
	studioTitle: '🎛 <b>Audio Studiya va Fonlar</b>',
	studioSubtitle: "Quyidagi effektlardan birini tanlang — audioni qayta ishlab tayyor MP3 qilib beraman:",

	shazamFoundTitle: "🎉 <b>Qo'shiq topildi! (Shazam)</b>",
	shazamAlbum: '💿 Albom',
	shazamYear: '📅 Yil',
	shazamNotFound:
		"😔 Afsuski, bu videodagi musiqani Shazam aniqlay olmadi (ovoz juda past yoki original nutq bo'lishi mumkin). Lekin pastdagi tugmalar orqali audioni o'zini yoki Karaoke/Slowed fonini olishingiz mumkin:",
	mediaReceivedPrompt: '🎬 <b>Media qabul qilindi!</b> Nima qilamiz?',

	stoppedSuccess: "🛑 <b>Barcha faol jarayonlaringiz darhol to'xtatildi!</b> Yangi havola yoki video yuborishingiz mumkin.",
	nothingToStop: "ℹ️ Hozirda sizda faol yuklash jarayoni yo'q.",
	alreadyBusy: "⏳ Oldingi so'rovingiz hali bajarilmoqda. Kutib turing yoki to'xtatish uchun /stop bosing.",
	expiredRequest: "⌛ Bu so'rov eskirgan. Havolani yoki faylni qaytadan yuboring.",
	notYourButton: '🙅 Bu tugmalar siz uchun emas.',
	cancelledToast: 'Bekor qilindi',
	tooLargeError: (mb) => `⚠️ Fayl Telegram limitidan (${mb} MB) katta. Pastroq sifatni tanlang.`,
	longVideoUpscaleError: (dur, label, mb) =>
		`⚠️ Video juda uzun (${dur}) — ${label} formatda Telegram limitiga (${mb} MB) sig'maydi.\nBoshqa sifatni tanlang yoki .env da BOT_API_ROOT ni sozlang.`,
	genericError: "❌ Kutilmagan xatolik yuz berdi. Qayta urinib ko'ring.",
	errNoVideo: "📷 Bu postda video topilmadi (faqat rasm bo'lishi mumkin).",
	errFormatUnavailable: '❌ Tanlangan sifat mavjud emas. Boshqa variantni tanlang.',
	errUnsupportedUrl: "❌ Bu havola qo'llab-quvvatlanmaydi.",
	errPrivateOrRateLimit:
		"🔒 Kontentni olib bo'lmadi: akkaunt yopiq (private), post o'chirilgan yoki platforma vaqtincha cheklov qo'ydi.",
	errNotFound: "❌ Post topilmadi. Havola to'g'riligini tekshiring.",
	errDownloadFailed: "❌ Videoni yuklab bo'lmadi. Keyinroq qayta urinib ko'ring.",
	errSongDownloadFailed: "❌ To'liq qo'shiqni yuklab bo'lmadi.",
	errNoFfmpeg: "⚠️ Serverda ffmpeg o'rnatilmagan — upscale ishlamaydi.",

	settingsTitle: '⚙️ <b>Shaxsiy sozlamalar</b>',
	settingsAutoQuality: '🎯 <b>Avto-yuklash rejimi:</b>',
	settingsDocMode: '📁 <b>Fayl (document) sifatida:</b>',
	settingsDownloads: '📥 <b>Yuklagan videolaringiz:</b>',
	settingsLang: '🌍 <b>Til:</b>',
	settingsHint:
		"<i>💡 Avto-yuklash rejimida sifatni tanlab qo'ysangiz, link yuborganingizda bot savol bermasdan darhol o'sha sifatda videoni yuboradi!</i>",
	autoAsk: "🎛 Har safar so'rash",
	statsTitle: '📊 <b>Bot statistikasi</b>',
	statsUsers: (total, today) => `👥 Foydalanuvchilar: <b>${total}</b> (bugun faol: <b>${today}</b>)`,
	statsTotalDownloads: (n) => `📥 Jami yuklangan: <b>${n}</b>`,
	statsCached: (n) => `⚡ Keshdagi tayyor fayllar: <b>${n}</b>`,
	statsYours: (n) => `🏆 Siz yuklagan: <b>${n}</b>`,
}

const ru: Dict = {
	langName: '🇷🇺 Русский',
	welcome: [
		'👋 <b>Привет! Я GOD-TIER бот: Video Downloader + Shazam + Audio Studio.</b>',
		'',
		'🔥 <b>Мои возможности:</b>',
		'1️⃣ <b>Скачивание видео:</b> Instagram (Reels, Посты, IGTV, Карусели), TikTok, YouTube Shorts и Pinterest в качестве <b>1080p, 2K и 4K (upscale)</b>.',
		'2️⃣ <b>🔍 Shazam (Распознавание музыки):</b> Отправьте мне <b>любое видео, аудио, голосовое сообщение или кружочек</b> — я найду песню и скачаю полную MP3-версию!',
		'3️⃣ <b>🎛 Аудио-Студия (Караоке / Фон):</b> Превращаю любую песню или звук из видео в <b>🎤 Караоке (Минусовка / Carazerro фон)</b>, <b>🗣 Вокал (Acapella)</b>, <b>🌙 Slowed + Reverb</b>, <b>⚡ Speed Up</b>, <b>🔊 Bass Boost</b> и <b>🎧 8D Audio</b>!',
		'',
		'⚙️ /settings — Настройки языка, авто-загрузки и качества',
		'🛑 /stop — Мгновенно остановить текущую загрузку или обработку',
		'🌍 /lang — Изменить язык (🇺🇿 / 🇷🇺 / 🇬🇧)',
		'📊 /stats — Статистика бота',
	].join('\n'),
	chooseLangPrompt: '🌍 <b>Выберите язык:</b>',
	langSaved: '✅ Язык изменён: 🇷🇺 Русский',
	btnSettings: '⚙️ Настройки',
	btnLanguage: '🌍 Язык',
	btnHelp: '📖 Помощь',
	btnStats: '📊 Статистика',
	btnStop: '🛑 Остановить (/stop)',
	btnCancel: '✖️ Отмена',
	btnBack: '⬅️ Назад',

	checkingLink: '🔍 Проверка ссылки...',
	invalidLink:
		'❌ Пожалуйста, отправьте корректную ссылку на Instagram, TikTok, YouTube Shorts или Pinterest (или отправьте видео/аудио файл, чтобы найти песню через Shazam!).',
	videoFound: (p) => `🎞 <b>Видео из ${p} найдено</b>`,
	originalLabel: 'Оригинал',
	videosCount: (n) => `🧩 ${n} видео`,
	chooseFormat: 'Выберите нужный формат или действие 👇',
	upscaleHint:
		'<i>ℹ️ 2K/4K — увеличение разрешения (upscale) алгоритмом Lanczos и повышение чёткости.</i>',

	qBest: (res) => `🎬 Максимальное качество${res ? ` (${res})` : ''}`,
	q720: '📱 720p',
	q480: '📉 480p',
	q2k: '✨ 2K (upscale)',
	q4k: '🔥 4K (upscale)',
	qAudio: '🎵 Аудио (MP3)',
	qShazam: '🔍 Найти песню (Shazam)',
	sendAsDoc: (on) => `📁 Отправить файлом (без сжатия): ${on ? '✅' : '❌'}`,
	docModeToast: (on) => (on ? '📁 Будет отправлено документом' : '🎬 Будет отправлено как видео'),

	starting: '⏳ Запуск...',
	queued: (pos) => `🕒 Вы в очереди (место: ${pos}). Пожалуйста, подождите...`,
	downloading: (what) => `⬇️ Загрузка (${what})...`,
	upscaling: (label) => `🔥 Масштабирование до ${label}...`,
	converting: '⚙️ Конвертация формата...',
	compressing: '🗜 Сжатие под лимит Telegram...',
	uploading: '📤 Отправка в Telegram...',
	extractingAudio: '🎵 Извлечение MP3 аудио...',
	applyingEffect: (eff) => `🎛 Применение студийного эффекта: ${eff}...`,
	shazamSearching: '🔍 Распознавание трека через Shazam...',
	downloadingFullSong: '⬇️ Скачивание полной песни (Оригинал MP3)...',

	btnExtractMp3: '🎵 MP3 Аудио',
	btnFindSong: '🔍 Shazam (Найти песню)',
	btnOpenPost: '🔗 Открыть пост',
	btnFullSong: '💿 Скачать полную песню (MP3)',
	btnStudioEffects: '🎛 Караоке / Фон / Эффекты',

	effectKaraoke: '🎤 Караоке (Минусовка / Фон)',
	effectVocal: '🗣 Только вокал (Acapella)',
	effectSlowed: '🌙 Slowed + Reverb (Фон)',
	effectSpeedup: '⚡ Speed Up (Nightcore)',
	effectBass: '🔊 Bass Boosted (Бас)',
	effect8d: '🎧 8D Audio (360°)',
	studioTitle: '🎛 <b>Аудио-Студия и Фоны</b>',
	studioSubtitle: 'Выберите эффект ниже — я обработаю звук и пришлю готовый MP3:',

	shazamFoundTitle: '🎉 <b>Песня найдена! (Shazam)</b>',
	shazamAlbum: '💿 Альбом',
	shazamYear: '📅 Год',
	shazamNotFound:
		'😔 К сожалению, Shazam не смог распознать музыку в этом файле (возможно, это оригинальная речь или слишком тихий звук). Но вы можете извлечь аудио или сделать Караоке/Slowed фон:',
	mediaReceivedPrompt: '🎬 <b>Медиафайл получен!</b> Что сделаем?',

	stoppedSuccess: '🛑 <b>Все ваши активные процессы мгновенно остановлены!</b> Можете отправить новую ссылку или видео.',
	nothingToStop: 'ℹ️ У вас сейчас нет активных загрузок.',
	alreadyBusy: '⏳ Ваш предыдущий запрос ещё выполняется. Подождите или нажмите /stop для отмены.',
	expiredRequest: '⌛ Запрос устарел. Отправьте ссылку или файл заново.',
	notYourButton: '🙅 Эти кнопки не для вас.',
	cancelledToast: 'Отменено',
	tooLargeError: (mb) => `⚠️ Файл превышает лимит Telegram (${mb} МБ). Выберите качество ниже.`,
	longVideoUpscaleError: (dur, label, mb) =>
		`⚠️ Видео слишком длинное (${dur}) — в формате ${label} не поместится в лимит Telegram (${mb} МБ).\nВыберите другое качество.`,
	genericError: '❌ Произошла непредвиденная ошибка. Попробуйте ещё раз.',
	errNoVideo: '📷 В этом посте видео не найдено (возможно, там только фото).',
	errFormatUnavailable: '❌ Выбранное качество недоступно. Выберите другой вариант.',
	errUnsupportedUrl: '❌ Эта ссылка не поддерживается.',
	errPrivateOrRateLimit:
		'🔒 Контент недоступен: закрытый аккаунт (private), пост удалён или временное ограничение платформы.',
	errNotFound: '❌ Пост не найден. Проверьте правильность ссылки.',
	errDownloadFailed: '❌ Не удалось скачать видео. Попробуйте позже.',
	errSongDownloadFailed: '❌ Не удалось скачать полную версию песни.',
	errNoFfmpeg: '⚠️ На сервере не установлен ffmpeg — масштабирование недоступно.',

	settingsTitle: '⚙️ <b>Личные настройки</b>',
	settingsAutoQuality: '🎯 <b>Режим авто-загрузки:</b>',
	settingsDocMode: '📁 <b>Отправлять файлом (документом):</b>',
	settingsDownloads: '📥 <b>Скачано вами:</b>',
	settingsLang: '🌍 <b>Язык:</b>',
	settingsHint:
		'<i>💡 Если выбрать качество в режиме авто-загрузки, бот будет сразу скачивать видео при отправке ссылки без лишних вопросов!</i>',
	autoAsk: '🎛 Спрашивать каждый раз',
	statsTitle: '📊 <b>Статистика бота</b>',
	statsUsers: (total, today) => `👥 Пользователей: <b>${total}</b> (активных сегодня: <b>${today}</b>)`,
	statsTotalDownloads: (n) => `📥 Всего загрузок: <b>${n}</b>`,
	statsCached: (n) => `⚡ Готовых файлов в кэше: <b>${n}</b>`,
	statsYours: (n) => `🏆 Ваших загрузок: <b>${n}</b>`,
}

const en: Dict = {
	langName: '🇬🇧 English',
	welcome: [
		'👋 <b>Hello! I am a GOD-TIER Video Downloader, Shazam & Audio Studio Bot.</b>',
		'',
		'🔥 <b>What I can do:</b>',
		'1️⃣ <b>Video Downloader:</b> Download from Instagram (Reels, Posts, IGTV, Carousels), TikTok, YouTube Shorts & Pinterest in <b>1080p, 2K & 4K (upscale)</b>.',
		'2️⃣ <b>🔍 Shazam (Song Finder):</b> Send me <b>any video file, audio, voice message, or video note</b> — I will identify the song and download the full original MP3!',
		'3️⃣ <b>🎛 Audio Studio (Karaoke / BGM):</b> Transform any song or video audio into <b>🎤 Karaoke (Instrumental / Carazerro BGM)</b>, <b>🗣 Vocal Only (Acapella)</b>, <b>🌙 Slowed + Reverb</b>, <b>⚡ Speed Up</b>, <b>🔊 Bass Boosted</b>, and <b>🎧 8D Audio</b>!',
		'',
		'⚙️ /settings — Language, Auto-download & quality preferences',
		'🛑 /stop — Immediately stop your active download or encoding job',
		'🌍 /lang — Switch language (🇺🇿 / 🇷🇺 / 🇬🇧)',
		'📊 /stats — Bot statistics',
	].join('\n'),
	chooseLangPrompt: '🌍 <b>Choose language:</b>',
	langSaved: '✅ Language updated: 🇬🇧 English',
	btnSettings: '⚙️ Settings',
	btnLanguage: '🌍 Language',
	btnHelp: '📖 Help',
	btnStats: '📊 Statistics',
	btnStop: '🛑 Stop (/stop)',
	btnCancel: '✖️ Cancel',
	btnBack: '⬅️ Back',

	checkingLink: '🔍 Checking link...',
	invalidLink:
		'❌ Please send a valid Instagram, TikTok, YouTube Shorts, or Pinterest link (or send a video/audio file directly to recognize the song via Shazam!).',
	videoFound: (p) => `🎞 <b>${p} video found</b>`,
	originalLabel: 'Original',
	videosCount: (n) => `🧩 ${n} videos`,
	chooseFormat: 'Choose a format or action below 👇',
	upscaleHint:
		'<i>ℹ️ 2K/4K uses Lanczos upscaling and sharpening for maximum crispness.</i>',

	qBest: (res) => `🎬 Best Quality${res ? ` (${res})` : ''}`,
	q720: '📱 720p',
	q480: '📉 480p',
	q2k: '✨ 2K (upscale)',
	q4k: '🔥 4K (upscale)',
	qAudio: '🎵 Audio (MP3)',
	qShazam: '🔍 Find Song (Shazam)',
	sendAsDoc: (on) => `📁 Send as file (uncompressed): ${on ? '✅' : '❌'}`,
	docModeToast: (on) => (on ? '📁 Will be sent as a document' : '🎬 Will be sent as a streamable video'),

	starting: '⏳ Starting...',
	queued: (pos) => `🕒 You are in queue (#${pos}). Please wait...`,
	downloading: (what) => `⬇️ Downloading (${what})...`,
	upscaling: (label) => `🔥 Upscaling to ${label}...`,
	converting: '⚙️ Converting format...',
	compressing: '🗜 Fitting into Telegram size limit...',
	uploading: '📤 Uploading to Telegram...',
	extractingAudio: '🎵 Extracting MP3 audio...',
	applyingEffect: (eff) => `🎛 Applying studio effect: ${eff}...`,
	shazamSearching: '🔍 Recognizing song via Shazam...',
	downloadingFullSong: '⬇️ Downloading full song (Original MP3)...',

	btnExtractMp3: '🎵 MP3 Audio',
	btnFindSong: '🔍 Shazam (Find Song)',
	btnOpenPost: '🔗 Open Post',
	btnFullSong: '💿 Download Full Song (MP3)',
	btnStudioEffects: '🎛 Karaoke / BGM / Effects',

	effectKaraoke: '🎤 Karaoke (Instrumental / BGM)',
	effectVocal: '🗣 Vocal Only (Acapella)',
	effectSlowed: '🌙 Slowed + Reverb (Aesthetic)',
	effectSpeedup: '⚡ Speed Up (Nightcore)',
	effectBass: '🔊 Bass Boosted',
	effect8d: '🎧 8D Audio (360°)',
	studioTitle: '🎛 <b>Audio Studio & BGM Maker</b>',
	studioSubtitle: 'Select an effect below — I will process the audio and send you the ready MP3:',

	shazamFoundTitle: '🎉 <b>Song Identified! (Shazam)</b>',
	shazamAlbum: '💿 Album',
	shazamYear: '📅 Year',
	shazamNotFound:
		'😔 Shazam could not identify a song in this media (it may be original speech or too quiet). However, you can still extract the audio or create Karaoke/Slowed BGM below:',
	mediaReceivedPrompt: '🎬 <b>Media received!</b> What would you like to do?',

	stoppedSuccess: '🛑 <b>All your active tasks have been stopped immediately!</b> You can send a new link or file now.',
	nothingToStop: 'ℹ️ You have no active tasks running right now.',
	alreadyBusy: '⏳ Your previous task is still running. Please wait or press /stop to cancel it.',
	expiredRequest: '⌛ This request has expired. Please send the link or file again.',
	notYourButton: '🙅 These buttons are not for you.',
	cancelledToast: 'Cancelled',
	tooLargeError: (mb) => `⚠️ File exceeds Telegram limit (${mb} MB). Please choose a lower quality.`,
	longVideoUpscaleError: (dur, label, mb) =>
		`⚠️ Video is too long (${dur}) — ${label} would exceed the Telegram limit (${mb} MB).\nPlease choose another quality.`,
	genericError: '❌ An unexpected error occurred. Please try again.',
	errNoVideo: '📷 No video found in this post (it might contain only photos).',
	errFormatUnavailable: '❌ The selected quality is not available. Please choose another option.',
	errUnsupportedUrl: '❌ This URL is not supported.',
	errPrivateOrRateLimit:
		'🔒 Content unavailable: private account, deleted post, or temporary platform rate-limit.',
	errNotFound: '❌ Post not found. Please check the link.',
	errDownloadFailed: '❌ Could not download the video. Please try again later.',
	errSongDownloadFailed: '❌ Could not download the full song.',
	errNoFfmpeg: '⚠️ ffmpeg is not installed on the server — upscaling is unavailable.',

	settingsTitle: '⚙️ <b>Personal Settings</b>',
	settingsAutoQuality: '🎯 <b>Auto-download mode:</b>',
	settingsDocMode: '📁 <b>Send as document:</b>',
	settingsDownloads: '📥 <b>Your downloads:</b>',
	settingsLang: '🌍 <b>Language:</b>',
	settingsHint:
		'<i>💡 If you choose a fixed quality in Auto-download mode, the bot will immediately download links in that quality without asking!</i>',
	autoAsk: '🎛 Ask every time',
	statsTitle: '📊 <b>Bot Statistics</b>',
	statsUsers: (total, today) => `👥 Total users: <b>${total}</b> (active today: <b>${today}</b>)`,
	statsTotalDownloads: (n) => `📥 Total downloads: <b>${n}</b>`,
	statsCached: (n) => `⚡ Cached instant files: <b>${n}</b>`,
	statsYours: (n) => `🏆 Your downloads: <b>${n}</b>`,
}

const DICTS: Record<Lang, Dict> = { uz, ru, en }

export function t(lang: Lang): Dict {
	return DICTS[lang] || uz
}

export function effectLabel(lang: Lang, eff: AudioEffect): string {
	const d = t(lang)
	switch (eff) {
		case 'karaoke':
			return d.effectKaraoke
		case 'vocal':
			return d.effectVocal
		case 'slowed':
			return d.effectSlowed
		case 'speedup':
			return d.effectSpeedup
		case 'bass':
			return d.effectBass
		case '8d':
			return d.effect8d
	}
}

export function autoQualityLabel(lang: Lang, q: 'ask' | Quality): string {
	const d = t(lang)
	switch (q) {
		case 'ask':
			return d.autoAsk
		case 'best':
			return d.qBest()
		case 'q720':
			return d.q720
		case 'q480':
			return d.q480
		case 'up1440':
			return d.q2k
		case 'up2160':
			return d.q4k
		case 'audio':
			return d.qAudio
	}
}
