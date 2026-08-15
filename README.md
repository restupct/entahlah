# Branch Battle (v2 - refactor)

Kuis flip-card real-time untuk melatih percabangan (if/else) JavaScript.
Didesain untuk dipakai **offline, di satu jaringan WiFi lokal** (tanpa
internet) - satu laptop jadi server + layar proyektor, siswa buka dari HP
masing-masing.

## Mode permainan

Dipilih guru di lobby `/host` lewat dropdown **Mode permainan**, sebelum
menekan "Mulai kuis".

### 1. Klasik (default)

Seperti versi sebelumnya, perilakunya tidak berubah sedikit pun:

- Semua siswa mulai dari 0 poin.
- Jawaban benar = 100 poin + bonus cepat (maks 100) + bonus beruntun
  (10 per streak, maks 50).
- Salah atau tidak menjawab = 0 poin, tidak ada pengurangan.

### 2. Taruhan Poin

Menambah satu keputusan sebelum menjawab: *seberapa yakin kamu?*

- Tiap siswa mulai dengan **modal 300 poin**.
- Setiap kartu punya dua tahap:
  1. **Fase taruhan (10 detik).** **Pilihan jawaban belum dikirim ke HP siswa
     maupun ke layar guru**; seberapa banyak isi soal yang ikut ditampilkan
     diatur lewat dropdown **Info saat taruhan** (lihat di bawah).
     Siswa memilih taruhan **50, 100, atau 200 poin**. Nominal yang lebih
     besar dari poin yang dia punya tidak ditawarkan. Kalau tidak memilih
     sampai waktu habis, taruhannya otomatis nominal terkecil - jadi "diam
     saja" bukan strategi bebas risiko. Kalau semua siswa sudah memasang
     taruhan, tahap berikutnya langsung dibuka tanpa menunggu sisa waktu.
  2. **Fase menjawab.** Soal lengkap + pilihan jawaban muncul dengan batas
     waktu normal (`timeLimit` soal), dan jawaban masih boleh diganti sampai
     waktu habis, sama seperti mode klasik.
- Perhitungan poin:
  - **Benar** = `+taruhan` + bonus cepat (maks **25% dari taruhan**) + bonus
    beruntun (10 per streak, maks 50).
  - **Salah** = `-taruhan`.
  - **Tidak menjawab padahal sudah bertaruh** = taruhan hangus penuh.
  - **Poin tidak pernah minus.** Skor dilantai di 0 setiap kali jawaban
    dibuka, jadi siswa yang sedang sial tetap punya sesuatu untuk
    dipertaruhkan di kartu berikutnya (minimal selalu boleh taruh 50).
- Di layar guru, saat jawaban dibuka ada tambahan panel **Taruhan kelas**
  (berapa siswa yang taruh 50 / 100 / 200) - enak dipakai bahan diskusi:
  "yang tadi taruh 200, kenapa yakin?"

Mengganti mode saat masih di lobby otomatis menyetel ulang poin awal semua
peserta (300 untuk mode taruhan, 0 untuk klasik).

#### Info saat taruhan (3 level)

Dropdown ini cuma muncul kalau mode Taruhan Poin dipilih, dan menentukan
seberapa banyak yang boleh dilihat siswa **selama fase taruhan saja** - di
fase menjawab, soal selalu tampil lengkap:

| Pilihan | Yang dilihat siswa | Rasanya |
| --- | --- | --- |
| **Soal penuh** (default) | Pertanyaan + blok kode | Taruhan = penilaian atas soal yang benar-benar dibaca. Paling adil, tapi butuh waktu baca. |
| **Petunjuk** | Pertanyaan + petunjuk singkat, kode ditahan | Jalan tengah: siswa tahu topiknya, tapi belum bisa menghitung jawabannya. |
| **Buta** | Cuma jenis kartu & levelnya | Paling cepat & paling seru, tapi lebih untung-untungan. Cocok untuk ronde pemanasan. |

Petunjuk **tidak dibuat otomatis dari kode**, melainkan ditulis manual per
soal di field `clue` bank soal. Ini disengaja: ringkasan otomatis gampang
membocorkan jawaban (mis. menyebut operator yang justru jadi kunci di soal
"Cari Bug"). Contoh:

```json
{
  "id": "c03",
  "type": "fix-bug",
  "prompt": "Kode ini harusnya mencetak \"Lulus\" saat nilai 75. Kenapa tidak?",
  "clue": "Cuma 3 baris, dan sumber masalahnya ada di dalam kurung if.",
  "code": "..."
}
```

Soal yang belum punya `clue` tetap bisa dimainkan - siswa cuma diberi tahu
bahwa kartu itu tanpa petunjuk, dan bertaruh berdasarkan jenis kartu &
levelnya. Semua soal bawaan (`js-dasar`, `html-dasar`) sudah punya `clue`.

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
   (`id`, `type`, `level`, `lang` opsional, `prompt`, `clue` opsional,
   `code`, `options`, `answer`, `explanation`, `timeLimit`).
2. Restart server (`npm start` ulang).
3. Nama file otomatis jadi label rapi di dropdown - `sql-dasar.json` tampil
   sebagai "SQL Dasar", `js-dasar.json` sebagai "JS Dasar", dst. Kata-kata
   umum (js, html, sql, css, php, api, json) otomatis huruf besar semua.
4. Kalau file JSON tidak valid atau kosong, server akan melewatinya dan
   menampilkan peringatan di terminal saat start, bukan crash - bank lain
   tetap jalan normal.

Guru tinggal pilih bank yang mau dipakai dari dropdown sebelum menekan
"Mulai kuis"; jumlah soal maksimal & tombol jenis kartu otomatis menyesuaikan
bank yang dipilih. Semua bank soal bisa dipakai di kedua mode permainan -
mode taruhan tidak butuh format soal khusus (`clue` cuma dipakai kalau guru
memilih level info "Petunjuk").

## Struktur folder

```
server.js            HTTP static server + WebSocket (pakai `ws`)
lib/game.js          Logika room, skor, mode permainan, alur soal (pakai `nanoid`)
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

Catatan: tes ini memakai mode **Klasik** (mode default), jadi tetap valid
tanpa perubahan. Tes otomatis khusus mode Taruhan Poin (fase taruhan ->
jawab -> cek poin hangus, termasuk 3 level info taruhan) belum ada dan masih
jadi TODO.
