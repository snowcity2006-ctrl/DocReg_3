/**
 * Скрипт патчинга заголовка AppImage для безусловного запуска в Astra Linux 1.7 / 1.8.
 * В Astra Linux модуль ядра Parsec по умолчанию блокирует запуск бинарников из FUSE (parsec.enable_exec_on_fuse=0),
 * а также пакет libfuse2 часто отсутствует.
 *
 * Этот скрипт модифицирует инструкцию условного перехода jne (0x75 0x1e)
 * после проверки переменной APPIMAGE_EXTRACT_AND_RUN в заголовке AppImage Type 2
 * на безусловный jmp (0xeb 0x1e).
 *
 * В результате AppImage запускается НАПРЯМУЮ в любой версии Astra Linux без FUSE,
 * без необходимости редактировать /etc/default/grub и без необходимости вводить флаги в терминале.
 */

const fs = require('fs');
const path = require('path');

function patchAppImageFile(filePath) {
  if (!fs.existsSync(filePath)) {
    console.log(`[patch-appimage] Файл не найден: ${filePath}`);
    return false;
  }

  const stats = fs.statSync(filePath);
  console.log(`[patch-appimage] Анализ AppImage: ${filePath} (${(stats.size / 1024 / 1024).toFixed(1)} МБ)`);

  const data = fs.readFileSync(filePath);

  // Ищем строку APPIMAGE_EXTRACT_AND_RUN
  const envStr = Buffer.from('APPIMAGE_EXTRACT_AND_RUN');
  const envIdx = data.indexOf(envStr);
  if (envIdx === -1) {
    console.log('[patch-appimage] Сигнатура APPIMAGE_EXTRACT_AND_RUN не найдена.');
    return false;
  }

  // Сигнатура проверки: test %rax, %rax; jne +0x1e
  // 48 85 c0 75 1e
  const needle = Buffer.from([0x48, 0x85, 0xc0, 0x75, 0x1e]);
  const idx = data.indexOf(needle);

  if (idx !== -1 && idx < 0x20000) {
    const patchOffset = idx + 3; // Байт 0x75
    if (data[patchOffset] === 0x75) {
      data[patchOffset] = 0xeb; // Заменяем jne на jmp
      fs.writeFileSync(filePath, data);
      fs.chmodSync(filePath, 0o755);
      console.log(`[patch-appimage] Успешно пропатчен заголовок AppImage по смещению 0x${patchOffset.toString(16)} (jne -> jmp).`);
      console.log('[patch-appimage] Теперь AppImage работает автономно без FUSE в любой конфигурации Astra Linux 1.7!');
      return true;
    } else if (data[patchOffset] === 0xeb) {
      console.log('[patch-appimage] AppImage уже был пропатчен ранее.');
      return true;
    }
  }

  console.log('[patch-appimage] Точка ветвления не найдена в заданном диапазоне.');
  return false;
}

// Автоматически патчим все .AppImage в директории release/
const releaseDir = path.join(process.cwd(), 'release');
if (fs.existsSync(releaseDir)) {
  const files = fs.readdirSync(releaseDir);
  for (const f of files) {
    if (f.endsWith('.AppImage')) {
      patchAppImageFile(path.join(releaseDir, f));
    }
  }
}

module.exports = { patchAppImageFile };
