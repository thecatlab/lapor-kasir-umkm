# LaporKasir

Aplikasi web ringan untuk menghitung kas, mencatat pengeluaran, dan membuat laporan rekonsiliasi harian untuk UMKM. Antarmuka berbahasa Indonesia, menggunakan format Rupiah, dan dapat dijalankan tanpa proses build.

## Fitur

- Menghitung kas awal dan akhir berdasarkan pecahan Rp500–Rp100.000.
- Mencatat nama barang, jumlah, satuan, dan total pengeluaran.
- Merekonsiliasi kas, QRIS/transfer, setoran tunai, pendapatan lain-lain, dan total Qasir.
- Menyimpan draf secara otomatis di browser.
- Menyalin laporan teks, mengunduh PNG, dan berbagi melalui menu perangkat.
- Menyimpan laporan ke Google Sheets dan gambar ke Google Drive melalui Google Apps Script.
- Mendeteksi laporan duplikat dan mencatat revisi untuk laporan yang berubah pada tanggal yang sama.

Qasir adalah nilai pembanding yang dimasukkan manual; tidak ada integrasi API Qasir. WhatsApp dan berbagi gambar bergantung pada dukungan browser/perangkat.

## Menjalankan secara lokal

Gunakan Node.js 20+ untuk server lokal dan pengujian. Tidak perlu memasang dependensi npm.

```sh
git clone https://github.com/thecatlab/lapor-kasir-umkm.git
cd lapor-kasir-umkm
node scripts/serve.mjs
```

