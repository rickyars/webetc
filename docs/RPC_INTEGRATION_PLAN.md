# RPC Integration Plan - Browser-Based NFT Mining Art Experiment

## Project Overview

This is a **browser-based art experiment** where multiple participants can open an NFT in their browser and collectively mine Ethereum Classic (ETC) using their GPUs. Each participant contributes to a shared mining effort without duplicating work.

## Current Status (Ready for RPC)

✅ **GPU Mining Engine Complete**
- Epoch 387 (current ETC): 4.02 GB DAG, 2 buffers, 22.64 MH/s
- Chunked DAG generation: 37-50s startup
- Multi-buffer shader: 20% overhead acceptable
- Full pipeline: DAG gen → Hashimoto → Difficulty filter

✅ **Performance Verified**
- Single-buffer (epoch 0): 28.33 MH/s
- 2-buffer (epoch 200): 22.64 MH/s
- 2-buffer (epoch 387): ~22-23 MH/s expected

## Architecture: Distributed Browser Mining

### Key Challenge: Nonce Deduplication

**Problem**: Multiple browsers mining simultaneously will waste work if they try the same nonces.

**Solution**: Coordinator-based nonce range allocation

```
┌─────────────────────────────────────────────────────────┐
│                  Mining Coordinator                     │
│              (Centralized Service/Smart Contract)       │
│                                                          │
│  - Issues unique nonce ranges to each miner             │
│  - Tracks active miners and their progress             │
│  - Collects shares and submits to ETC network          │
│  - Distributes rewards (if any)                        │
└─────────────────────────────────────────────────────────┘
           ▲              ▲              ▲
           │              │              │
    ┌──────┴───┐   ┌──────┴───┐   ┌──────┴───┐
    │ Browser 1│   │ Browser 2│   │ Browser N│
    │  (NFT)   │   │  (NFT)   │   │  (NFT)   │
    └──────────┘   └──────────┘   └──────────┘
    Nonces:         Nonces:         Nonces:
    0-1M           1M-2M           (N-1)M-NM
```

---

## Phase 1: RPC Client Foundation

### 1.1 ETC Node Connection

**File**: `src/rpc/etc-client.ts`

```typescript
export class ETCClient {
  private endpoint: string;
  private wsEndpoint?: string;

  constructor(config: ETCClientConfig) {
    this.endpoint = config.httpEndpoint;
    this.wsEndpoint = config.wsEndpoint;
  }

  // Core RPC methods
  async getWork(): Promise<WorkPackage>
  async submitWork(nonce: string, headerHash: string, mixDigest: string): Promise<boolean>
  async getBlockNumber(): Promise<number>
  async getCurrentDifficulty(): Promise<bigint>

  // WebSocket for instant updates
  subscribeToNewBlocks(callback: (block: Block) => void): () => void
}

export interface WorkPackage {
  headerHash: string;      // 32 bytes
  seedHash: string;        // 32 bytes (determines epoch)
  target: string;          // 32 bytes (difficulty threshold)
  blockNumber: number;
}
```

**Implementation**:
- Use `fetch()` for HTTP JSON-RPC calls
- Use native `WebSocket` for block subscriptions
- Handle connection errors and retries
- Support both public nodes and custom endpoints

**Endpoints to support**:
- Public: `https://www.ethercluster.com/etc` (HTTP)
- Local: `http://localhost:8545` (Geth/OpenEthereum)
- Pool: TBD based on pool choice

---

### 1.2 Nonce Coordinator Service

**File**: `src/rpc/nonce-coordinator.ts`

```typescript
export class NonceCoordinator {
  private coordinatorEndpoint: string;
  private minerId: string;

  // Request exclusive nonce range
  async requestNonceRange(count: number): Promise<NonceRange>

  // Report progress (for monitoring)
  async reportProgress(range: NonceRange, hashrate: number): Promise<void>

  // Submit found share
  async submitShare(share: MiningShare): Promise<void>
}

export interface NonceRange {
  start: bigint;
  end: bigint;
  workId: string;          // Links to specific work package
}

export interface MiningShare {
  nonce: string;
  headerHash: string;
  mixDigest: string;
  difficulty: bigint;
  minerId: string;
  timestamp: number;
}
```

