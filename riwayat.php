<?php
// Mengirim ringkasan catatan dari hasil.json (terbaru di atas) untuk ditampilkan di halaman awal.
// hasil.json sendiri tetap tidak bisa diunduh langsung (diblokir .htaccess).

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$file = __DIR__ . '/hasil.json';
$semua = [];

if (is_file($file)) {
    $fp = @fopen($file, 'r');
    if ($fp) {
        flock($fp, LOCK_SH); // tunggu jika simpan.php sedang menulis
        $isi = stream_get_contents($fp);
        flock($fp, LOCK_UN);
        fclose($fp);
        $isi = preg_replace('/^\xEF\xBB\xBF/', '', (string) $isi); // buang BOM UTF-8 jika ada
        $data = json_decode($isi, true);
        if (is_array($data)) {
            $semua = $data;
        }
    }
}

$semua = array_reverse($semua); // terbaru di atas
$ringkas = [];
foreach (array_slice($semua, 0, 100) as $r) {
    $ringkas[] = [
        'nama' => $r['nama'] ?? '',
        'paket' => $r['paket'] ?? '-',
        'waktu' => $r['waktu'] ?? null,
        'nilai' => $r['nilai'] ?? 0,
        'benar' => $r['benar'] ?? 0,
        'total' => $r['total'] ?? 0,
    ];
}

echo json_encode(['total' => count($semua), 'data' => $ringkas], JSON_UNESCAPED_UNICODE);
