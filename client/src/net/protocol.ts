// Байтовый формат должен совпадать байт-в-байт с protocol/src/lib.rs.
// Если меняете одну сторону — меняйте и другую, иначе клиент и сервер
// перестанут понимать друг друга (но каждый продолжит работать с собой).

export const TAG_MOVE = 0;

export const TAG_WELCOME = 0;
export const TAG_PLAYER_UPDATE = 1;
export const TAG_PLAYER_LEFT = 2;

export const MOVE_SIZE = 17;

/** Сериализует Move в Uint8Array (13 байт). */
export function encodeMove(x: number, y: number, z: number, yaw: number): Uint8Array {
  const buf = new Uint8Array(MOVE_SIZE);
  buf[0] = TAG_MOVE;
  const view = new DataView(buf.buffer);
  view.setFloat32(1, x, true);
  view.setFloat32(5, y, true);
  view.setFloat32(9, z, true);
  view.setFloat32(13, yaw, true);
  return buf;
}

// Дискриминированное объединение (discriminated union) — это TS-паттерн,
// который позволяет type-safe разбирать сообщения по полю kind.
// Аналог enum в Rust, но во время исполнения это просто объекты.
export type ServerMessage =
  | { kind: 'welcome'; id: number }
  | { kind: 'playerUpdate'; id: number; x: number; y: number; z: number; yaw: number }
  | { kind: 'playerLeft'; id: number };

/** Разбирает байты от сервера. Возвращает null, если формат неизвестен. */
export function decodeServerMessage(bytes: Uint8Array): ServerMessage | null {
  if (bytes.length < 1) return null;
  // byteOffset и byteLength нужны, потому что Uint8Array может быть окном
  // в более крупный буфер (так часто бывает с сетевыми данными).
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  switch (bytes[0]) {
    case TAG_WELCOME:
      if (bytes.length < 5) return null;
      return { kind: 'welcome', id: view.getUint32(1, true) };

    case TAG_PLAYER_UPDATE:
      if (bytes.length < 21) return null;
      return {
        kind: 'playerUpdate',
        id: view.getUint32(1, true),
        x: view.getFloat32(5, true),
        y: view.getFloat32(9, true),
        z: view.getFloat32(13, true),
        yaw: view.getFloat32(17, true),  // NEW
      };

    case TAG_PLAYER_LEFT:
      if (bytes.length < 5) return null;
      return { kind: 'playerLeft', id: view.getUint32(1, true) };

    default:
      return null;
  }
}