**Two Coordinator Options**:

#### Option A: Centralized HTTP Service (Simple)
- Simple Node.js/Express server
- In-memory nonce range tracking
- REST API for range requests
- Fast, easy to implement

#### Option B: Smart Contract Coordinator (Decentralized)
- Smart contract on ETC or sidechain
- On-chain nonce range allocation
- Trustless but higher latency
- More complex, better for art narrative

**Recommendation**: Start with Option A, migrate to Option B for production art piece.

---

## Phase 2: Mining Coordinator

### 2.1 Mining Loop Manager

**File**: `src/mining/coordinator.ts`

```typescript
export class MiningCoordinator {
  private etcClient: ETCClient;
  private nonceCoordinator: NonceCoordinator;
  private gpu: GPUDevice;
  private hashimotoSetup?: HashimotoSetup;

  async initialize(): Promise<void> {
    // 1. Connect to ETC node
    await this.etcClient.connect();

    // 2. Get current work
    const work = await this.etcClient.getWork();

    // 3. Determine epoch from seedHash
    const epoch = this.getEpochFromSeed(work.seedHash);

    // 4. Generate DAG (once per epoch, ~50s)
    this.hashimotoSetup = await setupHashimotoGPU(epoch, this.gpu);

    // 5. Start mining loop
    this.startMining(work);
  }

  private async miningLoop(work: WorkPackage): Promise<void> {
    while (true) {
      // 1. Request unique nonce range
      const range = await this.nonceCoordinator.requestNonceRange(1_000_000);

      // 2. Mine batch
      const result = await this.mineBatch(work, range);

      // 3. Submit any winning shares
      for (const share of result.winningShares) {
        await this.nonceCoordinator.submitShare(share);
      }

      // 4. Check for new block
      if (this.hasNewBlock()) {
        break; // Restart with new work
      }
    }
  }

  private async mineBatch(work: WorkPackage, range: NonceRange): Promise<BatchResult> {
    const nonces = this.generateNonces(range);
    const headerHash = hexToBytes(work.headerHash);
    const target = hexToBigInt(work.target);

    // Run GPU mining
    const result = await runHashimotoBatchGPU(
      headerHash,
      nonces,
      this.gpu,
      this.hashimotoSetup!,
      { batchSize: nonces.length },
      target  // GPU filters by difficulty
    );

    return {
      winningShares: result.filterResult?.validNonces.map(n => ({
        nonce: bytesToHex(n),
        headerHash: work.headerHash,
        mixDigest: this.computeMixDigest(n),  // Need to implement
        difficulty: hexToBigInt(work.target),
        minerId: this.minerId,
        timestamp: Date.now(),
      })) || []
    };
  }
}
```

**Key Features**:
- Single-threaded mining loop (browser limitation)
- Automatic DAG regeneration on epoch change
- New block detection via WebSocket
- Graceful error handling and reconnection
- Hashrate tracking and reporting

---

### 2.2 Epoch Management

**File**: `src/mining/epoch-manager.ts`

```typescript
export class EpochManager {
  // Compute epoch from seedHash
  getEpochFromSeed(seedHash: string): number

  // Check if epoch changed
  hasEpochChanged(currentSeed: string, newSeed: string): boolean

  // Get expected DAG size for epoch
  getDAGSize(epoch: number): number

  // Validate epoch matches block number
  validateEpoch(epoch: number, blockNumber: number): boolean
}
```

**Implementation**:
- ETC epoch = `Math.floor(blockNumber / 60000)` (post-Thanos fork)
- SeedHash computed via iterative Keccak-256 from epoch 0
- Cache seedHash lookups for performance

---

## Phase 3: NFT Integration

### 3.1 NFT Loader

**File**: `src/nft/loader.ts`

