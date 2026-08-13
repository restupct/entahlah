/* Utilitas bersama: koneksi WebSocket auto-reconnect + render kode. */

export function connect({ onMessage, onStatus }) {
	const proto = location.protocol === 'https:' ? 'wss' : 'ws'
	const url = proto + '://' + location.host
	let sock = null
	let queue = []
	let tries = 0
	let closedByUs = false

	function open() {
		onStatus?.('connecting')
		sock = new WebSocket(url)

		sock.onopen = () => {
			tries = 0
			onStatus?.('online')
			const q = queue
			queue = []
			q.forEach((m) => sock.send(m))
		}
		sock.onmessage = (e) => {
			let msg
			try {
				msg = JSON.parse(e.data)
			} catch {
				return
			}
			onMessage(msg)
		}
		sock.onclose = () => {
			if (closedByUs) return
			onStatus?.('offline')
			// WiFi sekolah suka putus - coba sambung lagi dengan backoff
			const wait = Math.min(1000 * 2 ** tries++, 8000)
			setTimeout(open, wait)
		}
		sock.onerror = () => sock.close()
	}

	open()

	return {
		send(obj) {
			const raw = JSON.stringify(obj)
			if (sock && sock.readyState === WebSocket.OPEN) sock.send(raw)
			else queue.push(raw)
		},
		close() {
			closedByUs = true
			sock?.close()
		},
	}
}

const KEYWORDS =
	/\b(let|const|var|if|else|switch|case|default|break|return|function|console|log|true|false|null|undefined|typeof)\b/g

export function escapeHtml(s) {
	return String(s)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
}

