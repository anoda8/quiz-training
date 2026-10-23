// ====== Konfigurasi ======
const URL_PAKET = "paket.php";   // daftar paket soal (isi folder soal/)
const FOLDER_SOAL = "soal/";     // folder berisi paket soal (.json)
const URL_RIWAYAT = "riwayat.php";
const URL_SIMPAN = "simpan.php"; // relatif, satu folder dengan index.html
const KUNCI_CACHE = "kuis:progres";

// ====== State aplikasi ======
let dataKuis = null;
let indeks = 0;
let jawabanUser = [];      // indeks pilihan tiap soal (null jika belum dijawab)
let namaPeserta = "";
let mulaiWaktu = null;     // waktu mulai (ISO string)
let idHasil = null;        // ID unik hasil, dipakai agar kirim ulang tidak menggandakan data
let cacheTersimpan = null;
let daftarPaket = [];      // [{id, judul, deskripsi, jumlah}] dari paket.php
let paketId = null;        // nama file paket yang sedang dikerjakan (tanpa .json)
let urutan = [];           // urutan tampil: urutan[posisi] = nomor soal asli di paket (jawabanUser memakai nomor asli)

// ====== Helper DOM ======
const $ = (id) => document.getElementById(id);

// Pengaman: pastikan index.html dan quiz.js berasal dari versi yang sama
const ID_WAJIB = [
  "badge-materi",
  "bar-progres",
  "blok-lanjut",
  "blok-mulai",
  "btn-baru",
  "btn-berikutnya",
  "btn-lanjut",
  "btn-muat-riwayat",
  "btn-mulai",
  "btn-sebelumnya",
  "btn-selesai",
  "btn-ulangi",
  "cek-acak",
  "daftar-opsi",
  "daftar-pembahasan",
  "deskripsi-paket",
  "font-besar",
  "font-kecil",
  "font-normal",
  "hasil-paket",
  "input-nama",
  "kotak-nomor",
  "layar-error",
  "layar-hasil",
  "layar-muat",
  "layar-mulai",
  "layar-soal",
  "nama-paket-soal",
  "pilih-paket",
  "riwayat-isi",
  "riwayat-status",
  "riwayat-wrap",
  "skor-angka",
  "skor-ringkas",
  "status-simpan",
  "teks-lanjut",
  "teks-pertanyaan",
  "teks-progres",
  "teks-terjawab",
  "wrap-materi",
];
const idHilang = ID_WAJIB.filter((id) => !document.getElementById(id));
if (idHilang.length) {
  const muat = document.getElementById("layar-muat");
  if (muat) muat.classList.add("d-none");
  document.body.insertAdjacentHTML("afterbegin",
    '<div class="alert alert-danger m-3" role="alert"><strong>index.html dan quiz.js tidak cocok (beda versi).</strong><br>' +
    "Salin ulang <strong>kedua</strong> file versi terbaru ke folder Laragon, lalu muat ulang dengan Ctrl+F5.<br>" +
    "<small>Elemen yang tidak ditemukan di index.html: " + idHilang.join(", ") + "</small></div>");
  throw new Error("Versi index.html dan quiz.js tidak cocok: " + idHilang.join(", "));
}
const layar = {
  muat: $("layar-muat"),
  error: $("layar-error"),
  mulai: $("layar-mulai"),
  soal: $("layar-soal"),
  hasil: $("layar-hasil"),
};

function tampilkan(nama) {
  Object.entries(layar).forEach(([k, el]) => el.classList.toggle("d-none", k !== nama));
  // layar soal dibuat lebih lebar agar ada ruang untuk navigasi di sisi kanan
  document.querySelector(".kartu-kuis").classList.toggle("lebar", nama === "soal");
}

function esc(teks) {
  const d = document.createElement("div");
  d.textContent = teks;
  return d.innerHTML;
}

// ====== Urutan soal (acak) ======
function urutanAsli(n) {
  return Array.from({ length: n }, (_, i) => i);
}

