import { useEffect, useState } from 'react';

// Whether the app should render in mobile layout. Forces mobile inside the
// Telegram WebApp or on narrow/portrait screens. Extracted from App.jsx as part
// of the de-monolith work — self-contained, no coupling to game state.
export default function useIsMobile() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkMobile = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      const isTelegram = !!(window.Telegram && window.Telegram.WebApp);
      setIsMobile(width <= 768 || isTelegram || (height > width && width <= 1024));
    };

    checkMobile();
    window.addEventListener('resize', checkMobile);
    window.addEventListener('orientationchange', checkMobile);
    return () => {
      window.removeEventListener('resize', checkMobile);
      window.removeEventListener('orientationchange', checkMobile);
    };
  }, []);

  return isMobile;
}