```typescript
export class NFTMinerLoader {
  // Load mining config from NFT metadata
  async loadFromNFT(nftAddress: string, tokenId: number): Promise<MiningConfig>

  // Embed miner in NFT display
  renderMinerUI(container: HTMLElement): void

  // Start mining when NFT is viewed
  async startMining(): Promise<void>
}

export interface MiningConfig {
  coordinatorEndpoint: string;
  etcNodeEndpoint: string;
  minerId: string;              // Derived from wallet or random
  displayHashrate: boolean;
  showStats: boolean;
}
```

**NFT Metadata Example** (stored on-chain or IPFS):
```json
{
  "name": "Collective Mining Art #1",
  "description": "Join the collective mining experiment",
  "image": "ipfs://...",
  "mining": {
    "coordinator": "https://mining-coordinator.art/api",
    "etcNode": "https://www.ethercluster.com/etc",
    "poolFee": 0,
    "distributionMethod": "equal"
  }
}
```

---

### 3.2 Miner UI Component

**File**: `src/ui/miner-widget.ts`

```typescript
export class MinerWidget {
  render(stats: MiningStats): string {
    return `
      <div class="miner-stats">
        <div>Hashrate: ${stats.hashrate.toFixed(2)} MH/s</div>
        <div>Shares Found: ${stats.sharesFound}</div>
        <div>Active Miners: ${stats.totalMiners}</div>
        <div>Time Mining: ${stats.uptime}</div>
      </div>
    `;
  }
}

export interface MiningStats {
  hashrate: number;
  sharesFound: number;
  totalMiners: number;
  uptime: string;
  currentBlock: number;
  difficulty: string;
}
```

**Design**:
- Minimal, non-intrusive overlay on NFT
- Real-time hashrate display
- Toggle to show/hide detailed stats
- Visual indicator when share found (celebration animation)

---

## Phase 4: Coordinator Backend

### 4.1 Nonce Range Server

**File**: `coordinator-service/src/server.ts`

```typescript
import express from 'express';

const app = express();

// In-memory state (use Redis for production)
const activeRanges = new Map<string, NonceAllocation>();
const pendingShares: MiningShare[] = [];

app.post('/api/request-range', async (req, res) => {
  const { workId, count, minerId } = req.body;

  // Allocate non-overlapping range
  const range = allocateRange(workId, count, minerId);

  res.json(range);
});

app.post('/api/submit-share', async (req, res) => {
  const share: MiningShare = req.body;

  // Validate share
  if (await validateShare(share)) {
    pendingShares.push(share);

    // Submit to ETC network if meets network difficulty
    if (share.difficulty >= NETWORK_DIFFICULTY) {
      await submitToETCNetwork(share);
    }
  }

  res.json({ success: true });
});

app.get('/api/stats', (req, res) => {
  res.json({
    activeMiners: activeRanges.size,
    totalHashrate: calculateTotalHashrate(),
    sharesFound: pendingShares.length,
  });
});
```

**Features**:
- Atomic nonce range allocation (no overlap)
- Share validation before network submission
- Rate limiting per miner
- Statistics aggregation
- Health monitoring

---

### 4.2 Share Validation

**File**: `coordinator-service/src/validator.ts`

```typescript
export async function validateShare(share: MiningShare): Promise<boolean> {
  // 1. Verify hash meets difficulty
  const hash = computeHash(share.nonce, share.headerHash, share.mixDigest);
  if (hash >= share.difficulty) return false;

  // 2. Verify headerHash matches current work
  if (share.headerHash !== currentWork.headerHash) return false;

  // 3. Verify nonce was allocated to this miner
  const allocation = getAllocation(share.minerId);
  if (!isNonceInRange(share.nonce, allocation.range)) return false;

  // 4. Check not already submitted
  if (isDuplicate(share)) return false;

  return true;
}
```

---

## Phase 5: Production Features

### 5.1 Error Handling & Reconnection

