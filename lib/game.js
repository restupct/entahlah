'use strict'
/**
 * Logika inti room/game Branch Battle - dipisah dari transport (HTTP/WS)
 * supaya bisa dipakai ulang dan gampang dites. Aturan skor & alur pesan sama
 * persis seperti versi awal, hanya kode room/id pemain sekarang pakai
 * `nanoid` (customAlphabet) alih-alih fungsi acak buatan sendiri.
 *
 * Mode permainan (room.options.mode):
 * - 'classic' : perilaku lama, tidak berubah sedikit pun. Benar = 100 +
 *   bonus cepat + bonus beruntun.
 * - 'betting' : ada fase taruhan sebelum opsi jawaban dikirim. Siswa memasang
 *   50/100/200 poin dari modalnya sendiri, LALU opsi jawaban muncul. Benar =
 *   taruhan didapat (plus bonus cepat & beruntun), salah atau tidak menjawab =
 *   taruhan hangus. Skor tidak pernah minus.
 */
const { customAlphabet } = require('nanoid')

const TYPE_LABEL = {
	'predict-output': 'Tebak Output',
	'trace-path': 'Telusuri Cabang',
	'fix-bug': 'Cari Bug',
	pairing: 'Pasangkan',
}

// Label tim - dulu cuma 'A'/'B' hardcode (selalu 2 tim). Sekarang jumlah tim
// bisa diatur host lewat room.options.teamCount, dibatasi panjang array ini.
const TEAM_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F']

// ===== Mode permainan =====
const MODES = new Set(['classic', 'betting'])
// Modal awal mode taruhan. Tanpa ini taruhan pertama mustahil dilakukan,
// karena di mode klasik semua siswa mulai dari 0 poin.
const BET_START_SCORE = 300
// Nominal taruhan TETAP (bukan persen skor) supaya gampang dihitung di kepala
// siswa saat kelas berjalan.
const BET_CHOICES = [50, 100, 200]
// Lama fase taruhan dalam detik, sebelum opsi jawaban dibuka.
const BET_WINDOW_SEC = 10
// Bonus cepat di mode taruhan dihitung sebagai persen dari taruhan (maks 25%),
// supaya yang paling menentukan tetap keputusan taruhan - bukan kecepatan
// jempol - tapi bonusnya tetap ada seperti mode klasik.
const BET_SPEED_BONUS_RATIO = 0.25

function normalizeMode(mode) {
	return MODES.has(mode) ? mode : 'classic'
}

function clampTeamCount(n) {
	return Math.min(TEAM_LETTERS.length, Math.max(2, Number(n) || 2))
}

const roomCode = customAlphabet('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 4)
const genPid = customAlphabet('abcdefghijklmnopqrstuvwxyz0123456789', 8)

function shuffle(arr) {
	const a = arr.slice()
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1))
		;[a[i], a[j]] = [a[j], a[i]]
	}
	return a
}

/**
 * @param {Map<string, {id:string,label:string,questions:Array<object>}>} banks -
 *   bank soal, satu entri per file di folder banks/. Tiap file adalah satu
 *   "mata pelajaran" (mis. js-dasar.json, sql-dasar.json) dengan skema soal
 *   yang sama persis.
 * @param {string} defaultBank - id bank yang dipakai kalau room belum pilih
 *   satu, atau id yang dikirim klien ternyata tidak ada (mis. file dihapus).
 * @param {{ getJoinUrls: () => string[] }} deps - info jaringan untuk host
 */