function highlightJs(escaped) {
	return escaped
		.replace(/(&#39;|')([^'\n]*)\1/g, '<span class="s">$1$2$1</span>')
		.replace(/\/\/[^\n]*/g, '<span class="c">$&</span>')
		.replace(KEYWORDS, '<span class="k">$&</span>')
		.replace(/\b(\d+)\b/g, '<span class="n">$1</span>')
}

// Urutan penting: komentar dulu, lalu atribut, baru nama tag - supaya regex
// nama tag tidak ikut mewarnai markup <span> yang baru saja kita sisipkan
// sendiri (mis. class="n" pada span atribut).
const HTML_COMMENT = /&lt;!--[\s\S]*?--&gt;/g
const HTML_ATTR = /(\s)([a-zA-Z-:]+)(=)("[^"]*"|'[^']*')/g
const HTML_TAG = /(&lt;\/?)([a-zA-Z][\w-]*)/g

function highlightHtml(escaped) {
	return escaped
		.replace(HTML_COMMENT, (m) => '<span class="c">' + m + '</span>')
		.replace(
			HTML_ATTR,
			(m, sp, name, eq, val) =>
				sp +
				'<span class="n">' +
				name +
				'</span>' +
				eq +
				'<span class="s">' +
				val +
				'</span>',
		)
		.replace(HTML_TAG, (m, open, name) => open + '<span class="k">' + name + '</span>')
}

/**
 * Pewarnaan sintaks sederhana - cukup untuk potongan kode pendek.
 * `lang` memilih tokenizer: 'js' (default, dipakai semua soal lama) atau
 * 'html'. Bahasa lain yang belum dikenal akan tampil polos tanpa warna,
 * bukan error - aman untuk dikembangkan lagi nanti (mis. 'sql').
 */
export function highlight(code, lang = 'js') {
	const escaped = escapeHtml(code)
	return lang === 'html' ? highlightHtml(escaped) : highlightJs(escaped)
}

export const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

export function el(id) {
	return document.getElementById(id)
}

/**
 * Render tombol pilihan jawaban. Dipakai bareng oleh host.html (tampilan
 * saja, tidak bisa diklik) dan play.html (bisa diklik) supaya markup dan
 * class-nya seragam - dulu masing-masing file punya template map() sendiri.
 */
export function optionButtonsHtml(options, { tag = 'div', selectable = false } = {}) {
	return options
		.map(
			(o, i) =>
				'<' +
				tag +
				' class="opt" data-i="' +
				i +
				'"' +
				(selectable ? '' : ' tabindex="-1"') +
				'><span class="key">' +
				LETTERS[i] +
				'</span><span class="txt">' +
				escapeHtml(o) +
				'</span></' +
				tag +
				'>',
		)
		.join('')
}

/**
 * Render daftar baris papan skor. Dipakai oleh host.html (roster + papan
 * skor) dan play.html (papan skor akhir), dengan opsi menyorot satu pid
 * (mis. skor milik peserta yang sedang lihat). Pemain dengan 3+ jawaban
 * benar beruntun mendapat tanda api di samping namanya - bikin kelas
 * heboh saat ada yang "on fire".
 */
export function leaderboardRowsHtml(list, { highlightPid = null, showTeam = false } = {}) {
	if (!list.length) return '<p class="muted m-0 text-small">Belum ada peserta.</p>'
	return list
		.map((p) => {
			const top = p.pid === highlightPid || p.rank === 1
			const offline = p.online === false
			return (
				'<div class="lb-row' +
				(top ? ' top' : '') +
				(offline ? ' off' : '') +
				'"><span class="lb-rank">' +
				p.rank +
				'</span><span class="lb-name">' +
				escapeHtml(p.name) +
				(p.streak >= 3 ? ' 🔥' : '') +
				(showTeam && p.team ? ' <span class="muted">&middot; Tim ' + p.team + '</span>' : '') +
				(offline ? ' <span class="muted">(offline)</span>' : '') +
				'</span><span class="lb-score">' +
				p.score +
				'</span></div>'
			)
		})
		.join('')
}

/**
 * Render ringkasan skor tim - sekarang generik untuk berapa pun jumlah tim
 * (dulu selalu tepat 2, hardcode Tim A vs Tim B).
 * - `highlightTeam`: tandai tim itu sebagai "punya kamu" - dipakai play.html
 *   supaya siswa langsung tahu tim mana dirinya, tidak cuma angka polos.
 * - `final`: kalau true, tambah baris "Tim X menang!"/"Seri!" di bawah -
 *   dipakai untuk hasil akhir (host & play), TIDAK dipakai untuk papan skor
 *   tim yang masih berjalan supaya tidak menyiratkan game sudah selesai.
 * Tim yang unggul selalu ditandai mahkota, baik saat masih berjalan
 * ("sementara unggul") maupun di hasil akhir. Untuk tepat 2 tim, tampilan
 * "A vs B" klasik dipertahankan. Untuk 3+ tim, ditampilkan sebagai papan
 * peringkat mini (tim skor tertinggi di atas) supaya tetap mudah dibaca.
 */
export function teamsSummaryHtml(teams, { highlightTeam = null, final = false } = {}) {
	if (!teams) return ''
	const entries = Object.entries(teams)
	if (entries.length < 2) return ''
	const max = Math.max(...entries.map(([, s]) => s))
	const allTie = entries.every(([, s]) => s === max)
	const leaders = allTie ? [] : entries.filter(([, s]) => s === max).map(([n]) => n)

	function teamLabel(name, mine) {
		return (
			'Tim ' +
			name +
			(leaders.includes(name) ? ' \u{1F451}' : '') +
			(mine ? ' <span class="muted">(kamu)</span>' : '')
		)
	}

	let body
	if (entries.length === 2) {
		const [[nameA, scoreA], [nameB, scoreB]] = entries
		function col(name, score) {
			const mine = highlightTeam === name
			return (
				'<div class="team-col' +
				(mine ? ' is-mine' : '') +
				(name === nameB ? ' text-right' : '') +
				'"><div class="label m-0">' +
				teamLabel(name, mine) +
				'</div><div class="lb-score text-2xl">' +
				score +
				'</div></div>'
			)
		}
		body =
			'<div class="card row between">' +
			col(nameA, scoreA) +
			'<span class="muted">vs</span>' +
			col(nameB, scoreB) +
			'</div>'
	} else {
		const ranked = entries.slice().sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
		// PENTING: .lb-row di app.css adalah grid 3 kolom (32px 1fr auto =
		// rank | nama | skor), jadi sel rank WAJIB dirender. Tanpa sel pertama
		// ini, nama tim jatuh ke kolom sempit 32px dan kepotong jadi "T..."
		// karena .lb-name memakai text-overflow: ellipsis - inilah bug
		// "Tim A tampil sebagai T... padahal ruang masih lega". Bonusnya,
		// papan peringkat mini ini sekarang juga menampilkan nomor peringkat,
		// konsisten dengan leaderboard peserta.
		body =
			'<div class="card lb">' +
			ranked
				.map(([name, score], i) => {
					const mine = highlightTeam === name
					return (
						'<div class="lb-row' +
						(mine ? ' top' : '') +
						'"><span class="lb-rank">' +
						(i + 1) +
						'</span><span class="lb-name">' +
						teamLabel(name, mine) +
						'</span><span class="lb-score">' +
						score +
						'</span></div>'
					)
				})
				.join('') +
			'</div>'
	}

	let finalLine = ''
	if (final) {
		const msg = allTie
			? 'Seri!'
			: leaders.length > 1
				? 'Tim ' + leaders.join(' & ') + ' seri di posisi puncak!'
				: 'Tim ' + leaders[0] + ' menang!'
		finalLine = '<p class="text-center muted text-small mt-1 m-0">' + msg + '</p>'
	}
	return body + finalLine
}

/* ===== Efek suara via Web Audio API - tanpa file audio sama sekali =====
 * File mp3 di public/sounds/ tetap dipakai play.html untuk reveal benar/
 * salah; modul ini melengkapi dengan bunyi yang tidak butuh file: tick
 * countdown 5 detik terakhir, jingle reveal, dan fanfare hasil akhir.
 * Semuanya di-synthesize dari oscillator, jadi tetap 100% jalan offline
 * di WiFi lokal. AudioContext baru boleh berbunyi setelah ada gesture
 * pengguna (kebijakan browser) - makanya unlockSfx() dipanggil dari
 * interaksi pertama (klik/tombol) di tiap halaman. */
let _actx = null

export function unlockSfx() {
	try {
		if (!_actx) _actx = new (window.AudioContext || window.webkitAudioContext)()
		if (_actx.state === 'suspended') _actx.resume()
	} catch {}
}

function beep(freq, startAt, dur, { type = 'square', vol = 0.08 } = {}) {
	if (!_actx) return
	try {
		const osc = _actx.createOscillator()
		const gain = _actx.createGain()
		osc.type = type
		osc.frequency.value = freq
		const t0 = _actx.currentTime + startAt
		gain.gain.setValueAtTime(vol, t0)
		gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
		osc.connect(gain).connect(_actx.destination)
		osc.start(t0)
		osc.stop(t0 + dur)
	} catch {}
}

/** Bunyi "tuk" singkat - dipanggil sekali per detik di 5 detik terakhir timer. */
export function sfxTick() {
	beep(880, 0, 0.07)
}

/** Jingle dua nada saat jawaban dibuka. */
export function sfxReveal() {
	beep(523, 0, 0.12)
	beep(784, 0.1, 0.18)
}

/** Fanfare kecil (arpeggio naik) untuk layar hasil akhir. */
export function sfxFanfare() {
	beep(523, 0, 0.14)
	beep(659, 0.14, 0.14)
	beep(784, 0.28, 0.14)
	beep(1047, 0.42, 0.3, { vol: 0.1 })
}

/**
 * Hujan confetti satu kali - canvas fullscreen vanilla (tanpa library,
 * tetap offline), membersihkan dirinya sendiri setelah ~2.6 detik.
 * `big = true` untuk momen besar (hasil akhir / podium): lebih banyak
 * partikel dan jatuh lebih lama.
 */
export function confettiBurst(big = false) {
	try {
		const cv = document.createElement('canvas')
		const ctx = cv.getContext('2d')
		if (!ctx) return
		cv.style.cssText =
			'position:fixed;inset:0;width:100vw;height:100vh;pointer-events:none;z-index:999'
		cv.width = window.innerWidth
		cv.height = window.innerHeight
		document.body.appendChild(cv)
		const colors = ['#2783de', '#46a171', '#d5803b', '#e56458', '#f4bf4f', '#a78bfa']
		const parts = Array.from({ length: big ? 220 : 120 }, () => ({
			x: Math.random() * cv.width,
			y: -20 - Math.random() * cv.height * 0.4,
			w: 6 + Math.random() * 6,
			h: 8 + Math.random() * 8,
			vy: 2 + Math.random() * 3,
			vx: -1.5 + Math.random() * 3,
			rot: Math.random() * Math.PI,
			vr: -0.1 + Math.random() * 0.2,
			color: colors[(Math.random() * colors.length) | 0],
		}))
		const t0 = performance.now()
		;(function frame(t) {
			ctx.clearRect(0, 0, cv.width, cv.height)
			for (const p of parts) {
				p.x += p.vx
				p.y += p.vy
				p.rot += p.vr
				ctx.save()
				ctx.translate(p.x, p.y)
				ctx.rotate(p.rot)
				ctx.fillStyle = p.color
				ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h)
				ctx.restore()
			}
			if (t - t0 < (big ? 3400 : 2600)) requestAnimationFrame(frame)
			else cv.remove()
		})(t0)
	} catch {}
}

/** Countdown berbasis waktu asli (bukan hitungan tick) supaya tidak melenceng. */
export function startTimer(seconds, { onTick, onDone }) {
	const endAt = Date.now() + seconds * 1000
	let t
	function tick() {
		const left = Math.max(0, endAt - Date.now())
		onTick(left / 1000, left / (seconds * 1000))
		if (left <= 0) {
			onDone?.()
			return
		}
		t = setTimeout(tick, 100)
	}
	tick()
	return () => clearTimeout(t)
}
