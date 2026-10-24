/** The parts of Telegram's Mini App API (window.Telegram.WebApp) the dashboard uses. */
interface TelegramWebApp {
  initData: string;
  initDataUnsafe: { start_param?: string; user?: { id: number; language_code?: string } };
  colorScheme: "light" | "dark";
  ready(): void;
  expand(): void;
  onEvent(event: "themeChanged", handler: () => void): void;
  HapticFeedback?: { selectionChanged(): void; notificationOccurred(type: "success" | "error" | "warning"): void };
}

const webApp: TelegramWebApp | undefined = (window as unknown as { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;

/** True when the page was opened inside Telegram (signed init data is present). */
export const insideTelegram = Boolean(webApp?.initData);

export const tg = {
  initData: webApp?.initData ?? "",
  startParam: webApp?.initDataUnsafe.start_param ?? null,
  languageCode: webApp?.initDataUnsafe.user?.language_code ?? navigator.language,
  colorScheme(): "light" | "dark" {
    // telegram-web-app.js exists in a plain browser too and always says "light" there.
    if (insideTelegram && webApp?.colorScheme) return webApp.colorScheme;
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  },
  ready(): void {
    webApp?.ready();
    webApp?.expand();
  },
  onThemeChanged(handler: () => void): void {
    webApp?.onEvent("themeChanged", handler);
  },
  tap(): void {
    webApp?.HapticFeedback?.selectionChanged();
  },
  notify(type: "success" | "error"): void {
    webApp?.HapticFeedback?.notificationOccurred(type);
  },
};
