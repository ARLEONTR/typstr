import { WebSocket } from 'ws';

// lib0 varuint / varstring encoding helpers — no runtime dependency on lib0
function encodeVarUint(n: number): Uint8Array {
  const bytes: number[] = [];
  while (n > 127) {
    bytes.push((n & 0x7f) | 0x80);
    n >>>= 7;
  }
  bytes.push(n);
  return new Uint8Array(bytes);
}

function encodeVarString(s: string): Uint8Array {
  const encoded = new TextEncoder().encode(s);
  const lenBytes = encodeVarUint(encoded.length);
  const out = new Uint8Array(lenBytes.length + encoded.length);
  out.set(lenBytes, 0);
  out.set(encoded, lenBytes.length);
  return out;
}

function concatUint8Arrays(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((sum, a) => sum + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

// Build Hocuspocus auth message:
// [varstring documentName][type=2/Auth][authType=0/Token][varstring token][varstring providerVersion]
function buildAuthMessage(documentId: string, token: string): Buffer {
  return Buffer.from(concatUint8Arrays(
    encodeVarString(documentId),
    encodeVarUint(2),
    encodeVarUint(0),
    encodeVarString(token),
    encodeVarString('4.0.0'),
  ));
}

export interface CollabClientOptions {
  wsURL: string;
  documentId: string;
  token: string;
  onMessage?: (data: Buffer) => void;
  onError?: (err: Error) => void;
}

export class CollabClient {
  private ws: WebSocket | null = null;
  private connected = false;
  messagesReceived = 0;
  bytesReceived = 0;

  constructor(private opts: CollabClientOptions) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.opts.wsURL}`;
      this.ws = new WebSocket(url, ['hocuspocus-server-v1']);

      const timeout = setTimeout(() => {
        reject(new Error(`WebSocket connect timeout for document ${this.opts.documentId}`));
        this.ws?.close();
      }, 10_000);

      this.ws.on('open', () => {
        clearTimeout(timeout);
        this.connected = true;
        // Send Hocuspocus auth immediately after open
        this.ws!.send(buildAuthMessage(this.opts.documentId, this.opts.token));
        resolve();
      });

      this.ws.on('message', (data: Buffer) => {
        this.messagesReceived++;
        this.bytesReceived += data.length;
        this.opts.onMessage?.(data);
      });

      this.ws.on('error', (err: Error) => {
        clearTimeout(timeout);
        this.opts.onError?.(err);
        if (!this.connected) reject(err);
      });

      this.ws.on('close', () => {
        this.connected = false;
      });
    });
  }

  isConnected(): boolean {
    return this.connected;
  }

  waitForMessages(n: number, timeoutMs = 8000): Promise<void> {
    return new Promise((resolve, reject) => {
      const start = this.messagesReceived;
      const timer = setTimeout(() => {
        if (this.messagesReceived - start >= n) resolve();
        else reject(new Error(`waitForMessages timeout: got ${this.messagesReceived - start}/${n}`));
      }, timeoutMs);
      const iv = setInterval(() => {
        if (this.messagesReceived - start >= n) {
          clearInterval(iv);
          clearTimeout(timer);
          resolve();
        }
      }, 50);
    });
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}

export function httpToWs(httpURL: string): string {
  return httpURL.replace(/^http/, 'ws');
}
