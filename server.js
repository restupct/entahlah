'use strict'
/**
 * Branch Battle - server game kuis percabangan JS untuk jaringan lokal (LAN).
 * Jalankan:  node server.js        (default port 8321)
 *            PORT=9000 node server.js
 *
 * Catatan refactor: WebSocket sekarang pakai library `ws` (bukan
 * implementasi RFC6455 manual), dan kode room / id pemain pakai `nanoid`
 * (lihat lib/game.js). Semuanya tetap 100% berjalan di server lokal ini -
 * tidak ada panggilan ke internet - jadi tetap stabil dipakai di satu
 * jaringan WiFi tanpa akses internet sekalipun.
 */
const http = require('http')
const fs = require('fs')
const path = require('path')
const os = require('os')
const { WebSocketServer } = require('ws')
const { createGame } = require('./lib/game')

const PORT = Number(process.env.PORT || 8321)
const PUBLIC = path.join(__dirname, 'public')
const QUESTIONS = JSON.parse(
	fs.readFileSync(path.join(__dirname, 'questions.json'), 'utf8'),
)

const MIME = {
	'.html': 'text/html; charset=utf-8',
	'.css': 'text/css; charset=utf-8',
	'.js': 'text/javascript; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg': 'image/svg+xml',
	'.ico': 'image/x-icon',
}

function lanAddresses() {
	const out = []
	for (const list of Object.values(os.networkInterfaces())) {
		for (const ni of list || []) {
			if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address)
		}
	}
	return out
}

const server = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost')
	let file = url.pathname === '/' ? '/index.html' : url.pathname
	if (!path.extname(file)) file += '.html'
	const full = path.join(PUBLIC, path.normalize(file).replace(/^([/\\])+/, ''))
	if (!full.startsWith(PUBLIC)) {
		res.writeHead(403).end('Forbidden')
		return
	}
	fs.readFile(full, (err, buf) => {
		if (err) {
			res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
			res.end('404 - halaman tidak ditemukan')
			return
		}
		res.writeHead(200, {
			'Content-Type': MIME[path.extname(full)] || 'application/octet-stream',
			'Cache-Control': 'no-cache',
		})
		res.end(buf)
	})
})

const game = createGame(QUESTIONS, {
	getJoinUrls: () => lanAddresses().map((ip) => ip + ':' + PORT),
})

const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
	ws.isAlive = true
	ws.on('pong', () => {
		ws.isAlive = true
	})

	const conn = {
		data: {},
		send(obj) {
			if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(obj))
		},
	}

	ws.on('message', (raw) => {
		let msg
		try {
			msg = JSON.parse(raw.toString())
		} catch {
			return
		}
		try {
			game.handle(conn, msg)
		} catch (err) {
			conn.send({ t: 'error', message: 'Terjadi kesalahan di server.' })
		}
	})

	ws.on('close', () => game.onClose(conn))
})

// Heartbeat: putuskan koneksi yang diam-diam mati (mis. HP dikunci / pindah
// jangkauan WiFi) supaya daftar peserta di layar guru tetap akurat.
const heartbeat = setInterval(() => {
	for (const ws of wss.clients) {
		if (ws.isAlive === false) {
			ws.terminate()
			continue
		}
		ws.isAlive = false
		ws.ping()
	}
}, 25000)
wss.on('close', () => clearInterval(heartbeat))

server.listen(PORT, '0.0.0.0', () => {
	const ips = lanAddresses()
	console.log('\n  Branch Battle - kuis Percabangan JavaScript')
	console.log('  ' + '-'.repeat(46))
	console.log('  Guru / proyektor : http://localhost:' + PORT + '/host')
	if (ips.length) {
		console.log('  Siswa (satu WiFi):')
		for (const ip of ips) console.log('      http://' + ip + ':' + PORT)
	} else {
		console.log('  (Tidak ada alamat LAN terdeteksi - cek koneksi WiFi)')
	}
	console.log('  Soal tersedia    : ' + QUESTIONS.length)
	console.log('')
})
