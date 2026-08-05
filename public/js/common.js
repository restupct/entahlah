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

/** Pewarnaan sintaks sederhana - cukup untuk potongan kode pendek. */
export function highlight(code) {
	return escapeHtml(code)
		.replace(/(&#39;|')([^'\n]*)\1/g, '<span class="s">$1$2$1</span>')
		.replace(/\/\/[^\n]*/g, '<span class="c">$&</span>')
		.replace(KEYWORDS, '<span class="k">$&</span>')
		.replace(/\b(\d+)\b/g, '<span class="n">$1</span>')
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
 * (mis. skor milik peserta yang sedang lihat).
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
				(showTeam && p.team ? ' <span class="muted">&middot; Tim ' + p.team + '</span>' : '') +
				(offline ? ' <span class="muted">(offline)</span>' : '') +
				'</span><span class="lb-score">' +
				p.score +
				'</span></div>'
			)
		})
		.join('')
}

/** Render ringkasan skor Tim A vs Tim B. */
export function teamsSummaryHtml(teams) {
	if (!teams) return ''
	return (
		'<div class="card row between">' +
		'<div><div class="label m-0">Tim A</div>' +
		'<div class="lb-score text-2xl">' +
		teams.A +
		'</div></div>' +
		'<span class="muted">vs</span>' +
		'<div class="text-right"><div class="label m-0">Tim B</div>' +
		'<div class="lb-score text-2xl">' +
		teams.B +
		'</div></div></div>'
	)
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