function createGame(banks, defaultBank, deps) {
	const rooms = new Map()

	function bankIdFor(id) {
		return banks.has(id) ? id : defaultBank
	}

	function questionsFor(room) {
		return banks.get(bankIdFor(room.options.bank)).questions
	}

	function startingScore(room) {
		return room.options.mode === 'betting' ? BET_START_SCORE : 0
	}

	// Nominal taruhan yang boleh dipilih siswa: hanya yang sanggup dibayar
	// poinnya sekarang. Kalau poinnya bahkan tidak cukup untuk taruhan
	// terkecil (mis. habis di kartu sebelumnya), dia tetap dapat SATU taruhan
	// minimum supaya tidak mati kutu sisa permainan - dan karena skor dilantai
	// di reveal(), poinnya tetap tidak pernah minus.
	function allowedBets(player) {
		const affordable = BET_CHOICES.filter((b) => b <= player.score)
		return affordable.length ? affordable : [BET_CHOICES[0]]
	}

	function minBetFor(player) {
		return allowedBets(player)[0]
	}

	function createRoom(hostConn, opts = {}) {
		let code = roomCode()
		while (rooms.has(code)) code = roomCode()

		const bank = bankIdFor(opts.bank)
		const room = {
			code,
			hosts: new Set([hostConn]),
			players: new Map(),
			phase: 'lobby',
			deck: [],
			index: -1,
			startedAt: 0,
			betStartedAt: 0,
			timer: null,
			options: {
				bank,
				// 'classic' (default, perilaku lama) atau 'betting'.
				mode: normalizeMode(opts.mode),
				teamMode: !!opts.teamMode,
				// Minimal 2, maksimal sejumlah huruf di TEAM_LETTERS - dulu selalu
				// tepat 2 (Tim A vs Tim B), sekarang bisa diatur host.
				teamCount: clampTeamCount(opts.teamCount),
				shuffle: opts.shuffle !== false,
				count: Number(opts.count) || banks.get(bank).questions.length,
				types:
					Array.isArray(opts.types) && opts.types.length ? opts.types : null,
			},
		}
		rooms.set(code, room)
		return room
	}

	function buildDeck(room) {
		const source = questionsFor(room)
		let pool = source.slice()
		if (room.options.types) {
			pool = pool.filter((q) => room.options.types.includes(q.type))
		}
		if (!pool.length) pool = source.slice()
		pool = room.options.shuffle ? shuffle(pool) : pool
		room.deck = pool.slice(0, Math.max(1, room.options.count))
	}

	function broadcast(room, msg, who = 'all') {
		if (who === 'all' || who === 'host') for (const h of room.hosts) h.send(msg)
		if (who === 'all' || who === 'players')
			for (const p of room.players.values()) for (const c of p.conns) c.send(msg)
	}

	function leaderboard(room) {
		return [...room.players.values()]
			.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
			.map((p, i) => ({
				rank: i + 1,
				pid: p.pid,
				name: p.name,
				team: p.team,
				// Skor yang ditampilkan tidak pernah minus (mode taruhan).
				score: Math.max(0, p.score),
				streak: p.streak,
				correct: p.correct,
				online: p.conns.size > 0,
			}))
	}

	function teamLetters(room) {
		return TEAM_LETTERS.slice(0, room.options.teamCount)
	}

	function teamTotals(room) {
		const t = {}
		for (const letter of teamLetters(room)) t[letter] = 0
		for (const p of room.players.values()) {
			if (p.team && t[p.team] !== undefined) t[p.team] += Math.max(0, p.score)
		}
		return t
	}

	// Tim dengan anggota paling sedikit dapat peserta baru - kalau beberapa
	// tim seri jumlahnya, dipilih ACAK di antara yang seri (bukan selalu
	// balik ke Tim A) supaya pembagian terasa lebih dinamis, tidak
	// selang-seling kaku berdasarkan urutan gabung semata.
	function assignTeam(room) {
		const letters = teamLetters(room)
		const counts = {}
		for (const l of letters) counts[l] = 0
		for (const p of room.players.values()) {
			if (p.team && counts[p.team] !== undefined) counts[p.team] += 1
		}
		const min = Math.min(...letters.map((l) => counts[l]))
		const candidates = letters.filter((l) => counts[l] === min)
		return candidates[Math.floor(Math.random() * candidates.length)]
	}

	// Kocok ulang SEMUA peserta ke tim yang ada - acak tapi tetap rata
	// jumlahnya (selisih maksimal 1 orang antar tim). Dipakai saat host
	// menekan tombol "Kocok ulang tim", dan otomatis saat mode tim baru
	// dinyalakan atau jumlah tim berubah.
	function shuffleTeams(room) {
		const letters = teamLetters(room)
		const order = shuffle([...room.players.values()])
		order.forEach((p, i) => {
			p.team = letters[i % letters.length]
		})
	}

	function sendRoster(room) {
		broadcast(room, {
			t: 'roster',
			phase: room.phase,
			players: leaderboard(room),
			teams: room.options.teamMode ? teamTotals(room) : null,
			teamMode: room.options.teamMode,
			mode: room.options.mode,
		})
	}

	function startGame(room) {
		if (!room.players.size) return
		buildDeck(room)
		room.index = -1
		for (const p of room.players.values()) {
			p.score = startingScore(room)
			p.streak = 0
			p.correct = 0
			p.bet = null
			p.forfeited = 0
		}
		nextCard(room)
	}

	/**
	 * Payload kartu. `stage` menentukan apa yang boleh dilihat klien:
	 * - 'question' : seperti dulu, termasuk daftar opsi jawaban.
	 * - 'bet'      : fase taruhan - opsi jawaban SENGAJA tidak dikirim sama
	 *                sekali, supaya siswa menaksir kemampuannya sendiri dulu
	 *                dan tidak bisa mengeliminasi pilihan sebelum bertaruh.
	 * Kunci jawaban & pembahasan tetap tidak pernah dikirim di kedua tahap.
	 */
	function cardPayload(room, q, timeLimit, { stage = 'question' } = {}) {
		const payload = {
			t: 'card',
			stage,
			mode: room.options.mode,
			index: room.index,
			total: room.deck.length,
			id: q.id,
			type: q.type,
			typeLabel: TYPE_LABEL[q.type] || q.type,
			level: q.level,
			prompt: q.prompt,
			code: q.code,
			// Bahasa untuk syntax highlighting di klien ('js' default supaya soal
			// lama tanpa field ini tetap tampil seperti sebelumnya).
			lang: q.lang || 'js',
			timeLimit,
			serverNow: Date.now(),
		}
		if (stage === 'bet') {
			payload.betChoices = BET_CHOICES
			// Jumlah opsi saja (bukan isinya) - cukup untuk klien menampilkan
			// "nanti ada 4 pilihan" tanpa membocorkan apa pun.
			payload.optionCount = q.options.length
		} else {
			payload.options = q.options
		}
		return payload
	}

	function nextCard(room) {
		clearTimeout(room.timer)
		room.index += 1
		if (room.index >= room.deck.length) return endGame(room)

		const q = room.deck[room.index]
		for (const p of room.players.values()) {
			p.answer = null
			p.bet = null
			p.forfeited = 0
		}

		if (room.options.mode === 'betting') return openBetting(room, q)
		openQuestion(room, q)
	}

	// Fase taruhan (khusus mode 'betting').
	function openBetting(room, q) {
		clearTimeout(room.timer)
		room.phase = 'bet'
		room.betStartedAt = Date.now()
		// Menandai apakah kartu ini sudah pernah mencapai "semua sudah taruh",
		// supaya percepatan pembukaan opsi cuma dijadwalkan sekali walau ada
		// yang gonta-ganti nominal taruhan setelahnya.
		room.allBet = false

		broadcast(room, cardPayload(room, q, BET_WINDOW_SEC, { stage: 'bet' }))
		broadcast(
			room,
			{ t: 'progress', stage: 'bet', answered: 0, total: room.players.size },
			'host',
		)

		room.timer = setTimeout(
			() => openQuestion(room, q),
			BET_WINDOW_SEC * 1000 + 500,
		)
	}

	function openQuestion(room, q) {
		clearTimeout(room.timer)
		room.phase = 'question'
		room.startedAt = Date.now()
		// Menandai apakah kartu ini sudah pernah mencapai "semua sudah jawab"
		// - dipakai submitAnswer() supaya penjadwalan reveal cepat cuma jalan
		// sekali, walau ada yang gonta-ganti pilihan setelahnya.
		room.allAnswered = false

		// Yang tidak memasang taruhan sampai waktu taruhan habis tetap kena
		// taruhan minimum - supaya "diam saja" bukan strategi bebas risiko.
		if (room.options.mode === 'betting') {
			for (const p of room.players.values()) {
				if (!p.bet) p.bet = minBetFor(p)
				for (const c of p.conns) c.send({ t: 'betLocked', bet: p.bet })
			}
		}

		// PENTING: kunci jawaban & pembahasan TIDAK pernah dikirim sebelum reveal.
		broadcast(room, cardPayload(room, q, q.timeLimit || 20))
		broadcast(
			room,
			{ t: 'progress', stage: 'question', answered: 0, total: room.players.size },
			'host',
		)

		room.timer = setTimeout(() => reveal(room), (q.timeLimit || 20) * 1000 + 700)
	}

	function submitBet(room, player, amount) {
		if (room.phase !== 'bet' || room.options.mode !== 'betting') return
		const allowed = allowedBets(player)
		// Nominal ngawur / tidak sanggup dibayar diturunkan ke taruhan terkecil
		// yang sah, bukan ditolak diam-diam.
		player.bet = allowed.includes(Number(amount)) ? Number(amount) : allowed[0]

		for (const c of player.conns) c.send({ t: 'betAck', bet: player.bet })

		const placed = [...room.players.values()].filter((p) => p.bet).length
		broadcast(
			room,
			{
				t: 'progress',
				stage: 'bet',
				answered: placed,
				total: room.players.size,
			},
			'host',
		)

		// Kalau satu kelas sudah pasang taruhan, tidak perlu menunggu sisa
		// hitungan mundur - buka opsi jawaban 600ms kemudian. Sama seperti
		// percepatan reveal, ini cuma dijadwalkan sekali per kartu.
		if (placed >= room.players.size && !room.allBet) {
			room.allBet = true
			clearTimeout(room.timer)
			const q = room.deck[room.index]
			room.timer = setTimeout(() => openQuestion(room, q), 600)
		}
	}

	function submitAnswer(room, player, choice) {
		// Dulu ada `|| player.answer` di sini yang bikin jawaban terkunci
		// permanen sejak klik pertama. Sekarang dihapus supaya siswa bisa
		// ganti pilihan berkali-kali selama kartu belum dibuka (fase masih
		// 'question') dan belum lewat batas waktu.
		if (room.phase !== 'question') return
		const q = room.deck[room.index]
		const limit = (q.timeLimit || 20) * 1000
		const elapsed = Date.now() - room.startedAt
		if (elapsed > limit + 1500) return

		// Kalau ini bukan jawaban pertama untuk kartu ini, batalkan dulu poin
		// dari jawaban lama supaya tidak dobel hitung. Di mode taruhan, poin
		// jawaban salah bernilai NEGATIF, dan pengurangan yang sama tetap
		// berlaku sebagai pembatalan (mengurangi angka negatif = menambah).
		// Streak/jumlah-benar SENGAJA tidak diubah di sini - itu baru
		// difinalisasi sekali di reveal(), berdasarkan pilihan FINAL, biar
		// bonus beruntun tidak salah hitung akibat gonta-ganti pilihan dalam
		// satu kartu yang sama.
		if (player.answer) player.score -= player.answer.points

		const correct = choice === q.answer
		const betting = room.options.mode === 'betting'
		const bet = betting ? player.bet || minBetFor(player) : 0
		let points = 0
		// Rincian skor disimpan (bukan cuma totalnya) supaya nanti bisa
		// ditunjukkan balik ke siswa - biar mereka lihat sendiri kenapa poin
		// mereka segitu, bukan cuma percaya angka akhir. Bonus kecepatan
		// selalu dihitung dari waktu jawaban TERBARU (kalau diganti, dihitung
		// ulang dari waktu ganti itu, bukan dari klik pertama).
		let breakdown = null
		const speed = Math.max(0, 1 - elapsed / limit)
		if (betting) {
			if (correct) {
				const speedBonus = Math.round(speed * bet * BET_SPEED_BONUS_RATIO)
				const streakBonus = Math.min(player.streak * 10, 50)
				points = bet + speedBonus + streakBonus
				breakdown = { mode: 'betting', bet, base: bet, speedBonus, streakBonus }
			} else {
				points = -bet
				breakdown = {
					mode: 'betting',
					bet,
					base: -bet,
					speedBonus: 0,
					streakBonus: 0,
				}
			}
		} else if (correct) {
			const speedBonus = Math.round(speed * 100)
			const streakBonus = Math.min(player.streak * 10, 50)
			const base = 100
			points = base + speedBonus + streakBonus
			breakdown = { mode: 'classic', base, speedBonus, streakBonus }
		}
		player.score += points
		player.answer = { choice, correct, points, ms: elapsed, breakdown, bet }

		for (const c of player.conns) c.send({ t: 'ack', choice, waiting: true })

		const answered = [...room.players.values()].filter((p) => p.answer).length
		broadcast(
			room,
			{ t: 'progress', stage: 'question', answered, total: room.players.size },
			'host',
		)
		// Jadwalkan reveal 600ms setelah SEMUA sudah jawab - tapi cuma sekali
		// per kartu (`room.allAnswered`). Tanpa penjaga ini, siswa yang terus
		// gonta-ganti pilihan setelah satu kelas selesai bisa menunda-nunda
		// pembukaan jawaban tanpa batas.
		if (answered >= room.players.size && !room.allAnswered) {
			room.allAnswered = true
			clearTimeout(room.timer)
			room.timer = setTimeout(() => reveal(room), 600)
		}
	}

	function reveal(room) {
		if (room.phase !== 'question') return
		clearTimeout(room.timer)
		room.phase = 'reveal'
		const q = room.deck[room.index]
		const betting = room.options.mode === 'betting'

		// Finalisasi streak & jumlah-benar sekali di sini, berdasarkan pilihan
		// FINAL tiap siswa (setelah kemungkinan ganti pilihan beberapa kali).
		// Siswa yang tidak menjawab sama sekali: streak TIDAK diubah, sama
		// seperti perilaku sebelumnya - tapi di mode taruhan, taruhannya
		// hangus (kalau tidak, memasang taruhan besar lalu diam justru jadi
		// pilihan bebas risiko).
		for (const p of room.players.values()) {
			p.forfeited = 0
			if (!p.answer) {
				if (betting && p.bet) {
					p.score -= p.bet
					p.forfeited = p.bet
				}
				continue
			}
			if (p.answer.correct) {
				p.streak += 1
				p.correct += 1
			} else {
				p.streak = 0
			}
		}

		// Lantai skor: di mode taruhan poin tidak boleh minus, supaya siswa yang
		// sedang sial tetap punya sesuatu untuk dipertaruhkan lagi.
		if (betting) {
			for (const p of room.players.values()) p.score = Math.max(0, p.score)
		}

		const stats = q.options.map(() => 0)
		for (const p of room.players.values()) {
			if (p.answer && stats[p.answer.choice] !== undefined)
				stats[p.answer.choice] += 1
		}

		// Sebaran taruhan kelas - ditampilkan di layar guru saat reveal, biar
		// kelihatan seberapa yakin kelas sebelum melihat pilihan jawaban.
		let betStats = null
		if (betting) {
			betStats = {}
			for (const b of BET_CHOICES) betStats[b] = 0
			for (const p of room.players.values()) {
				if (p.bet && betStats[p.bet] !== undefined) betStats[p.bet] += 1
			}
		}

		// Daftar yang paling cepat DAN benar - ditampilkan ke seluruh kelas di
		// layar guru, supaya kalau ada yang merasa "aku lebih cepat kok",
		// semua bisa lihat langsung urutan waktu jawab yang sebenarnya.
		const fastest = [...room.players.values()]
			.filter((p) => p.answer && p.answer.correct)
			.sort((a, b) => a.answer.ms - b.answer.ms)
			.slice(0, 3)
			.map((p) => ({ name: p.name, team: p.team, ms: p.answer.ms }))

		broadcast(room, {
			t: 'reveal',
			mode: room.options.mode,
			answer: q.answer,
			explanation: q.explanation,
			stats,
			betStats,
			responders: [...room.players.values()].filter((p) => p.answer).length,
			leaderboard: leaderboard(room).slice(0, 10),
			teams: room.options.teamMode ? teamTotals(room) : null,
			isLast: room.index >= room.deck.length - 1,
			fastest,
		})

		const board = leaderboard(room)
		for (const p of room.players.values()) {
			for (const c of p.conns) {
				c.send({
					t: 'result',
					mode: room.options.mode,
					answer: q.answer,
					explanation: q.explanation,
					correct: !!(p.answer && p.answer.correct),
					answered: !!p.answer,
					choice: p.answer ? p.answer.choice : null,
					// Tidak menjawab di mode taruhan = taruhan hangus, jadi poinnya
					// negatif walau dia tidak memilih apa pun.
					points: p.answer ? p.answer.points : -(p.forfeited || 0),
					bet: betting ? p.bet || null : null,
					forfeited: p.forfeited || 0,
					// Rincian poin & waktu jawab (ms) - dipakai klien untuk
					// menjelaskan ke siswa kenapa poinnya segitu.
					breakdown: p.answer ? p.answer.breakdown : null,
					ms: p.answer ? p.answer.ms : null,
					score: Math.max(0, p.score),
					streak: p.streak,
					rank: (board.find((x) => x.pid === p.pid) || {}).rank || null,
					of: room.players.size,
				})
			}
		}
	}

	function endGame(room) {
		room.phase = 'ended'
		clearTimeout(room.timer)
		broadcast(room, {
			t: 'end',
			mode: room.options.mode,
			leaderboard: leaderboard(room),
			teams: room.options.teamMode ? teamTotals(room) : null,
			total: room.deck.length,
		})
	}

	function hostInfo(r) {
		return {
			t: 'room',
			code: r.code,
			joinUrls: deps.getJoinUrls(),
			available: questionsFor(r).length,
			banks: [...banks.values()].map((b) => ({
				id: b.id,
				label: b.label,
				count: b.questions.length,
			})),
			options: r.options,
			betChoices: BET_CHOICES,
			betStartScore: BET_START_SCORE,
		}
	}

	function handle(conn, msg) {
		const room = rooms.get(conn.data.code)

		switch (msg.t) {
			case 'host:create': {
				const r = createRoom(conn, msg.options || {})
				conn.data = { role: 'host', code: r.code }
				conn.send(hostInfo(r))
				sendRoster(r)
				return
			}

			case 'host:resume': {
				const r = rooms.get(String(msg.code || '').toUpperCase())
				if (!r)
					return conn.send({ t: 'error', message: 'Room sudah tidak aktif.' })
				r.hosts.add(conn)
				conn.data = { role: 'host', code: r.code }
				conn.send(hostInfo(r))
				sendRoster(r)
				return
			}

			case 'player:join': {
				const code = String(msg.code || '')
					.toUpperCase()
					.trim()
				const r = rooms.get(code)
				if (!r)
					return conn.send({ t: 'error', message: 'Kode room tidak ditemukan.' })

				const name =
					String(msg.name || '')
						.trim()
						.slice(0, 20) || 'Anonim'

				let player = msg.pid ? r.players.get(msg.pid) : null
				if (!player) {
					const taken = [...r.players.values()].some(
						(p) => p.name.toLowerCase() === name.toLowerCase(),
					)
					if (taken)
						return conn.send({
							t: 'error',
							message: 'Nama sudah dipakai, ganti ya.',
						})
					player = {
						pid: genPid(),
						name,
						team: r.options.teamMode ? assignTeam(r) : null,
						// Mode taruhan: langsung dapat modal awal, jadi kartu pertama
						// sudah bisa dipertaruhkan.
						score: r.phase === 'lobby' ? startingScore(r) : 0,
						streak: 0,
						correct: 0,
						answer: null,
						bet: null,
						forfeited: 0,
						conns: new Set(),
					}
					r.players.set(player.pid, player)
				}
				player.conns.add(conn)
				conn.data = { role: 'player', code: r.code, pid: player.pid }

				conn.send({
					t: 'joined',
					pid: player.pid,
					code: r.code,
					name: player.name,
					team: player.team,
					score: Math.max(0, player.score),
					phase: r.phase,
					mode: r.options.mode,
				})

				// Nyambung ulang di tengah fase taruhan (mis. HP terkunci sebentar)
				// - kirim ulang kartu tahap taruhan dengan sisa waktunya, kalau
				// tidak dia akan nyangkut di layar tunggu sampai kartu berikutnya.
				if (r.phase === 'bet') {
					const q = r.deck[r.index]
					const elapsed = Math.round((Date.now() - r.betStartedAt) / 1000)
					conn.send(
						cardPayload(r, q, Math.max(1, BET_WINDOW_SEC - elapsed), {
							stage: 'bet',
						}),
					)
					if (player.bet) conn.send({ t: 'betAck', bet: player.bet })
				} else if (r.phase === 'question') {
					const q = r.deck[r.index]
					const elapsed = Math.round((Date.now() - r.startedAt) / 1000)
					if (r.options.mode === 'betting' && player.bet)
						conn.send({ t: 'betLocked', bet: player.bet })
					conn.send(cardPayload(r, q, Math.max(1, (q.timeLimit || 20) - elapsed)))
					if (player.answer)
						conn.send({ t: 'ack', choice: player.answer.choice, waiting: true })
				} else if (r.phase === 'ended') {
					conn.send({
						t: 'end',
						mode: r.options.mode,
						leaderboard: leaderboard(r),
						total: r.deck.length,
					})
				}
				sendRoster(r)
				return
			}

			case 'player:bet': {
				if (!room || conn.data.role !== 'player') return
				const p = room.players.get(conn.data.pid)
				if (p) submitBet(room, p, msg.bet)
				return
			}

			case 'player:answer': {
				if (!room || conn.data.role !== 'player') return
				const p = room.players.get(conn.data.pid)
				if (p) submitAnswer(room, p, Number(msg.choice))
				return
			}

			case 'host:options': {
				if (!room || conn.data.role !== 'host') return
				const prevBank = room.options.bank
				const prevMode = room.options.mode
				const prevTeamMode = room.options.teamMode
				const prevTeamCount = room.options.teamCount
				Object.assign(room.options, msg.options || {})
				room.options.bank = bankIdFor(room.options.bank)
				room.options.mode = normalizeMode(room.options.mode)
				room.options.teamCount = clampTeamCount(room.options.teamCount)
				// Ganti mode selagi di lobby -> modal awal tiap siswa ikut berubah
				// (mode taruhan mulai dari BET_START_SCORE, klasik dari 0). Mode
				// tidak boleh berdampak apa pun kalau kuis sudah berjalan.
				if (room.options.mode !== prevMode && room.phase === 'lobby') {
					for (const p of room.players.values()) p.score = startingScore(room)
				}
				if (room.options.teamMode) {
					// Kocok ulang otomatis HANYA saat mode tim baru dinyalakan atau
					// jumlah tim berubah (tim lama bisa jadi tidak valid lagi) -
					// supaya hasil "Kocok ulang tim" manual / pemindahan manual host
					// tidak ketimpa cuma gara-gara host ganti opsi lain (mis. bank
					// soal / jumlah soal).
					if (!prevTeamMode || room.options.teamCount !== prevTeamCount) {
						shuffleTeams(room)
					}
				} else {
					for (const p of room.players.values()) p.team = null
				}
				// Ganti bank -> jumlah soal tersedia berubah, kabari host lagi biar
				// batas atas input "Jumlah soal" ikut ter-update.
				if (room.options.bank !== prevBank) conn.send(hostInfo(room))
				sendRoster(room)
				return
			}

			case 'host:start':
				if (room && conn.data.role === 'host') startGame(room)
				return

			case 'host:next':
				if (room && conn.data.role === 'host') nextCard(room)
				return

			case 'host:reveal':
				if (room && conn.data.role === 'host') reveal(room)
				return

			case 'host:kick':
				if (room && conn.data.role === 'host') {
					room.players.delete(msg.pid)
					sendRoster(room)
				}
				return

			case 'host:shuffleTeams':
				if (room && conn.data.role === 'host' && room.options.teamMode) {
					shuffleTeams(room)
					sendRoster(room)
				}
				return

			case 'host:setTeam': {
				if (!room || conn.data.role !== 'host' || !room.options.teamMode) return
				const p = room.players.get(msg.pid)
				const letters = teamLetters(room)
				if (p && letters.includes(msg.team)) {
					p.team = msg.team
					sendRoster(room)
				}
				return
			}

			case 'host:restart':
				if (room && conn.data.role === 'host') {
					room.phase = 'lobby'
					room.index = -1
					clearTimeout(room.timer)
					for (const p of room.players.values()) {
						p.score = startingScore(room)
						p.streak = 0
						p.correct = 0
						p.answer = null
						p.bet = null
						p.forfeited = 0
					}
					broadcast(room, { t: 'lobby' })
					sendRoster(room)
				}
				return

			case 'ping':
				conn.send({ t: 'pong' })
				return
		}
	}

	function onClose(conn) {
		const room = rooms.get(conn.data.code)
		if (!room) return
		if (conn.data.role === 'host') {
			room.hosts.delete(conn)
		} else if (conn.data.pid) {
			const p = room.players.get(conn.data.pid)
			if (p) {
				p.conns.delete(conn)
				sendRoster(room)
			}
		}
	}

	return { handle, onClose, rooms }
}

module.exports = { createGame, BET_CHOICES, BET_START_SCORE, BET_WINDOW_SEC }