function acak(arr) {  // Fisher-Yates
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function urutanValid(u, n) {
  return Array.isArray(u) && u.length === n && new Set(u).size === n &&
         u.every((x) => Number.isInteger(x) && x >= 0 && x < n);
}

// ====== Cache (localStorage) ======
function simpanCache() {
  try {
    localStorage.setItem(KUNCI_CACHE, JSON.stringify({
      paket: paketId,
      total: dataKuis.soal.length,
      nama: namaPeserta,
      indeks: indeks,
      urutan: urutan,
      jawaban: jawabanUser,
      mulai: mulaiWaktu,
    }));
  } catch (e) { /* penyimpanan penuh atau diblokir: abaikan */ }
}

function bacaCache() {
  try {
    const raw = localStorage.getItem(KUNCI_CACHE);
    if (!raw) return null;
    const c = JSON.parse(raw);
    const cocok = c && typeof c.paket === "string" && Number.isInteger(c.total) &&
                  Array.isArray(c.jawaban) && c.jawaban.length === c.total &&
                  daftarPaket.some((p) => p.id === c.paket);  // paketnya masih ada di folder soal/
    if (!cocok) { hapusCache(); return null; }
    return c;
  } catch (e) {
    return null;
  }
}

function hapusCache() {
  try { localStorage.removeItem(KUNCI_CACHE); } catch (e) { /* abaikan */ }
}

// ====== Muat daftar paket dan isi paket ======
function parseJson(teks) {
  return JSON.parse(teks.replace(/^\uFEFF/, ""));  // buang BOM jika ada
}

async function muatDaftarPaket() {
  try {
    const res = await fetch(URL_PAKET, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("paket.php tidak bisa diakses (status " + res.status +
        "). Pastikan file ada di folder yang sama dengan index.html.");
    }
    const teks = await res.text();
    let d;
    try {
      d = parseJson(teks);
    } catch (e) {
      throw new Error("jawaban paket.php bukan JSON. Isinya: " + teks.slice(0, 150).replace(/\s+/g, " "));
    }
    daftarPaket = Array.isArray(d.paket) ? d.paket : [];
    if (daftarPaket.length === 0) {
      throw new Error("Belum ada paket soal. Taruh file soal berformat .json di folder " + FOLDER_SOAL);
    }
    siapkanHalamanMulai();
  } catch (err) {
    layar.error.innerHTML =
      "<strong>Paket soal tidak bisa dimuat.</strong><br>" + esc(err.message) +
      "<br><small>Buka lewat Laragon, misalnya <code>http://localhost/kuis/</code>.</small>";
    tampilkan("error");
  }
}

async function muatPaket(id) {
  const res = await fetch(FOLDER_SOAL + encodeURIComponent(id) + ".json", { cache: "no-store" });
  if (!res.ok) throw new Error("gagal memuat paket soal (status " + res.status + ")");
  const d = parseJson(await res.text());
  if (!Array.isArray(d.soal) || d.soal.length === 0) {
    throw new Error("data soal kosong atau formatnya tidak sesuai");
  }
  paketId = id;
  dataKuis = d;
}

function namaPaket(id) {
  const p = daftarPaket.find((x) => x.id === id);
  return p ? p.judul : id;
}

// ====== Halaman mulai ======
function isiPilihanPaket() {
  const sel = $("pilih-paket");
  const dipilih = sel.value;
  sel.innerHTML = "";
  const placeholder = new Option("— Pilih paket soal —", "");
  placeholder.disabled = true;
  sel.add(placeholder);
  daftarPaket.forEach((p) => sel.add(new Option(p.judul + " (" + p.jumlah + " soal)", p.id)));
  const masihAda = daftarPaket.some((p) => p.id === dipilih);
  sel.value = masihAda ? dipilih : (daftarPaket.length === 1 ? daftarPaket[0].id : "");
  tampilDeskripsiPaket();
}

function tampilDeskripsiPaket() {
  const p = daftarPaket.find((x) => x.id === $("pilih-paket").value);
  $("deskripsi-paket").textContent = p ? (p.deskripsi || "") : "";
}

function siapkanHalamanMulai() {
  $("input-nama").value = namaPeserta;
  isiPilihanPaket();

  cacheTersimpan = bacaCache();
  if (cacheTersimpan) {
    const terjawab = cacheTersimpan.jawaban.filter((j) => j !== null).length;
    $("teks-lanjut").textContent =
      "Ada pengerjaan yang belum selesai: paket \u201C" + namaPaket(cacheTersimpan.paket) + "\u201D atas nama " +
      (cacheTersimpan.nama || "(tanpa nama)") + " (" + terjawab + " dari " + cacheTersimpan.total + " soal terjawab).";
    $("blok-lanjut").classList.remove("d-none");
    $("blok-mulai").classList.add("d-none");
  } else {
    $("blok-lanjut").classList.add("d-none");
    $("blok-mulai").classList.remove("d-none");
  }
  tampilkan("mulai");
  muatRiwayat();
}

// ====== Catatan hasil di halaman awal ======
function formatWaktu(iso) {
  const t = new Date(iso);
  return isNaN(t) ? "-" : t.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

async function muatRiwayat() {
  const st = $("riwayat-status");
  const wrap = $("riwayat-wrap");
  st.textContent = "Memuat catatan…";
  wrap.classList.add("d-none");
  try {
    const res = await fetch(URL_RIWAYAT, { cache: "no-store" });
    if (!res.ok) {
      throw new Error("riwayat.php tidak bisa diakses (status " + res.status +
        "). Pastikan file ada di folder yang sama dengan index.html.");
    }
    const teks = await res.text();
    let d;
    try {
      d = JSON.parse(teks.replace(/^\uFEFF/, ""));
    } catch (e) {
      throw new Error("jawaban riwayat.php bukan JSON. Isinya: " + teks.slice(0, 150).replace(/\s+/g, " "));
    }
    if (!d.data || d.data.length === 0) {
      st.textContent = "Belum ada hasil yang tersimpan. Catatan muncul setelah ada peserta yang menyelesaikan kuis.";
      return;
    }
    $("riwayat-isi").innerHTML = d.data.map((r, i) =>
      "<tr><td>" + (i + 1) + "</td><td>" + esc(String(r.nama)) + "</td><td>" + esc(String(r.paket || "-")) + '</td><td class="text-nowrap">' +
      esc(formatWaktu(r.waktu)) + '</td><td class="text-end fw-semibold">' + esc(String(r.nilai)) +
      '</td><td class="text-end">' + esc(r.benar + "/" + r.total) + "</td></tr>"
    ).join("");
    st.textContent = d.total > d.data.length
      ? "Menampilkan " + d.data.length + " dari " + d.total + " hasil terbaru."
      : d.total + " hasil tersimpan.";
    wrap.classList.remove("d-none");
  } catch (err) {
    st.textContent = "Catatan hasil tidak bisa dimuat: " + err.message;
  }
}

// ====== Mulai / lanjutkan ======
async function mulaiKuis() {
  const nama = $("input-nama").value.trim();
  const id = $("pilih-paket").value;
  $("input-nama").classList.toggle("is-invalid", !nama);
  $("pilih-paket").classList.toggle("is-invalid", !id);
  if (!id) { $("pilih-paket").focus(); return; }
  if (!nama) { $("input-nama").focus(); return; }

  const tombol = $("btn-mulai");
  tombol.disabled = true;
  try {
    await muatPaket(id);
  } catch (err) {
    alert("Paket soal tidak bisa dimuat: " + err.message);
    return;
  } finally {
    tombol.disabled = false;
  }

  namaPeserta = nama;
  indeks = 0;
  jawabanUser = new Array(dataKuis.soal.length).fill(null);
  urutan = $("cek-acak").checked ? acak(urutanAsli(dataKuis.soal.length)) : urutanAsli(dataKuis.soal.length);
  mulaiWaktu = new Date().toISOString();
  simpanCache();
  tampilkan("soal");
  renderSoal();
}

async function lanjutkanKuis() {
  const c = cacheTersimpan;
  try {
    await muatPaket(c.paket);
  } catch (err) {
    alert("Paket soal tidak bisa dimuat: " + err.message);
    return;
  }
  const n = dataKuis.soal.length;
  if (n !== c.total) {
    alert("Isi paket soal sudah berubah sejak terakhir dikerjakan, jadi pengerjaan tidak bisa dilanjutkan.");
    mulaiDariAwal();
    return;
  }
  namaPeserta = c.nama || "";
  indeks = Math.min(Math.max(parseInt(c.indeks, 10) || 0, 0), n - 1);
  jawabanUser = c.jawaban.map((j, i) =>
    Number.isInteger(j) && j >= 0 && j < dataKuis.soal[i].pilihan.length ? j : null
  );
  urutan = urutanValid(c.urutan, n) ? c.urutan : urutanAsli(n);
  mulaiWaktu = c.mulai || new Date().toISOString();
  tampilkan("soal");
  renderSoal();
}

function mulaiDariAwal() {
  hapusCache();
  cacheTersimpan = null;
  namaPeserta = "";
  siapkanHalamanMulai();
}

// ====== Tampilkan satu soal ======
function renderSoal() {
  const total = dataKuis.soal.length;
  const idx = urutan[indeks];            // nomor soal asli untuk posisi tampil ini
  const s = dataKuis.soal[idx];

  $("nama-paket-soal").textContent = dataKuis.judul || namaPaket(paketId);
  $("teks-progres").textContent = "Soal " + (indeks + 1) + " dari " + total;
  $("teks-terjawab").textContent = jumlahTerjawab() + " terjawab";
  $("bar-progres").style.width = ((indeks + 1) / total) * 100 + "%";
  $("teks-pertanyaan").textContent = s.pertanyaan;
  $("badge-materi").textContent = s.kategori || "";
  $("wrap-materi").classList.toggle("d-none", !s.kategori);

  const wadah = $("daftar-opsi");
  wadah.innerHTML = "";
  s.pilihan.forEach((teks, i) => {
    const el = document.createElement("div");
    el.className = "opsi list-group-item d-flex align-items-center p-3";
    if (jawabanUser[idx] === i) el.classList.add("terpilih");
    el.setAttribute("role", "button");
    el.setAttribute("tabindex", "0");
    el.innerHTML = '<span class="huruf">' + String.fromCharCode(65 + i) + "</span><span>" + esc(teks) + "</span>";
    el.addEventListener("click", () => pilih(i));
    el.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); pilih(i); }
    });
    wadah.appendChild(el);
  });

  const terakhir = indeks === total - 1;
  $("btn-sebelumnya").disabled = indeks === 0;
  $("btn-berikutnya").classList.toggle("d-none", terakhir);
  $("btn-selesai").classList.toggle("d-none", !terakhir);
  renderNomor();
}

