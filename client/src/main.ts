import { initMenu } from './ui/menu';
import type { Settings } from './settings';

initMenu(async (settings: Settings) => {
  const { Game } = await import('./game/scene');

  const container = document.getElementById('game')!;
  container.classList.remove('hidden');

  const game = new Game(container, settings);
  game.start();
});