```typescript
class RobustETCClient extends ETCClient {
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 10;

  async getWorkWithRetry(): Promise<WorkPackage> {
    try {
      return await this.getWork();
    } catch (error) {
      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        this.reconnectAttempts++;
        await this.delay(1000 * this.reconnectAttempts);
        return this.getWorkWithRetry();
      }
      throw error;
    }
  }
}
```

---

### 5.2 Performance Monitoring

**File**: `src/monitoring/metrics.ts`

```typescript
export class MiningMetrics {
  private hashrates: number[] = [];
  private sharesSubmitted = 0;
  private startTime = Date.now();

  recordHashrate(hashrate: number): void {
    this.hashrates.push(hashrate);
    if (this.hashrates.length > 100) {
      this.hashrates.shift();
    }
  }

  getAverageHashrate(): number {
    return this.hashrates.reduce((a, b) => a + b, 0) / this.hashrates.length;
  }

  getUptime(): string {
    const seconds = Math.floor((Date.now() - this.startTime) / 1000);
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hours}h ${mins}m`;
  }
}
```

---

## Phase 6: Testing & Deployment

### 6.1 Local Testing

```bash
# 1. Start local ETC node (Geth)
geth --classic --http --http.api eth,web3,net --http.corsdomain "*"

# 2. Start coordinator service
cd coordinator-service
npm start

# 3. Start dev server
npm run dev

# 4. Open test NFT
open http://localhost:5173/src/nft-miner.html
```

---

### 6.2 Testnet Deployment

**Mordor Testnet (ETC testnet)**:
- Endpoint: `https://rpc.mordor.etccooperative.org`
- Free testnet ETC from faucet
- Same algorithm as mainnet
- Perfect for testing

---

## Implementation Roadmap

### Week 1: RPC Foundation
- [ ] Create `ETCClient` class with `getWork` and `submitWork`
- [ ] Implement WebSocket block subscription
- [ ] Test with local Geth node
- [ ] Test with public ETC endpoints

### Week 2: Nonce Coordination
- [ ] Build simple HTTP coordinator service
- [ ] Implement nonce range allocation
- [ ] Add share validation
- [ ] Test multi-browser nonce deduplication

### Week 3: Mining Integration
- [ ] Create `MiningCoordinator` class
- [ ] Integrate with GPU mining engine
- [ ] Implement mining loop with nonce ranges
- [ ] Test end-to-end: browser → coordinator → ETC network

### Week 4: NFT Integration
- [ ] Build NFT miner loader
- [ ] Create minimal UI widget
- [ ] Test in NFT marketplace (OpenSea, etc.)
- [ ] Deploy coordinator to production

### Week 5: Polish & Launch
- [ ] Performance optimization
- [ ] Error handling and edge cases
- [ ] Monitoring and analytics
- [ ] Launch art experiment!

---

## Security Considerations

1. **DoS Protection**: Rate limit nonce range requests per IP/wallet
2. **Share Validation**: Always validate shares server-side
3. **CORS**: Properly configure coordinator CORS for NFT domains
4. **API Keys**: Optional: require API key for coordinator access
5. **Sybil Resistance**: Optional: require NFT ownership to mine

---

## Economics & Rewards

**Options for Reward Distribution**:

1. **Altruistic (Art-First)**:
   - No rewards, pure collective experiment
   - Mining power donated to artist wallet
   - Most aligned with art narrative

2. **Equal Distribution**:
   - Shares distributed equally among NFT holders
   - Requires smart contract on ETC
   - Complex but fair

3. **Proportional**:
   - Rewards based on hashrate contribution
   - Tracked by coordinator
   - Traditional pool model

**Recommendation**: Start with option 1 (altruistic) for simplicity and art purity. Add economics later if desired.

---

## Next Steps

1. **Create todo list** for implementation phases
2. **Choose coordinator approach** (centralized vs smart contract)
3. **Select ETC endpoint** (public node vs managed vs own node)
4. **Design NFT metadata** structure
5. **Build RPC client** as first implementation

Ready to proceed?