// Kotak navigasi nomor soal: hijau = sudah dijawab, bergaris = belum, cincin biru = soal saat ini
function renderNomor() {
  const wadah = $("kotak-nomor");
  wadah.innerHTML = "";
  dataKuis.soal.forEach((_, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = i + 1;
    btn.className = "btn btn-sm nomor " + (jawabanUser[urutan[i]] !== null ? "btn-success" : "btn-outline-secondary");
    if (i === indeks) {
      btn.classList.add("sekarang");
      btn.setAttribute("aria-current", "true");
    }
    btn.setAttribute("aria-label", "Soal " + (i + 1) + (jawabanUser[urutan[i]] !== null ? ", sudah dijawab" : ", belum dijawab"));
    btn.addEventListener("click", () => {
      indeks = i;
      simpanCache();
      renderSoal();
    });
    wadah.appendChild(btn);
  });
}

function pilih(i) {
  jawabanUser[urutan[indeks]] = i;
  simpanCache();          // simpan setiap kali menjawab
  renderSoal();
}

function jumlahTerjawab() {
  return jawabanUser.filter((j) => j !== null).length;
}

// ====== Navigasi ======
function berikutnya() {
  if (indeks < dataKuis.soal.length - 1) { indeks++; simpanCache(); renderSoal(); }
}
function sebelumnya() {
  if (indeks > 0) { indeks--; simpanCache(); renderSoal(); }
}

