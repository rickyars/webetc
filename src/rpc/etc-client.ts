/**
 * Ethereum Classic RPC Client
 * Connects to ETC network via JSON-RPC for mining operations
 */

export interface WorkPackage {
  headerHash: string;      // 32 bytes (0x-prefixed hex)
  seedHash: string;        // 32 bytes (determines epoch)
  target: string;          // 32 bytes (difficulty threshold, hash must be < target)
  blockNumber: number;
}

export interface ETCClientConfig {
  httpEndpoint: string;    // HTTP JSON-RPC endpoint
  wsEndpoint?: string;     // Optional WebSocket endpoint for subscriptions
  timeout?: number;        // Request timeout in ms (default: 30000)
}

export class ETCClient {
  private endpoint: string;
  private wsEndpoint?: string;
  private timeout: number;
  private ws?: WebSocket;
  private requestId = 0;

  constructor(config: ETCClientConfig) {
    this.endpoint = config.httpEndpoint;
    this.wsEndpoint = config.wsEndpoint;
    this.timeout = config.timeout ?? 30000;
  }

  /**
   * Make a JSON-RPC call to the ETC node
   */
  private async rpcCall<T = any>(method: string, params: any[] = []): Promise<T> {
    const id = ++this.requestId;
    const body = {
      jsonrpc: '2.0',
      method,
      params,
      id,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(`RPC Error ${data.error.code}: ${data.error.message}`);
      }

      return data.result;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`RPC timeout after ${this.timeout}ms`);
      }
      throw error;
    }
  }

  /**
   * Get current mining work from the network
   * Returns headerHash, seedHash, and target (difficulty)
   */
  async getWork(): Promise<WorkPackage> {
    const result = await this.rpcCall<string[]>('eth_getWork');

    if (!Array.isArray(result) || result.length < 3) {
      throw new Error(`Invalid eth_getWork response: ${JSON.stringify(result)}`);
    }

    // Get current block number for epoch calculation
    const blockNumber = await this.getBlockNumber();

    return {
      headerHash: result[0],   // 32 bytes
      seedHash: result[1],     // 32 bytes (for epoch)
      target: result[2],       // 32 bytes (difficulty threshold)
      blockNumber,
    };
  }

  /**
   * Submit a solution (winning nonce) to the network
   *
   * @param nonce - 8-byte nonce (0x-prefixed hex)
   * @param headerHash - 32-byte header hash (must match current work)
   * @param mixDigest - 32-byte mix digest from Hashimoto
   * @returns true if accepted, false if rejected
   */
  async submitWork(
    nonce: string,
    headerHash: string,
    mixDigest: string
  ): Promise<boolean> {
    const result = await this.rpcCall<boolean>('eth_submitWork', [
      nonce,
      headerHash,
      mixDigest,
    ]);

    return result === true;
  }

  /**
   * Get current block number
   */
  async getBlockNumber(): Promise<number> {
    const result = await this.rpcCall<string>('eth_blockNumber');
    return parseInt(result, 16);
  }

  /**
   * Get current network difficulty
   */
  async getDifficulty(): Promise<bigint> {
    const result = await this.rpcCall<string>('eth_getBlockByNumber', ['latest', false]);
    if (!result || typeof result !== 'object' || !('difficulty' in result)) {
      throw new Error('Failed to get difficulty from latest block');
    }
    return BigInt(result.difficulty as string);
  }

  /**
   * Subscribe to new blocks via WebSocket
   * Calls the callback whenever a new block is mined
   * Returns a cleanup function to unsubscribe
   */
  subscribeNewBlocks(callback: (blockHash: string) => void): () => void {
    if (!this.wsEndpoint) {
      throw new Error('WebSocket endpoint not configured');
    }

    this.ws = new WebSocket(this.wsEndpoint);

    this.ws.onopen = () => {
      console.log('✓ WebSocket connected');
      this.ws!.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_subscribe',
        params: ['newHeads'],
        id: ++this.requestId,
      }));
    };

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // Handle subscription confirmation
        if (data.id && data.result) {
          console.log(`✓ Subscribed to newHeads (subscription ID: ${data.result})`);
          return;
        }

        // Handle new block notifications
        if (data.params?.result?.hash) {
          callback(data.params.result.hash);
        }
      } catch (error) {
        console.error('WebSocket message parse error:', error);
      }
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('WebSocket closed');
    };

    // Return cleanup function
    return () => {
      if (this.ws) {
        this.ws.close();
        this.ws = undefined;
      }
    };
  }

  /**
   * Close any open connections
   */
  close(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = undefined;
    }
  }
}

/**
 * Helper to convert difficulty target (hex string) to difficulty number
 * difficulty = 2^256 / target
 */
export function targetToDifficulty(target: string): bigint {
  const targetBigInt = BigInt(target);
  if (targetBigInt === 0n) {
    return 0n;
  }
  // 2^256 / target
  const max256 = (1n << 256n);
  return max256 / targetBigInt;
}

/**
 * Helper to convert difficulty number to target (max hash value)
 * target = 2^256 / difficulty
 */
export function difficultyToTarget(difficulty: bigint): bigint {
  if (difficulty === 0n) {
    return 0n;
  }
  const max256 = (1n << 256n);
  return max256 / difficulty;
}

/**
 * Convert hex string to Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.substr(i * 2, 2), 16);
  }
  return bytes;
}

/**
 * Convert Uint8Array to hex string (0x-prefixed)
 */
export function bytesToHex(bytes: Uint8Array): string {
  return '0x' + Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Convert hex string to BigInt
 */
export function hexToBigInt(hex: string): bigint {
  return BigInt(hex);
}

/**
 * Convert BigInt to hex string (0x-prefixed, padded to 64 chars for 32 bytes)
 */
export function bigIntToHex(value: bigint, paddedLength = 64): string {
  return '0x' + value.toString(16).padStart(paddedLength, '0');
}
