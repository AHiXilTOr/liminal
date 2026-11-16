import * as THREE from 'three';
import type { Settings } from '../settings';
import { Connection } from '../net/connection';
import type { ServerMessage } from '../net/protocol';
import { createHumanoid, Locomotion } from 'anima3d';
import type { Humanoid, LocomotionController } from 'anima3d';

const SERVER_URL = 'ws://127.0.0.1:3000/ws';
const SEND_INTERVAL_MS = 50;
const MOVE_SPEED = 5;
const EYE_HEIGHT = 1.7;

export class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private settings: Settings;
  private connection: Connection;

  // Позиция на земле (y=0). Камера ставится на EYE_HEIGHT выше.
  private selfPos = { x: 0, y: 0, z: 0 };
  private others = new Map<number, {
    human: Humanoid;
    loco: LocomotionController;
    lastPos: { x: number; z: number };
    speed: number;
  }>();

  private keys = new Set<string>();
  private lastSendTime = 0;
  private lastFrameTime = 0;

  // Обзор от первого лица.
  private yaw = 0;   // поворот вокруг Y (влево-вправо)
  private pitch = 0; // поворот вокруг X (вверх-вниз)

  constructor(container: HTMLElement, settings: Settings) {
    this.settings = settings;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0e0e);

    this.camera = new THREE.PerspectiveCamera(
      75, window.innerWidth / window.innerHeight, 0.1, 1000,
    );
    // Порядок 'YXZ' — сначала yaw (вокруг Y), потом pitch (вокруг X).
    // При таком порядке движение мыши вверх-вниз не кренит камеру,
    // как это было бы с порядком 'XYZ'.
    this.camera.rotation.order = 'YXZ';

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);

    this.buildWorld();

    this.connection = new Connection(
      SERVER_URL,
      (msg) => this.handleServerMessage(msg),
      () => console.log('Disconnected from server'),
    );

    this.attachInput();
  }

  private buildWorld(): void {
    // 1. AmbientLight — равномерно подсвечивает всё со всех сторон.
    //    Без него теневые стороны модели будут абсолютно чёрными.
    //    Интенсивность 0.6 — чтобы модель была хорошо видна, но не «плоско».
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // 2. DirectionalLight — имитация основного источника (как лампа сверху).
    //    Позиция (5, 10, 7) задаёт направление лучей: свет «падает» из этой точки
    //    в начало координат. Интенсивность 0.8 даёт объём и лёгкие тени.
    const sun = new THREE.DirectionalLight(0xffffff, 0.8);
    sun.position.set(5, 10, 7);
    this.scene.add(sun);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshBasicMaterial({ color: 0xc2b280 }),
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(200, 100, 0x444444, 0x222222);
    this.scene.add(grid);
  }

  private attachInput(): void {
    const canvas = this.renderer.domElement;

    // Pointer lock: клик по canvas захватывает мышь, курсор скрывается,
    // а движение мыши приходит в mousemove как movementX/movementY.
    // Не нужно держать кнопку — просто захватили и двигаете.
    // Escape отпускает захват (стандартное поведение браузера).
    canvas.addEventListener('click', () => {
      // Уже в захвате — ничего не делаем.
      if (document.pointerLockElement === canvas) return;

      // requestPointerLock() может вернуть Promise (новые Chrome) или
      // undefined (старые браузеры / Firefox). Оборачиваем на случай обоих
      // и игнорируем отказ: если пользователь только что нажал Escape,
      // браузер блокирует захват ~1 сек. — при следующем клике сработает.
      try {
        const result = canvas.requestPointerLock() as unknown;
        if (result instanceof Promise) {
          result.catch(() => {
            // Тихо игнорируем SecurityError.
          });
        }
      } catch {
        // Некоторые браузеры бросают синхронно — тоже игнорируем.
      }
    });

    document.addEventListener('mousemove', (e) => {
      // Реагируем только когда захват активен. Иначе любое движение мыши
      // крутило бы камеру, даже когда игрок взаимодействует с UI.
      if (document.pointerLockElement !== canvas) return;
      // yaw -= movementX: движение мыши вправо уменьшает угол поворота,
      // что при нашей системе координат (right-handed, Y вверх) поворачивает
      // камеру вправо. pitch -= movementY аналогично — вверх смотрит вверх.
      this.yaw -= e.movementX * this.settings.sensitivity;
      this.pitch -= e.movementY * this.settings.sensitivity;
      // Не даём камере перевернуться через полюс.
      const limit = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });

    // e.code даёт физическую клавишу (KeyW), не зависящую от раскладки.
    window.addEventListener('keydown', (e) => this.keys.add(e.code));
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));

    window.addEventListener('resize', () => this.onResize());
  }

  private onResize(): void {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  private handleServerMessage(msg: ServerMessage): void {
    switch (msg.kind) {
      case 'welcome':
        console.log('My player ID:', msg.id);
        break;

      case 'playerUpdate': {
        if (msg.id === this.connection.playerId) return; // себя не рисуем

        let entry = this.others.get(msg.id);
        if (!entry) {
          // Создаём гуманоида. seed = id, чтобы у каждого игрока был
          // свой уникальный внешний вид (цвет костюма, пропорции).
          const human = createHumanoid({
            seed: msg.id,
            height: 1.8,
            build: 0.95,
            // Желтый комбинезон: верх и низ одного цвета.
            colors: {
              top: 0xE8D44D,      // ярко-желтый, как у ASYNC
              bottom: 0xE8D44D,   // тот же цвет, чтобы читался как цельный комбинезон
              boots: 0x111111,    // черные ботинки
              skin: 0xD2B48C,     // нейтральный тон (лицо все равно будет за визором)
              hair: 0x222222,     // темные волосы (если не скроются шлемом)
            },
            // Длинные рукава и пиджак/туника создают силуэт комбинезона.
            outfit: {
              top: 'jacket',
              bottom: 'pants',
              sleeves: 'long',
              collar: true,
              belt: true,
            },
            // 'hat' садится на голову и вместе с темным цветом имитирует капюшон/визор.
            accessories: ['hat'],
          });
          // human.object — это THREE.Object3D, который можно добавить в сцену.
          this.scene.add(human.object);

          // Locomotion синтезирует idle/walk/run из рига.
          const loco = new Locomotion(human);

          entry = { human, loco, lastPos: { x: msg.x, z: msg.z }, speed: 0 };
          this.others.set(msg.id, entry);
        }

        // Обновляем позицию. Гуманоид стоит на полу, поэтому y = 0.
        entry.human.object.position.set(msg.x, 0, msg.z);
        entry.human.object.rotation.y = msg.yaw + Math.PI;

        // Оцениваем скорость по дельте позиции, чтобы анимация знала,
        // идёт персонаж или стоит. Это приблизительно: точная скорость
        // придёт, когда сервер начнёт присылать её явно.
        const dx = msg.x - entry.lastPos.x;
        const dz = msg.z - entry.lastPos.z;
        const dist = Math.hypot(dx, dz);
        // Предполагаем, что обновления приходят примерно раз в 50 мс.
        entry.speed = dist / 0.05;
        entry.lastPos = { x: msg.x, z: msg.z };

        break;
      }

      case 'playerLeft': {
        const entry = this.others.get(msg.id);
        if (entry) {
          this.scene.remove(entry.human.object);
          // Освобождаем GPU-ресурсы скелета и геометрии.
          entry.human.object.traverse((obj) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry.dispose();
              if (Array.isArray(obj.material)) {
                obj.material.forEach(m => m.dispose());
              } else {
                obj.material.dispose();
              }
            }
          });
          this.others.delete(msg.id);
        }
        break;
      }
    }
  }

  start(): void {
    this.lastFrameTime = performance.now();

    const loop = (now: number) => {
      requestAnimationFrame(loop);
      const dt = (now - this.lastFrameTime) / 1000;
      this.lastFrameTime = now;

      // Применяем обзор к камере.
      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;

      // Направление взгляда на горизонтальной плоскости.
      // При yaw=0 камера смотрит в -Z (это стандарт Three.js).
      // Формулы: forward = R_y(yaw) * (0, 0, -1) = (-sin(yaw), 0, -cos(yaw))
      //          right   = forward × up            = ( cos(yaw), 0, -sin(yaw))
      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const rightX =  Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      let dx = 0;
      let dz = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp'))    { dx += fwdX;   dz += fwdZ; }
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown'))  { dx -= fwdX;   dz -= fwdZ; }
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) { dx += rightX; dz += rightZ; }
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft'))  { dx -= rightX; dz -= rightZ; }

      // Нормализация: по диагонали не быстрее, чем по прямой.
      const len = Math.hypot(dx, dz);
      if (len > 0) {
        dx /= len;
        dz /= len;
        this.selfPos.x += dx * MOVE_SPEED * dt;
        this.selfPos.z += dz * MOVE_SPEED * dt;
      }

      // Камера на высоте глаз в позиции игрока.
      this.camera.position.set(this.selfPos.x, EYE_HEIGHT, this.selfPos.z);

      // Отправляем позицию не чаще SEND_INTERVAL_MS.
      if (now - this.lastSendTime >= SEND_INTERVAL_MS) {
        this.connection.sendMove(this.selfPos.x, this.selfPos.y, this.selfPos.z, this.yaw);
        this.lastSendTime = now;
      }

      this.renderer.render(this.scene, this.camera);

      // Обновляем анимацию всех гуманоидов.
      for (const entry of this.others.values()) {
        entry.loco.update(dt, entry.speed);
      }
    };

    requestAnimationFrame(loop);
  }
}