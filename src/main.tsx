import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined') {
  // Prevent page zooming unless tapping/inspecting pictures
  document.addEventListener(
    'touchmove',
    (e: TouchEvent) => {
      if (e.touches && e.touches.length > 1) {
        const isPhoto = (e.target as HTMLElement)?.closest?.('.allow-pinch-zoom');
        if (!isPhoto) {
          e.preventDefault();
        }
      }
    },
    { passive: false }
  );

  document.addEventListener('gesturestart', (e: Event) => {
    const isPhoto = (e.target as HTMLElement)?.closest?.('.allow-pinch-zoom');
    if (!isPhoto) {
      e.preventDefault();
    }
  });

  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((err) => {
        console.warn('SW registration:', err);
      });
    });
  }
}

createRoot(document.getElementById('root')!).render(<App />);

