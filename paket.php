<?php
// Mengirim daftar paket soal: semua file .json di folder soal/.
// Cukup taruh file paket baru di folder soal/ dan ia otomatis muncul di pilihan.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$paket = [];
foreach (glob(__DIR__ . '/soal/*.json') ?: [] as $berkas) {
    $id = basename($berkas, '.json');
    // Hanya nama berkas yang aman: huruf, angka, spasi, titik, garis bawah, strip, kurung
    if (!preg_match('/^[\p{L}\p{N} _.\-()]+$/u', $id)) {
        continue;
    }
    $isi = preg_replace('/^\xEF\xBB\xBF/', '', (string) file_get_contents($berkas)); // buang BOM UTF-8
    $d = json_decode($isi, true);
    if (!is_array($d) || empty($d['soal']) || !is_array($d['soal'])) {
        continue; // lewati file yang bukan paket soal yang valid
    }
    $paket[] = [
        'id' => $id,
        'judul' => (isset($d['judul']) && is_string($d['judul']) && $d['judul'] !== '') ? $d['judul'] : $id,
        'deskripsi' => (isset($d['deskripsi']) && is_string($d['deskripsi'])) ? $d['deskripsi'] : '',
        'jumlah' => count($d['soal']),
    ];
}

usort($paket, function ($a, $b) {
    return strcasecmp($a['judul'], $b['judul']);
});

echo json_encode(['paket' => $paket], JSON_UNESCAPED_UNICODE);