Buka [http://127.0.0.1:8000](http://127.0.0.1:8000). Server hanya menerima koneksi lokal dan menyajikan aset browser, bukan seluruh repositori.

Tanpa konfigurasi cloud, pencatatan, perhitungan, dan penyalinan laporan tetap tersedia. **Laporkan** dan **Simpan** mencoba menyimpan ke cloud terlebih dahulu; jika belum dikonfigurasi atau gagal, dialog menyediakan pilihan untuk tetap berbagi atau mengunduh gambar secara lokal.

Stylesheet Tailwind sudah disertakan di `assets/styles.css`. Internet diperlukan untuk html2canvas dan Google Fonts. Gunakan browser modern dengan HTTPS atau localhost untuk clipboard dan menu berbagi. Membuka `index.html` sebagai `file://` tidak mendukung penyimpanan cloud.

## Konfigurasi Google Sheets dan Drive

### Backend

1. Buat folder Drive untuk gambar laporan dan proyek Google Apps Script milik pengelola.
2. Salin [apps-script/Code.gs](apps-script/Code.gs) ke editor Apps Script.
3. Buka **Project Settings → Script Properties** dan isi:

| Properti | Isi |
| --- | --- |
| `LAPORKASIR_DRIVE_FOLDER_ID` | ID folder Drive tujuan; hanya disimpan di server. |
| `LAPORKASIR_ACCESS_TOKEN` | Kode akses acak 32–256 karakter. Bagikan hanya kepada petugas berwenang. |
| `LAPORKASIR_ALLOWED_ORIGINS` | Origin frontend, dipisahkan koma, tanpa path atau garis miring di akhir. Contoh: `https://kasir.example.com,http://127.0.0.1:8000`. |
| `LAPORKASIR_SPREADSHEET_ID` | ID spreadsheet yang ada. Opsional untuk instalasi baru; saat migrasi gunakan ID lama agar tujuan penyimpanan tetap sama. |

Gunakan pembuat kata sandi acak dari password manager untuk kode akses. Jangan memasukkannya ke HTML, `config.js`, URL, atau Git.

4. Jalankan `authorizeLaporKasir_()` secara manual di editor dan berikan izin Sheets/Drive. Jika ID spreadsheet belum diisi, fungsi ini membuat **LaporKasir Data** dan menyimpan ID-nya di Script Properties. Akhiran garis bawah mencegah pemanggilan fungsi setup dari browser.
5. Deploy sebagai **Web app** yang berjalan sebagai pemilik proyek. Batasi akses Google sesuai lingkungan pengguna. Jika form dari situs statis memerlukan akses **Anyone**, kode akses aplikasi tetap wajib dan diverifikasi sebelum penulisan.
6. Simpan URL deployment yang berakhiran `/exec`. Publikasikan versi deployment baru setiap kali memperbarui kode Apps Script.

Izin deployment Google dan kode akses aplikasi adalah lapisan berbeda. Pembatasan akun Google dapat menampilkan login/otorisasi di iframe; uji dengan akun petugas. Daftar origin membatasi tujuan respons, bukan menggantikan autentikasi.

### Frontend

Salin `config.example.js` menjadi `config.js`, lalu isi:

```js
window.LAPORKASIR_CONFIG = {
    googleScriptUrl: 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec'
};
```

`config.js` diabaikan Git. Saat hosting, sediakan file ini bersama `index.html` dan `assets/styles.css` melalui proses deployment. Semua adalah aset publik: URL backend terlihat oleh pengunjung dan tidak boleh dianggap sebagai rahasia.

Pada penyimpanan pertama, petugas memasukkan kode akses. Kode hanya diingat dalam memori halaman dan dibersihkan saat halaman dimuat ulang atau data di-reset. Kode tidak masuk ke draf, spreadsheet, atau ekspor. Kesalahan autentikasi meminta kode ulang pada percobaan berikutnya.

### Deployment GitHub Pages

Workflow `.github/workflows/pages.yml` membuat `config.js` saat deployment sehingga file lokal yang diabaikan Git tidak hilang dari situs.

1. Di **Settings → Secrets and variables → Actions → Variables**, isi repository variable `LAPORKASIR_GOOGLE_SCRIPT_URL` dengan URL deployment Apps Script yang sama.
2. Di **Settings → Pages → Build and deployment**, pilih **GitHub Actions**.
3. Push ke `main` atau jalankan workflow **Deploy cashier site**. Workflow menguji aplikasi, memvalidasi URL, lalu memublikasikan hanya `index.html`, `config.js`, dan `assets/styles.css`.

Jangan isi access token di repository variable tersebut. URL deployment memang akan terlihat di browser; token tetap hanya di Script Properties dan memori sesi kasir.

Pada tab **Laporan**, tombol **Periksa koneksi penyimpanan** memverifikasi akses ke spreadsheet dan folder yang sudah dikonfigurasi tanpa membuat laporan atau file. Ini bukan uji penulisan; uji penyimpanan penuh harus menggunakan lingkungan pengujian terpisah.

### Migrasi dari versi sebelumnya

Perbarui frontend dan backend bersama:

1. Pertahankan ID spreadsheet di Script Properties; jika belum ada, isi ID spreadsheet lama secara eksplisit. Backend tidak mencari spreadsheet berdasarkan nama.
2. Pindahkan ID folder lama ke `LAPORKASIR_DRIVE_FOLDER_ID`, lalu atur kode akses dan origin.
3. Deploy backend terbaru dan sediakan frontend beserta `config.js` yang cocok.
4. Nonaktifkan deployment lama yang menerima penulisan tanpa autentikasi. Menghapus URL dari kode terbaru tidak menghapus riwayat Git atau menutup endpoint lama.
5. Uji dengan laporan sintetis di spreadsheet/folder pengujian sebelum digunakan secara operasional.

Draf lama tetap dibaca melalui kunci `localStorage` sebelumnya. Tidak ada migrasi atau penghapusan data kas lokal.

Permintaan dari browser tidak boleh membuat spreadsheet pengganti. Jika ID tujuan hilang, penyimpanan gagal dengan aman; pembuatan spreadsheet baru hanya tersedia melalui fungsi setup yang dijalankan pengelola di editor.

## Penggunaan dan perhitungan

1. Isi jumlah uang pada tab **Awal** dan **Akhir**.
2. Tambahkan biaya pada **Pengeluaran**.
3. Periksa tanggal, QRIS/transfer, pendapatan lain-lain, setoran tunai, total Qasir, dan catatan pada **Laporan**.
4. Pilih **Laporkan** untuk menyimpan lalu berbagi, **Simpan** untuk menyimpan lalu mengunduh PNG, atau **Salin** untuk menyalin teks tanpa mengirim ke cloud.

```text
Selisih kas       = Kas akhir − Kas awal
Pendapatan cash   = Selisih kas + Pengeluaran + Setor tunai
Total pendapatan  = Pendapatan cash + QRIS/transfer
Selisih akhir     = Total pendapatan − Total Qasir − Pendapatan lain-lain
```

Pendapatan lain-lain diasumsikan sudah termasuk dalam kas fisik akhir sehingga tidak ditambahkan lagi ke total pendapatan.

Sheet **Laporan** berisi ringkasan dan pecahan uang; **Pengeluaran** berisi rincian biaya. Fingerprint yang sama memperbarui baris laporan tanpa menambah pengeluaran; perubahan data pada tanggal yang sama menghasilkan revisi baru.

## Privasi dan batasan

- Draf tersimpan di `localStorage` tanpa enkripsi. Gunakan perangkat/profil tepercaya dan reset draf setelah selesai pada perangkat bersama. Reset tidak menghapus Sheets/Drive.
- Batasi akses spreadsheet dan folder Drive. Jangan membuat folder publik untuk mengunduh gambar.
- Jangan commit laporan operasional, screenshot transaksi, kredensial, atau ekspor database. Folder `private/`, `reports/`, `exports/`, dan `backups/` diabaikan Git.
- Batas permintaan: 12 MiB karakter JSON, 8 MiB karakter base64 gambar (sekitar 6 MiB data), dan 500 pengeluaran per laporan.
- Kode akses bersama tidak memberikan identitas per kasir atau perlindungan penuh terhadap penyalahgunaan kuota. Apps Script dan CDN tetap dependensi eksternal.

Lihat [SECURITY.md](SECURITY.md) untuk hasil peninjauan dan tindakan deployment.

## Struktur dan pengujian

```text
index.html               Antarmuka, perhitungan, draf, dan ekspor
assets/                  Sumber Tailwind dan stylesheet siap pakai
config.example.js        Contoh konfigurasi publik frontend
apps-script/Code.gs      Penyimpanan Sheets/Drive dan validasi akses
scripts/serve.mjs        Server lokal untuk aset browser
tests/security.test.cjs  Pengujian keamanan/regresi dengan mock Apps Script
SECURITY.md              Temuan keamanan dan panduan operasional
AGENTS.md                Pedoman kontribusi
```

```sh
node --test tests/*.test.cjs
git diff --check
```

Uji keempat tab, muat ulang draf, teks laporan, dan PNG pada desktop/ponsel. Untuk cloud, gunakan deployment pengujian sendiri dan periksa penyimpanan baru, duplikat, revisi, kode akses salah, serta kegagalan koneksi. Pengujian lokal memakai mock dan tidak mengirim data ke produksi.

Jika menambahkan atau mengganti kelas Tailwind, regenerasi stylesheet dan commit hasilnya:

```sh
npx --yes tailwindcss@3.4.17 -i assets/tailwind.css -o assets/styles.css --content index.html --minify
```

Build CSS hanya diperlukan saat mengembangkan tampilan, bukan saat menjalankan aplikasi.
