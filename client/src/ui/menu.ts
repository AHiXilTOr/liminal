import { loadSettings, saveSettings, Settings } from '../settings';

// initMenu принимает колбэк onJoin, который вызовется при нажатии
// «Присоединиться». Так меню не знает ничего про игру — оно просто
// сообщает «пользователь готов». Это разделение упрощает тестирование
// и позволит позже, например, добавить превью настроек без входа в мир.
export function initMenu(onJoin: (settings: Settings) => void): void {
  // В TypeScript `document.getElementById` возвращает `HTMLElement | null`.
  // Символ `!` после вызова — это «non-null assertion»: мы говорим компилятору,
  // что точно знаем — элемент существует. Если ошиблись — будет рантайм-ошибка.
  // Безопаснее было бы проверять if (el === null), но для собственного HTML
  // принято использовать `!`, чтобы не засорять код.
  const menu = document.getElementById('menu')!;
  const settingsScreen = document.getElementById('settings')!;
  const btnJoin = document.getElementById('btn-join') as HTMLButtonElement;
  const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
  const btnBack = document.getElementById('btn-back') as HTMLButtonElement;
  const slider = document.getElementById('sensitivity') as HTMLInputElement;
  const sliderValue = document.getElementById('sensitivity-value')!;

  // Загружаем настройки и сразу синхронизируем UI с их значениями.
  const current = loadSettings();
  slider.value = String(current.sensitivity);
  sliderValue.textContent = current.sensitivity.toFixed(3);

  // Переход «меню → настройки».
  btnSettings.addEventListener('click', () => {
    menu.classList.add('hidden');
    settingsScreen.classList.remove('hidden');
  });

  // Переход «настройки → меню». Ничего не сохраняем явно —
  // сохранение уже произошло на каждом input.
  btnBack.addEventListener('click', () => {
    settingsScreen.classList.add('hidden');
    menu.classList.remove('hidden');
  });

  // Живое обновление при движении ползунка.
  // Событие 'input' срабатывает на каждое изменение, 'change' — только по отпусканию.
  // Нам нужно 'input', чтобы игрок видел число в реальном времени.
  slider.addEventListener('input', () => {
    current.sensitivity = parseFloat(slider.value);
    sliderValue.textContent = current.sensitivity.toFixed(3);
    saveSettings(current);
  });

  // «Присоединиться» — скрываем меню и передаём настройки в игру.
  btnJoin.addEventListener('click', () => {
    menu.classList.add('hidden');
    onJoin(current);
  });
}