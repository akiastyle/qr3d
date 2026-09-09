<?php
// editor-import.php v1.0.0
declare(strict_types=1);

header('Content-Type: application/json; charset=utf-8');

function reply(int $status, array $body): never {
  http_response_code($status);
  echo json_encode($body, JSON_UNESCAPED_SLASHES);
  exit;
}

function removeWorkspace(string $directory): void {
  foreach (glob("$directory/*") ?: [] as $file) if (is_file($file)) @unlink($file);
  @rmdir($directory);
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST' || !isset($_FILES['model'])) reply(405, ['error' => 'Upload richiesto']);
$file = $_FILES['model'];
if ($file['error'] !== UPLOAD_ERR_OK || !is_uploaded_file($file['tmp_name'])) reply(400, ['error' => 'Upload non valido']);
if (strtolower(pathinfo($file['name'], PATHINFO_EXTENSION)) !== 'glb') reply(415, ['error' => 'Sono supportati solo file GLB']);

$id = bin2hex(random_bytes(8));
$temporaryRoot = is_dir('/dev/shm') && is_writable('/dev/shm') ? '/dev/shm' : sys_get_temp_dir();
$workspace = "$temporaryRoot/qr3d-$id";
if (!mkdir($workspace, 0700)) reply(500, ['error' => 'Impossibile preparare la conversione']);
$source = "$workspace/model.glb";
$output = "$workspace/model.json";
$export = 'EDITOR_MODEL';
if (!move_uploaded_file($file['tmp_name'], $source)) {
  removeWorkspace($workspace);
  reply(500, ['error' => 'Impossibile salvare il file']);
}

$command = implode(' ', [
  escapeshellcmd('/usr/bin/blender'), '--background', '--python', escapeshellarg(__DIR__ . '/tools/export_static_mesh_module.py'), '--',
  escapeshellarg($source), escapeshellarg($output), escapeshellarg($export), '1', "''", 'embed', '2>&1',
]);
exec($command, $log, $result);
@unlink($source);
if ($result !== 0 || !is_file($output)) {
  removeWorkspace($workspace);
  reply(500, ['error' => 'Conversione Blender non riuscita']);
}
$model = file_get_contents($output);
removeWorkspace($workspace);
if ($model === false) reply(500, ['error' => 'Impossibile leggere la conversione']);
echo $model;
