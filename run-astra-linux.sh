#!/bin/bash
# ==============================================================================
# Скрипт запуска DocFlow AppImage для Astra Linux 1.7 (Orel / Smolensk / Voronezh)
# Учитывает особенности:
# 1. Отсутствие или права libfuse / fusermount в ядре Astra Linux
# 2. Замкнутую программную среду (МКД / Parsec)
# 3. Политики безопасности для Chromium sandbox
# ==============================================================================

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APPIMAGE=$(find "$DIR" -maxdepth 1 -name "*.AppImage" | head -n 1)

if [ -z "$APPIMAGE" ]; then
  echo "[DocFlow Ошибка]: Файл .AppImage не найден в текущей папке ($DIR)"
  exit 1
fi

chmod +x "$APPIMAGE"

echo "[DocFlow]: Запуск $APPIMAGE на Astra Linux..."

# Попытка 1: Запуск с системным FUSE и ключами безопасности
"$APPIMAGE" --no-sandbox --disable-setuid-sandbox "$@" 2>/dev/null
EXIT_CODE=$?

# Если код ошибки связан с FUSE (127, 1 или ошибка монтирования)
if [ $EXIT_CODE -ne 0 ]; then
  echo "[DocFlow]: Обнаружено ограничение FUSE / AppImage runtime."
  echo "[DocFlow]: Автоматический запуск через встроенный режим --appimage-extract-and-run..."
  "$APPIMAGE" --appimage-extract-and-run --no-sandbox --disable-setuid-sandbox "$@"
fi
