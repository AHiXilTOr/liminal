import * as THREE from 'three';
import type { Settings } from '../settings';
import { Connection } from '../net/connection';
import type { ServerMessage } from '../net/protocol';
import { loadPlayerModel, createPlayerInstance } from './playerModel';

const SERVER_URL = 'ws://127.0.0.1:3000/ws';
const SEND_INTERVAL_MS = 50;
const MOVE_SPEED = 5;
const EYE_HEIGHT = 1.7;

type OtherPlayer = {
  root: THREE.Group;
  mixer: THREE.AnimationMixer;
  lastPos: { x: number; z: number };
};

export class Game {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private settings: Settings;
  private connection: Connection;

  private selfPos = { x: 0, y: 0, z: 0 };
  private others = new Map<number, OtherPlayer>();

  private keys = new Set<string>();
  private lastSendTime = 0;
  private lastFrameTime = 0;
  private modelReady: Promise<void>;

  private yaw = 0;
  private pitch = 0;

  constructor(container: HTMLElement, settings: Settings) {
    this.settings = settings;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0e0e0e);

    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.1,
      1000,
    );
    this.camera.rotation.order = 'YXZ';

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);

    this.buildWorld();
    this.attachInput();

    this.modelReady = loadPlayerModel().catch((e) => {
      console.error('Failed to load player model:', e);
    });

    this.connection = new Connection(
      SERVER_URL,
      (msg) => this.handleServerMessage(msg),
      () => console.log('Disconnected from server'),
    );
  }

  private buildWorld(): void {
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(10, 20, 10);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    this.scene.add(dir);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(200, 200),
      new THREE.MeshStandardMaterial({ color: 0xc2b280 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    this.scene.add(floor);

    const grid = new THREE.GridHelper(200, 100, 0x444444, 0x222222);
    this.scene.add(grid);
  }

  private attachInput(): void {
    const canvas = this.renderer.domElement;

    canvas.addEventListener('click', () => {
      if (document.pointerLockElement === canvas) return;
      try {
        const result = canvas.requestPointerLock() as unknown;
        if (result instanceof Promise) {
          result.catch(() => {});
        }
      } catch {
        // SecurityError при быстром повторном захвате — игнорируем.
      }
    });

    document.addEventListener('mousemove', (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * this.settings.sensitivity;
      this.pitch -= e.movementY * this.settings.sensitivity;
      const limit = Math.PI / 2 - 0.01;
      this.pitch = Math.max(-limit, Math.min(limit, this.pitch));
    });

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
        if (msg.id === this.connection.playerId) return;

        const existing = this.others.get(msg.id);
        if (existing) {
          existing.root.position.set(msg.x, 0, msg.z);
          existing.root.rotation.y = msg.yaw + Math.PI;
          existing.lastPos = { x: msg.x, z: msg.z };
          return;
        }

        this.modelReady.then(() => {
          if (this.others.has(msg.id)) return;
          const { root, mixer } = createPlayerInstance();
          root.position.set(msg.x, 0, msg.z);
          root.rotation.y = msg.yaw + Math.PI;
          this.scene.add(root);
          this.others.set(msg.id, { root, mixer, lastPos: { x: msg.x, z: msg.z } });
        });
        break;
      }

      case 'playerLeft': {
        const entry = this.others.get(msg.id);
        if (entry) {
          this.scene.remove(entry.root);
          entry.mixer.stopAllAction();
          entry.root.traverse((obj: THREE.Object3D) => {
            if (obj instanceof THREE.Mesh) {
              obj.geometry.dispose();
              if (Array.isArray(obj.material)) {
                obj.material.forEach((m: THREE.Material) => m.dispose());
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

      this.camera.rotation.y = this.yaw;
      this.camera.rotation.x = this.pitch;

      const fwdX = -Math.sin(this.yaw);
      const fwdZ = -Math.cos(this.yaw);
      const rightX = Math.cos(this.yaw);
      const rightZ = -Math.sin(this.yaw);

      let dx = 0;
      let dz = 0;
      if (this.keys.has('KeyW') || this.keys.has('ArrowUp')) {
        dx += fwdX;
        dz += fwdZ;
      }
      if (this.keys.has('KeyS') || this.keys.has('ArrowDown')) {
        dx -= fwdX;
        dz -= fwdZ;
      }
      if (this.keys.has('KeyD') || this.keys.has('ArrowRight')) {
        dx += rightX;
        dz += rightZ;
      }
      if (this.keys.has('KeyA') || this.keys.has('ArrowLeft')) {
        dx -= rightX;
        dz -= rightZ;
      }

      const len = Math.hypot(dx, dz);
      if (len > 0) {
        dx /= len;
        dz /= len;
        this.selfPos.x += dx * MOVE_SPEED * dt;
        this.selfPos.z += dz * MOVE_SPEED * dt;
      }

      this.camera.position.set(this.selfPos.x, EYE_HEIGHT, this.selfPos.z);

      if (now - this.lastSendTime >= SEND_INTERVAL_MS) {
        this.connection.sendMove(this.selfPos.x, this.selfPos.y, this.selfPos.z, this.yaw);
        this.lastSendTime = now;
      }

      for (const entry of this.others.values()) {
        entry.mixer.update(dt);
      }

      this.renderer.render(this.scene, this.camera);
    };

    requestAnimationFrame(loop);
  }
}