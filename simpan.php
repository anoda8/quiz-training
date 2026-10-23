<?php
// Menerima hasil kuis (POST JSON) dan menambahkannya ke hasil.json.
// Letakkan di folder yang sama dengan index.html dan quiz.js (paket soal ada di folder soal/).

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function jawab($kode, $data)
{
    http_response_code($kode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    jawab(405, ['error' => 'Gunakan metode POST']);
}

$raw = file_get_contents('php://input');
if ($raw === false || $raw === '' || strlen($raw) > 65536) {
    jawab(400, ['error' => 'Ukuran data tidak valid']);
}
$payload = json_decode($raw, true);
if (!is_array($payload)) {
    jawab(400, ['error' => 'Format JSON tidak valid']);
}

// --- Validasi input ---
$nama = $payload['nama'] ?? null;
$id = $payload['id'] ?? null;
$jawaban = $payload['jawaban'] ?? null;
$paket = $payload['paket'] ?? null;

if (!is_string($nama) || trim($nama) === '' || mb_strlen($nama) > 100) {
    jawab(400, ['error' => 'Nama tidak valid']);
}
if (!is_string($id) || $id === '' || strlen($id) > 64) {
    jawab(400, ['error' => 'ID tidak valid']);
}
if (!is_string($paket) || $paket === '' || strlen($paket) > 150) {
    jawab(400, ['error' => 'Paket soal tidak valid']);
}

$fileHasil = __DIR__ . '/hasil.json';

// Cari paket soal di folder soal/ (dicocokkan dengan daftar berkas, bukan disambung dari input)
$fileSoal = null;
foreach (glob(__DIR__ . '/soal/*.json') ?: [] as $f) {
    if (basename($f, '.json') === $paket) {
        $fileSoal = $f;
        break;
    }
}
if ($fileSoal === null) {
    jawab(400, ['error' => 'Paket soal "' . $paket . '" tidak ditemukan di server']);
}
$isiSoal = preg_replace('/^\xEF\xBB\xBF/', '', (string) file_get_contents($fileSoal)); // buang BOM UTF-8
$dataSoal = json_decode($isiSoal, true);
if (!is_array($dataSoal) || empty($dataSoal['soal'])) {
    jawab(500, ['error' => 'File paket soal tidak valid']);
}
$daftar = $dataSoal['soal'];

if (!is_array($jawaban) || count($jawaban) !== count($daftar)) {
    jawab(400, ['error' => 'Jumlah jawaban tidak sesuai jumlah soal']);
}
$jawaban = array_values($jawaban);
foreach ($jawaban as $i => $j) {
    if ($j !== null && !(is_int($j) && $j >= 0 && $j < count($daftar[$i]['pilihan']))) {
        jawab(400, ['error' => 'Ada jawaban yang tidak valid']);
    }
}

// --- Nilai dihitung ulang di server (tidak percaya skor dari browser) ---
$total = count($daftar);
$benar = 0;
foreach ($daftar as $i => $s) {
    if ($jawaban[$i] === $s['jawaban']) {
        $benar++;
    }
}
$nilai = (int) round($benar / $total * 100);

$rekaman = [
    'id' => $id,
    'nama' => trim($nama),
    'paket' => (isset($dataSoal['judul']) && is_string($dataSoal['judul']) && $dataSoal['judul'] !== '') ? $dataSoal['judul'] : $paket,
    'berkas' => $paket, // nama file paket (tanpa .json)
    'waktu' => gmdate('c'),
    'nilai' => $nilai,
    'benar' => $benar,
    'total' => $total,
    'jawaban' => $jawaban, // indeks pilihan tiap soal, null = tidak dijawab
];

// --- Simpan ke hasil.json (dikunci agar aman jika ada yang menyimpan bersamaan) ---
$fp = @fopen($fileHasil, 'c+');
if (!$fp) {
    jawab(500, ['error' => 'Tidak bisa menulis hasil.json (cek izin tulis folder)']);
}
flock($fp, LOCK_EX);
$isi = stream_get_contents($fp);
if (is_string($isi)) {
    $isi = preg_replace('/^\xEF\xBB\xBF/', '', $isi); // buang BOM UTF-8 jika ada
}
$semua = ($isi !== false && trim($isi) !== '') ? json_decode($isi, true) : [];
if (!is_array($semua)) {
    $semua = [];
}

$sudahAda = false;
foreach ($semua as $r) {
    if (($r['id'] ?? null) === $id) { // kirim ulang tidak menggandakan data
        $sudahAda = true;
        break;
    }
}
if (!$sudahAda) {
    $semua[] = $rekaman;
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode($semua, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    fflush($fp);
}
flock($fp, LOCK_UN);
fclose($fp);

jawab(200, ['ok' => true, 'id' => $id, 'nilai' => $nilai, 'benar' => $benar, 'total' => $total]);
