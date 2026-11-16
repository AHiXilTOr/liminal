import { encodeMove, decodeServerMessage, type ServerMessage } from './protocol';

export class Connection {
  private ws: WebSocket;
  // playerId присваивается, когда придёт Welcome. До этого null.
  // TypeScript заставит проверять playerId на null перед использованием —
  // это защита от race condition «получили PlayerUpdate раньше Welcome».
  public playerId: number | null = null;
  private onMessage: (msg: ServerMessage) => void;

  constructor(
    url: string,
    onMessage: (msg: ServerMessage) => void,
    onClose: () => void,
  ) {
    this.onMessage = onMessage;
    this.ws = new WebSocket(url);
    // Бинарные сообщения приходят как ArrayBuffer. Без этой строки
    // по умолчанию приходят Blob — их пришлось бы читать асинхронно.
    this.ws.binaryType = 'arraybuffer';

    this.ws.addEventListener('message', (event) => {
      if (event.data instanceof ArrayBuffer) {
        const msg = decodeServerMessage(new Uint8Array(event.data));
        if (!msg) return;
        if (msg.kind === 'welcome') {
          this.playerId = msg.id;
        }
        this.onMessage(msg);
      }
    });

    this.ws.addEventListener('close', () => onClose());
  }

  sendMove(x: number, y: number, z: number): void {
    // readyState проверяем, потому что send() на закрытом сокете бросит исключение.
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(encodeMove(x, y, z));
    }
  }

  close(): void {
    this.ws.close();
  }
}