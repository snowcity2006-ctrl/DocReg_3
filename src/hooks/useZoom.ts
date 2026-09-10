import { useState, useEffect, useCallback } from 'react';
import { electronBridge } from '../services/electronBridge';

const ZOOM_STORAGE_KEY = 'docflow_ui_zoom';
export const ZOOM_STEPS = [0.8, 0.9, 1.0, 1.1, 1.25, 1.4, 1.5];

export function useZoom() {
  const [zoom, setZoomState] = useState<number>(() => {
    try {
      const saved = localStorage.getItem(ZOOM_STORAGE_KEY);
      if (saved) {
        const val = parseFloat(saved);
        if (!isNaN(val) && val >= 0.7 && val <= 1.8) {
          return val;
        }
      }
    } catch {}
    return 1.0;
  });

  const applyZoom = useCallback((factor: number) => {
    const rounded = Math.round(factor * 100) / 100;
    try {
      // Применяем через Electron webFrame, если запущен в Electron
      if (electronBridge.setZoomFactor) {
        electronBridge.setZoomFactor(rounded);
      }
      // И гарантированно через стили CSS zoom для браузерного рендера / preview
      (document.documentElement.style as any).zoom = String(rounded);
      document.documentElement.style.setProperty('--app-scale', String(rounded));
      localStorage.setItem(ZOOM_STORAGE_KEY, String(rounded));
    } catch (e) {
      console.error('Failed to apply zoom:', e);
    }
  }, []);

  const setZoom = useCallback(
    (newZoom: number) => {
      const clamped = Math.min(1.6, Math.max(0.75, Math.round(newZoom * 100) / 100));
      setZoomState(clamped);
      applyZoom(clamped);
    },
    [applyZoom]
  );

  const zoomIn = useCallback(() => {
    const next = ZOOM_STEPS.find((s) => s > zoom + 0.02);
    setZoom(next ?? Math.min(1.6, zoom + 0.1));
  }, [zoom, setZoom]);

  const zoomOut = useCallback(() => {
    const prev = [...ZOOM_STEPS].reverse().find((s) => s < zoom - 0.02);
    setZoom(prev ?? Math.max(0.75, zoom - 0.1));
  }, [zoom, setZoom]);

  const resetZoom = useCallback(() => {
    setZoom(1.0);
  }, [setZoom]);

  // Применяем зум при первой инициализации
  useEffect(() => {
    applyZoom(zoom);
  }, [zoom, applyZoom]);

  // Слушатель горячих клавиш: Ctrl + Plus, Ctrl + Minus, Ctrl + 0, Ctrl + MouseWheel
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey) {
        if (e.key === '=' || e.key === '+' || e.code === 'NumpadAdd') {
          e.preventDefault();
          zoomIn();
        } else if (e.key === '-' || e.code === 'NumpadSubtract') {
          e.preventDefault();
          zoomOut();
        } else if (e.key === '0' || e.code === 'Numpad0') {
          e.preventDefault();
          resetZoom();
        }
      }
    };

    const handleWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        if (e.deltaY < 0) {
          zoomIn();
        } else if (e.deltaY > 0) {
          zoomOut();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('wheel', handleWheel, { passive: false });

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('wheel', handleWheel);
    };
  }, [zoomIn, zoomOut, resetZoom]);

  return {
    zoom,
    zoomPercent: Math.round(zoom * 100),
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  };
}
