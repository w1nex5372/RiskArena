import { useEffect, useState } from 'react';

export function useTelegramUser() {
  const [telegramUser, setTelegramUser] = useState(null);
  const [telegramWebApp, setTelegramWebApp] = useState(null);

  useEffect(() => {
    const webApp = window.Telegram?.WebApp || null;
    setTelegramWebApp(webApp);
    setTelegramUser(webApp?.initDataUnsafe?.user || null);
  }, []);

  return { telegramUser, telegramWebApp };
}
