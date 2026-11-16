// Этот файл — единственный источник истины о настройках пользователя.
// И меню, и игра импортируют его, чтобы видеть одни и те же значения.

// Интерфейс (interface) в TypeScript описывает форму объекта.
// Он не существует в рантайме — это только проверка на этапе компиляции.
// Благодаря этому опечатки вроде settings.sensitvity ловятся сразу.
export interface Settings {
  // Чувствительность мыши: сколько радиан поворота на каждый пиксель движения.
  // 0.001 — очень медленно, 0.05 — очень быстро.
  sensitivity: number;
}

// Ключ для localStorage. Имена с префиксом проекта нужны, чтобы
// не конфликтовать с другими сайтами, которые открыты на том же домене
// (у localStorage область видимости — домен, а не путь или проект).
const STORAGE_KEY = 'crowd_world_liminal_settings';

// Значения по умолчанию. Используются при первом визите и как fallback,
// если сохранённые данные повреждены или неполные.
const DEFAULT_SETTINGS: Settings = {
  sensitivity: 0.01,
};

// loadSettings() всегда возвращает валидный Settings, даже если
// в localStorage ничего нет или там лежит битый JSON.
// Это важно: игра не должна падать из-за повреждённых настроек.
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };

    const parsed = JSON.parse(raw) as Partial<Settings>;

    // Spread-оператор {...DEFAULT_SETTINGS, ...parsed} объединяет объекты:
    // сначала кладутся значения по умолчанию, потом поверх — сохранённые.
    // Если в parsed нет поля sensitivity (например, оно было добавлено
    // в новой версии), то останется значение по умолчанию.
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    // Если JSON.parse упал или localStorage недоступен (например,
    // в приватном режиме Safari), тихо возвращаем дефолты.
    return { ...DEFAULT_SETTINGS };
  }
}

// saveSettings() вызывается на каждое изменение в UI.
// Сериализация в JSON тривиальна, поэтому пишем без async.
export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // localStorage может быть переполнен или запрещён — игнорируем.
  }
}