function selesai() {
  const kosong = dataKuis.soal.length - jumlahTerjawab();
  if (kosong > 0 && !confirm(kosong + " soal belum dijawab. Tetap selesaikan kuis?")) return;

  idHasil = buatId();
  hapusCache();           // kuis selesai: hapus cache pengerjaan
  tampilkanHasil();
  kirimHasil();           // simpan hasil ke file di server
}

function buatId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return Date.now() + "-" + Math.random().toString(16).slice(2);
}

// ====== Kirim hasil ke server ======
async function kirimHasil() {
  const st = $("status-simpan");
  st.innerHTML =
    '<span class="spinner-border spinner-border-sm me-2" role="status"></span>Menyimpan hasil ke server…';

  try {
    const res = await fetch(URL_SIMPAN, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: idHasil,
        nama: namaPeserta,
        paket: paketId,
        mulai: mulaiWaktu,
        jawaban: jawabanUser,
      }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (!data.error && (res.status === 404 || res.status === 405 || res.status === 501)) {
        throw new Error("endpoint penyimpanan tidak ditemukan (status " + res.status + "). " +
          "Pastikan simpan.php ada di folder yang sama dengan index.html dan halaman dibuka lewat Laragon (http://localhost/...).");
      }
      throw new Error(data.error || "Server menjawab status " + res.status);
    }
    st.innerHTML = '<div class="alert alert-success py-2 mb-0">Hasil tersimpan di server.</div>';
  } catch (err) {
    st.innerHTML =
      '<div class="alert alert-warning py-2 mb-0">Hasil belum tersimpan di server: ' + esc(err.message) +
      ' <button id="btn-coba-lagi" class="btn btn-sm btn-outline-dark ms-2">Coba lagi</button></div>';
    $("btn-coba-lagi").addEventListener("click", kirimHasil);
  }
}

