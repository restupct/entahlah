# Branch Battle (v2 - refactor)

Kuis flip-card real-time untuk melatih percabangan (if/else) JavaScript.
Didesain untuk dipakai **offline, di satu jaringan WiFi lokal** (tanpa
internet) - satu laptop jadi server + layar proyektor, siswa buka dari HP
masing-masing.

## Apa yang berubah dari versi sebelumnya

1. **Modernisasi dengan library, tetap stabil offline**
   - WebSocket server sekarang pakai library `ws` (populer, banyak dipakai
     produksi) menggantikan implementasi RFC6455 manual di `lib/wss.js`.
   - Kode room & ID peserta sekarang pakai `nanoid` menggantikan fungsi acak
     buatan sendiri.
   - Semua library ini berjalan **di server Node lokal kamu** - tidak ada
     panggilan ke internet sama sekali saat main. Selama laptop & HP siswa
     terhubung ke WiFi/hotspot yang sama, aplikasi tetap jalan walau WiFi itu
     sendiri tidak tersambung ke internet.
   - Logika room/skor dipisah ke `lib/game.js` (murni logic, gampang dites)
     dari `server.js` (HTTP + WebSocket transport).

2. **CSS dirapikan & diseragamkan**
   - Semua ukuran teks & jarak (spacing) yang sebelumnya ditulis inline
     berbeda-beda di tiap halaman (mis. judul "Hasil akhir" 26px di satu
     halaman, 30px di halaman lain) sekarang pakai variabel & class utility
     yang sama: `--fs-*`, `--space-*`, `.page-title`, `.card-title`,
     `.text-small`, `.gap-3`, dst (lihat `public/css/app.css`).
   - Hampir semua `style="..."` inline di HTML sudah diganti dengan class
     supaya tampilan antar halaman (index, host, play, memory) konsisten.
   - Layout kartu host (soal & jawaban) dan grid lobby sekarang pakai CSS
     Grid (`.lobby-grid`, `.game-grid`, `.reveal-grid`) yang otomatis
     menyesuaikan lebar layar, tanpa JavaScript.

3. **Perbaikan bug: blok kode di jawaban kepotong/ketinggian di HP**
   - Penyebabnya: kartu depan & belakang dulu diukur tingginya lewat
     JavaScript (`fitCard()` + `ResizeObserver`) tepat saat animasi flip
     3D (600ms) masih berjalan, sehingga tinggi yang terukur salah dan
     kadang membuat sisi jawaban (dengan blok kode) tampak terlalu tinggi
     dan terpotong - meski di layar besar tampak normal karena kebetulan
     ukurannya cukup longgar.
   - Perbaikannya murni CSS: sisi depan & belakang kartu sekarang ditumpuk
     dengan **CSS Grid** (`grid-template-areas`) sehingga tingginya otomatis
     mengikuti konten terpanjang, tanpa perlu diukur/dipaksa lewat
     JavaScript sama sekali. Sudah diuji otomatis dengan Playwright memakai
     emulasi iPhone SE pada soal "Cari Bug" (blok kode terpanjang) - lihat
     `test/mobile-reveal-test.mjs`.

## Menjalankan

```bash
npm install     # sekali saja, butuh akses internet untuk npm install
npm start        # atau: node server.js
# custom port: PORT=9000 npm start
```

Server akan menampilkan alamat untuk guru (`/host`) dan alamat LAN untuk
siswa. Pastikan laptop & HP siswa berada di WiFi/hotspot yang sama.

Halaman yang tersedia:
- `/` - beranda
- `/host` - layar guru / proyektor
- `/play` - halaman peserta (dibuka dari HP)
- `/memory` - latihan mandiri (memory match), tanpa perlu room

## Menambah bank soal baru (mis. SQL, materi lain)

Soal tidak lagi hardcode ke satu file. Setiap file `.json` di folder
`banks/` otomatis jadi satu pilihan "Bank soal" di dropdown lobby guru (di
`/host`), tanpa perlu ubah kode sama sekali:

1. Buat file baru, mis. `banks/sql-dasar.json`, isinya array soal dengan
   skema yang sama seperti `banks/js-dasar.json` / `banks/html-dasar.json`
   (`id`, `type`, `level`, `lang` opsional, `prompt`, `code`, `options`,
   `answer`, `explanation`, `timeLimit`).
2. Restart server (`npm start` ulang).
3. Nama file otomatis jadi label rapi di dropdown - `sql-dasar.json` tampil
   sebagai "SQL Dasar", `js-dasar.json` sebagai "JS Dasar", dst. Kata-kata
   umum (js, html, sql, css, php, api, json) otomatis huruf besar semua.
4. Kalau file JSON tidak valid atau kosong, server akan melewatinya dan
   menampilkan peringatan di terminal saat start, bukan crash - bank lain
   tetap jalan normal.

Guru tinggal pilih bank yang mau dipakai dari dropdown sebelum menekan
"Mulai kuis"; jumlah soal maksimal & tombol jenis kartu otomatis menyesuaikan
bank yang dipilih.

## Struktur folder

```
server.js            HTTP static server + WebSocket (pakai `ws`)
lib/game.js          Logika room, skor, alur soal (pakai `nanoid`)
banks/*.json         Bank-bank soal, satu file per mata pelajaran
public/index.html    Beranda
public/host.html     Layar guru
public/play.html     Halaman peserta
public/memory.html   Memory match (latihan mandiri)
public/js/common.js  Util bersama: koneksi WS, highlight kode, render kartu opsi/leaderboard
public/css/app.css   Semua styling (variabel, komponen, utility class)
test/mobile-reveal-test.mjs   Uji otomatis (Playwright) untuk bug reveal di HP
```

## Menguji ulang

```bash
node server.js &            # jalankan server dulu
node test/mobile-reveal-test.mjs
```

Script ini men-drive satu host + satu peserta (emulasi iPhone SE) sampai
tahap reveal jawaban, lalu memeriksa bahwa blok kode di kartu jawaban tetap
sepenuhnya terlihat (tidak kepotong), dan menyimpan screenshot bukti di
`test/shot-player-reveal.png` dan `test/shot-host-reveal.png`.
