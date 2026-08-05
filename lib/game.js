'use strict'
/**
 * Logika inti room/game Branch Battle - dipisah dari transport (HTTP/WS)
 * supaya bisa dipakai ulang dan gampang dites. Aturan skor & alur pesan sama
 * persis seperti versi awal, hanya kode room/id pemain sekarang pakai
 * `nanoid` (customAlphabet) alih-alih fungsi acak buatan sendiri.
 */
const { customAlphabet } = require('nanoid')

const TYPE_LABEL = {
	'predict-output': 'Tebak Output',
	'trace-path': 'Telusuri Cabang',
	'fix-bug': 'Cari Bug',
	pairing: 'Pasangkan',
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
 * @param {Array<object>} questions - bank soal (dari questions.json)
 * @param {{ getJoinUrls: () => string[] }} deps - info jaringan untuk host
 */
function createGame(questions, deps) {
	const rooms = new Map()

	function createRoom(hostConn, opts = {}) {
		let code = roomCode()
		while (rooms.has(code)) code = roomCode()

		const room = {
			code,
			hosts: new Set([hostConn]),
			players: new Map(),
			phase: 'lobby',
			deck: [],
			index: -1,
			startedAt: 0,
			timer: null,
			options: {
				teamMode: !!opts.teamMode,
				shuffle: opts.shuffle !== false,
				count: Number(opts.count) || questions.length,
				types:
					Array.isArray(opts.types) && opts.types.length ? opts.types : null,
			},
		}
		rooms.set(code, room)
		return room
	}

	function buildDeck(room) {
		let pool = questions.slice()
		if (room.options.types) {
			pool = pool.filter((q) => room.options.types.includes(q.type))
		}
		if (!pool.length) pool = questions.slice()
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
				score: p.score,
				streak: p.streak,
				correct: p.correct,
				online: p.conns.size > 0,
			}))
	}

	function teamTotals(room) {
		const t = { A: 0, B: 0 }
		for (const p of room.players.values()) if (p.team) t[p.team] += p.score
		return t
	}

	function sendRoster(room) {
		broadcast(room, {
			t: 'roster',
			phase: room.phase,
			players: leaderboard(room),
			teams: room.options.teamMode ? teamTotals(room) : null,
			teamMode: room.options.teamMode,
		})
	}

	function startGame(room) {
		if (!room.players.size) return
		buildDeck(room)
		room.index = -1
		for (const p of room.players.values()) {
			p.score = 0
			p.streak = 0
			p.correct = 0
		}
		nextCard(room)
	}

	function cardPayload(room, q, timeLimit) {
		return {
			t: 'card',
			index: room.index,
			total: room.deck.length,
			id: q.id,
			type: q.type,
			typeLabel: TYPE_LABEL[q.type] || q.type,
			level: q.level,
			prompt: q.prompt,
			code: q.code,
			options: q.options,
			timeLimit,
			serverNow: Date.now(),
		}
	}

	function nextCard(room) {
		clearTimeout(room.timer)
		room.index += 1
		if (room.index >= room.deck.length) return endGame(room)

		const q = room.deck[room.index]
		room.phase = 'question'
		room.startedAt = Date.now()
		for (const p of room.players.values()) p.answer = null

		// PENTING: kunci jawaban & pembahasan TIDAK pernah dikirim sebelum reveal.
		broadcast(room, cardPayload(room, q, q.timeLimit || 20))
		broadcast(
			room,
			{ t: 'progress', answered: 0, total: room.players.size },
			'host',
		)

		room.timer = setTimeout(() => reveal(room), (q.timeLimit || 20) * 1000 + 700)
	}

	function submitAnswer(room, player, choice) {
		if (room.phase !== 'question' || player.answer) return
		const q = room.deck[room.index]
		const limit = (q.timeLimit || 20) * 1000
		const elapsed = Date.now() - room.startedAt
		if (elapsed > limit + 1500) return

		const correct = choice === q.answer
		let points = 0
		if (correct) {
			const speed = Math.max(0, 1 - elapsed / limit)
			const streakBonus = Math.min(player.streak * 10, 50)
			points = 100 + Math.round(speed * 100) + streakBonus
			player.streak += 1
			player.correct += 1
		} else {
			player.streak = 0
		}
		player.score += points
		player.answer = { choice, correct, points, ms: elapsed }

		for (const c of player.conns) c.send({ t: 'ack', choice, waiting: true })

		const answered = [...room.players.values()].filter((p) => p.answer).length
		broadcast(room, { t: 'progress', answered, total: room.players.size }, 'host')
		if (answered >= room.players.size) {
			clearTimeout(room.timer)
			room.timer = setTimeout(() => reveal(room), 600)
		}
	}

	function reveal(room) {
		if (room.phase !== 'question') return
		clearTimeout(room.timer)
		room.phase = 'reveal'
		const q = room.deck[room.index]

		const stats = q.options.map(() => 0)
		for (const p of room.players.values()) {
			if (p.answer && stats[p.answer.choice] !== undefined)
				stats[p.answer.choice] += 1
		}

		broadcast(room, {
			t: 'reveal',
			answer: q.answer,
			explanation: q.explanation,
			stats,
			responders: [...room.players.values()].filter((p) => p.answer).length,
			leaderboard: leaderboard(room).slice(0, 10),
			teams: room.options.teamMode ? teamTotals(room) : null,
			isLast: room.index >= room.deck.length - 1,
		})

		const board = leaderboard(room)
		for (const p of room.players.values()) {
			for (const c of p.conns) {
				c.send({
					t: 'result',
					answer: q.answer,
					explanation: q.explanation,
					correct: !!(p.answer && p.answer.correct),
					answered: !!p.answer,
					choice: p.answer ? p.answer.choice : null,
					points: p.answer ? p.answer.points : 0,
					score: p.score,
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
			available: questions.length,
			options: r.options,
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
					const counts = { A: 0, B: 0 }
					for (const p of r.players.values()) if (p.team) counts[p.team] += 1
					player = {
						pid: genPid(),
						name,
						team: r.options.teamMode
							? counts.A <= counts.B
								? 'A'
								: 'B'
							: null,
						score: 0,
						streak: 0,
						correct: 0,
						answer: null,
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
					score: player.score,
					phase: r.phase,
				})

				if (r.phase === 'question') {
					const q = r.deck[r.index]
					const elapsed = Math.round((Date.now() - r.startedAt) / 1000)
					conn.send(cardPayload(r, q, Math.max(1, (q.timeLimit || 20) - elapsed)))
					if (player.answer)
						conn.send({ t: 'ack', choice: player.answer.choice, waiting: true })
				} else if (r.phase === 'ended') {
					conn.send({
						t: 'end',
						leaderboard: leaderboard(r),
						total: r.deck.length,
					})
				}
				sendRoster(r)
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
				Object.assign(room.options, msg.options || {})
				if (room.options.teamMode) {
					let i = 0
					for (const p of room.players.values()) p.team = i++ % 2 ? 'B' : 'A'
				} else {
					for (const p of room.players.values()) p.team = null
				}
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

			case 'host:restart':
				if (room && conn.data.role === 'host') {
					room.phase = 'lobby'
					room.index = -1
					clearTimeout(room.timer)
					for (const p of room.players.values()) {
						p.score = 0
						p.streak = 0
						p.correct = 0
						p.answer = null
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

module.exports = { createGame }
