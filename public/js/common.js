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

/**
 * Render ringkasan skor Tim A vs Tim B.
 * - `highlightTeam` ('A'/'B'): tandai kolom tim itu sebagai "punya kamu" -
 *   dipakai play.html supaya siswa langsung tahu tim mana dirinya, tidak
 *   cuma dua angka polos tanpa konteks.
 * - `final`: kalau true, tambah baris "Tim X menang!"/"Seri!" di bawah -
 *   dipakai untuk hasil akhir (host & play), TIDAK dipakai untuk papan skor
 *   tim yang masih berjalan supaya tidak menyiratkan game sudah selesai.
 * Tim yang unggul selalu ditandai mahkota, baik saat masih berjalan
 * ("sementara unggul") maupun di hasil akhir.
 */
export function teamsSummaryHtml(teams, { highlightTeam = null, final = false } = {}) {
	if (!teams) return ''
	const tie = teams.A === teams.B
	const leader = tie ? null : teams.A > teams.B ? 'A' : 'B'
	function col(name, score) {
		const mine = highlightTeam === name
		return (
			'<div class="team-col' +
			(mine ? ' is-mine' : '') +
			(name === 'B' ? ' text-right' : '') +
			'"><div class="label m-0">Tim ' +
			name +
			(leader === name ? ' \u{1F451}' : '') +
			(mine ? ' <span class="muted">(kamu)</span>' : '') +
			'</div><div class="lb-score text-2xl">' +
			score +
			'</div></div>'
		)
	}
	return (
		'<div class="card row between">' +
		col('A', teams.A) +
		'<span class="muted">vs</span>' +
		col('B', teams.B) +
		'</div>' +
		(final
			? '<p class="text-center muted text-small mt-1 m-0">' +
				(tie ? 'Seri!' : 'Tim ' + leader + ' menang!') +
				'</p>'
			: '')
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
