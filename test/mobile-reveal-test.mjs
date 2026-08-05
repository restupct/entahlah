// Uji manual: pastikan blok kode di sisi jawaban (reveal) tidak lagi
// kepotong/terlalu tinggi di layar HP setelah refactor CSS.
// Jalankan: node test/mobile-reveal-test.mjs
import { chromium, devices } from 'playwright'

const BASE = process.env.BASE_URL || 'http://localhost:8322'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
	const browser = await chromium.launch({
		executablePath: '/usr/local/bin/chromium',
		args: ['--no-sandbox'],
	})

	// Host: layar proyektor (desktop biasa)
	const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } })
	const hostPage = await hostCtx.newPage()

	// Peserta: emulasi HP (iPhone SE) - ini yang dikeluhkan peserta
	const iphone = devices['iPhone SE']
	const playerCtx = await browser.newContext({ ...iphone })
	const playerPage = await playerCtx.newPage()

	await hostPage.goto(BASE + '/host')
	await hostPage.waitForFunction(() => document.querySelector('#code')?.textContent?.length === 4)
	const code = await hostPage.textContent('#code')
	console.log('Room code:', code)

	// Fokuskan ke soal fix-bug (blok kodenya paling panjang -> paling rawan kepotong)
	await hostPage.click('#typeChips button[data-type="predict-output"]')
	await hostPage.click('#typeChips button[data-type="trace-path"]')
	await hostPage.click('#typeChips button[data-type="pairing"]')
	await hostPage.fill('#optCount', '1')
	await sleep(300)

	await playerPage.goto(BASE + '/play')
	await playerPage.fill('#fCode', code)
	await playerPage.fill('#fName', 'Peserta Tes')
	await playerPage.click('#btnJoin')
	await playerPage.waitForSelector('#wait:not(.hidden)')

	await hostPage.waitForFunction(() => !document.querySelector('#start').disabled)
	await hostPage.click('#start')

	await playerPage.waitForSelector('#game:not(.hidden)', { timeout: 10000 })
	await sleep(300)
	const typeLabel = await playerPage.textContent('#pType')
	console.log('Tipe soal:', typeLabel)

	// Jawab (pilihan mana saja), lalu host membuka jawaban
	await playerPage.click('#pOpts .opt >> nth=0')
	await hostPage.click('#btnReveal')

	// Tunggu animasi flip (600ms) selesai total
	await playerPage.waitForFunction(() => document.querySelector('#pFlip')?.classList.contains('is-flipped'))
	await sleep(900)

	await playerPage.screenshot({ path: '/data/branch-battle-v2/test/shot-player-reveal.png' })
	await hostPage.screenshot({ path: '/data/branch-battle-v2/test/shot-host-reveal.png', fullPage: true })

	// Verifikasi terprogram: blok kode di kartu belakang harus sepenuhnya
	// berada di dalam batas kartu (tidak terpotong oleh kartu depan / tinggi
	// container), dan seluruh kartu belakang harus punya tinggi > 0 (artinya
	// tidak collapse / tersembunyi).
	const check = await playerPage.evaluate(() => {
		const back = document.querySelector('#pBack')
		const backCode = document.querySelector('#pBackCode')
		const flip = document.querySelector('#pFlip')
		const backRect = back.getBoundingClientRect()
		const codeRect = backCode.getBoundingClientRect()
		const flipRect = flip.getBoundingClientRect()
		return {
			backHeight: backRect.height,
			codeHeight: codeRect.height,
			codeBottom: codeRect.bottom,
			backBottom: backRect.bottom,
			flipHeight: flipRect.height,
			// blok kode harus muat di dalam kartu belakang (tidak overflow ke luar)
			codeFitsInsideBack: codeRect.bottom <= backRect.bottom + 1,
			viewportHeight: window.innerHeight,
		}
	})
	console.log('Pemeriksaan tata letak kartu jawaban:', check)

	if (!check.codeFitsInsideBack || check.backHeight <= 0 || check.codeHeight <= 0) {
		console.error('GAGAL: blok kode masih berpotensi terpotong / tersembunyi.')
		process.exitCode = 1
	} else {
		console.log('OK: blok kode sepenuhnya terlihat di dalam kartu jawaban.')
	}

	await browser.close()
}

main().catch((err) => {
	console.error(err)
	process.exitCode = 1
})