// ====== Hasil dan pembahasan ======
function tampilkanHasil() {
  const total = dataKuis.soal.length;
  let benar = 0;
  dataKuis.soal.forEach((s, i) => { if (jawabanUser[i] === s.jawaban) benar++; });
  const nilai = Math.round((benar / total) * 100);

  $("skor-angka").textContent = nilai;
  $("skor-ringkas").textContent = benar + " benar dari " + total + " soal";
  $("hasil-paket").textContent = "Paket: " + (dataKuis.judul || namaPaket(paketId));

  const wadah = $("daftar-pembahasan");
  wadah.innerHTML = "";

  urutan.forEach((idx, i) => {           // pembahasan mengikuti urutan soal yang dikerjakan
    const s = dataKuis.soal[idx];
    const jawab = jawabanUser[idx];
    const betul = jawab === s.jawaban;

    let opsiHtml = "";
    s.pilihan.forEach((teks, j) => {
      let kelas = "opsi list-group-item d-flex align-items-center p-2";
      if (j === s.jawaban) kelas += " benar";
      else if (j === jawab) kelas += " salah";
      opsiHtml += '<div class="' + kelas + '" style="cursor:default"><span class="huruf">' +
        String.fromCharCode(65 + j) + "</span><span>" + esc(teks) + "</span></div>";
    });

    const status = jawab === null
      ? '<span class="badge text-bg-secondary">Tidak dijawab</span>'
      : betul
        ? '<span class="badge text-bg-success">Benar</span>'
        : '<span class="badge text-bg-danger">Salah</span>';

    const penjelasan = s.penjelasan
      ? '<div class="alert alert-light border mt-3 mb-0 small">' + esc(s.penjelasan) + "</div>"
      : "";

    wadah.insertAdjacentHTML("beforeend",
      '<div class="card shadow-sm mb-3"><div class="card-body">' +
      (s.kategori ? '<div class="small text-muted mb-1">' + esc(s.kategori) + '</div>' : '') +
      '<div class="d-flex justify-content-between align-items-start mb-3">' +
      '<h3 class="h6 mb-0 me-3">' + (i + 1) + ". " + esc(s.pertanyaan) + "</h3>" + status + "</div>" +
      opsiHtml + penjelasan + "</div></div>");
  });

  tampilkan("hasil");
  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ====== Ukuran font (tombol A- / A / A+) ======
const KUNCI_FONT = "kuis:font";
const LEVEL_FONT = [85, 100, 115, 130, 150]; // persen dari ukuran normal (100 = normal)
let levelFont = 1;

function terapkanFont() {
  document.documentElement.style.fontSize = LEVEL_FONT[levelFont] + "%";
  $("font-kecil").disabled = levelFont === 0;
  $("font-besar").disabled = levelFont === LEVEL_FONT.length - 1;
  $("font-normal").classList.toggle("active", levelFont === 1);
  try { localStorage.setItem(KUNCI_FONT, String(levelFont)); } catch (e) { /* abaikan */ }
}

function muatFont() {
  try {
    const v = parseInt(localStorage.getItem(KUNCI_FONT), 10);
    if (v >= 0 && v < LEVEL_FONT.length) levelFont = v;
  } catch (e) { /* abaikan */ }
  terapkanFont();
}

function ubahFont(arah) {
  levelFont = Math.min(Math.max(levelFont + arah, 0), LEVEL_FONT.length - 1);
  terapkanFont();
}

// ====== Event listener ======
$("btn-mulai").addEventListener("click", mulaiKuis);
$("input-nama").addEventListener("keydown", (e) => { if (e.key === "Enter") mulaiKuis(); });
$("btn-lanjut").addEventListener("click", lanjutkanKuis);
$("pilih-paket").addEventListener("change", () => {
  $("pilih-paket").classList.remove("is-invalid");
  tampilDeskripsiPaket();
});
$("btn-muat-riwayat").addEventListener("click", muatRiwayat);
$("btn-baru").addEventListener("click", mulaiDariAwal);
$("btn-berikutnya").addEventListener("click", berikutnya);
$("btn-sebelumnya").addEventListener("click", sebelumnya);
$("btn-selesai").addEventListener("click", selesai);
$("btn-ulangi").addEventListener("click", siapkanHalamanMulai);
$("font-kecil").addEventListener("click", () => ubahFont(-1));
$("font-besar").addEventListener("click", () => ubahFont(1));
$("font-normal").addEventListener("click", () => { levelFont = 1; terapkanFont(); });

// ====== Jalankan ======
muatFont();
muatDaftarPaket();
