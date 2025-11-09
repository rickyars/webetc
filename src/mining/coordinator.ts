/**
 * Mining Coordinator
 * Orchestrates the full mining pipeline: RPC → DAG setup → GPU mining → submission
 */

import { ETCClient, WorkPackage, hexToBytes, bytesToHex, hexToBigInt, difficultyToTarget } from '../rpc/etc-client';
import { setupHashimotoGPU, runHashimotoBatchGPU, HashimotoSetup, createReusableBuffers } from '../gpu/hashimoto';
import { getEpochFromSeedHash, hasEpochChanged } from './epoch-manager';

export interface MiningStats {
  hashrate: number;          // Hashes per second
  sharesFound: number;       // Total winning shares found
  sharesAccepted: number;    // Shares accepted by network
  sharesRejected: number;    // Shares rejected by network
  currentBlock: number;      // Current block number
  currentDifficulty: bigint; // Current network difficulty
  uptime: number;            // Mining uptime in seconds
  totalHashes: number;       // Total hashes computed
}

export interface MiningConfig {
  batchSize: number;         // Nonces per GPU batch (default: 1,000,000)
  maxBatchSize: number;      // Max batch size for reusable buffers (default: 1,000,000)
  reportInterval: number;    // Stats reporting interval in ms (default: 10000)
  autoRestart: boolean;      // Auto-restart on new block (default: true)
}

export const DEFAULT_MINING_CONFIG: MiningConfig = {
  batchSize: 1_000_000,      // 1M nonces per batch
  maxBatchSize: 1_000_000,   // 1M max for reusable buffers
  reportInterval: 10_000,    // Report every 10s
  autoRestart: true,         // Auto-restart on new block
};

export class MiningCoordinator {
  private etcClient: ETCClient;
  private device: GPUDevice;
  private config: MiningConfig;

  private setup?: HashimotoSetup;
  private currentWork?: WorkPackage;
  private currentEpoch?: number;

  private stats: MiningStats = {
    hashrate: 0,
    sharesFound: 0,
    sharesAccepted: 0,
    sharesRejected: 0,
    currentBlock: 0,
    currentDifficulty: 0n,
    uptime: 0,
    totalHashes: 0,
  };

  private mining = false;
  private startTime = 0;
  private unsubscribe?: () => void;
  private lastReportTime = 0;
  private onStatsUpdate?: (stats: MiningStats) => void;

  constructor(
    etcClient: ETCClient,
    device: GPUDevice,
    config: MiningConfig = DEFAULT_MINING_CONFIG
  ) {
    this.etcClient = etcClient;
    this.device = device;
    this.config = config;
  }

  /**
   * Initialize mining: connect to network, generate DAG
   */
  async initialize(): Promise<void> {
    console.log('🔧 Initializing mining coordinator...\n');

    // 1. Get current work from network
    console.log('📡 Fetching current work from ETC network...');
    this.currentWork = await this.etcClient.getWork();

    console.log(`✓ Work received:`);
    console.log(`  Block: ${this.currentWork.blockNumber}`);
    console.log(`  Header: ${this.currentWork.headerHash}`);
    console.log(`  Seed: ${this.currentWork.seedHash}`);
    console.log(`  Target: ${this.currentWork.target}`);

    // 2. Determine epoch from seedHash
    console.log('\n🔍 Determining epoch from seedHash...');
    this.currentEpoch = getEpochFromSeedHash(this.currentWork.seedHash);

    if (this.currentEpoch === -1) {
      throw new Error('Failed to determine epoch from seedHash');
    }

    console.log(`✓ Epoch: ${this.currentEpoch}`);

    // 3. Generate DAG for this epoch
    console.log(`\n⚙️ Generating DAG for epoch ${this.currentEpoch}...`);
    this.setup = await setupHashimotoGPU(this.currentEpoch, this.device);
    console.log('✓ DAG generation complete');

    // 4. Create reusable buffers for performance
    console.log(`\n🔧 Creating reusable buffers (max batch: ${this.config.maxBatchSize.toLocaleString()})...`);
    createReusableBuffers(this.config.maxBatchSize, this.device, this.setup);
    console.log('✓ Reusable buffers created');

    // 5. Update stats
    this.stats.currentBlock = this.currentWork.blockNumber;
    this.stats.currentDifficulty = hexToBigInt(this.currentWork.target);

    console.log('\n✅ Initialization complete, ready to mine!\n');
  }

  /**
   * Start mining loop
   */
  async startMining(onStatsUpdate?: (stats: MiningStats) => void): Promise<void> {
    if (this.mining) {
      console.warn('Mining already in progress');
      return;
    }

    if (!this.setup || !this.currentWork) {
      throw new Error('Must call initialize() before startMining()');
    }

    this.mining = true;
    this.startTime = Date.now();
    this.lastReportTime = Date.now();
    this.onStatsUpdate = onStatsUpdate;

    console.log('⛏️  Starting mining loop...\n');

    // Subscribe to new blocks
    if (this.config.autoRestart) {
      this.unsubscribe = this.etcClient.subscribeNewBlocks(async (blockHash) => {
        console.log(`\n🆕 New block detected: ${blockHash}`);
        await this.handleNewBlock();
      });
    }

    // Mining loop
    while (this.mining) {
      await this.mineBatch();
    }
  }

  /**
   * Stop mining
   */
  stopMining(): void {
    console.log('\n⏸️  Stopping mining...');
    this.mining = false;

    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = undefined;
    }

    console.log('✓ Mining stopped');
  }

  /**
   * Get current mining stats
   */
  getStats(): MiningStats {
    // Update uptime
    if (this.startTime > 0) {
      this.stats.uptime = Math.floor((Date.now() - this.startTime) / 1000);
    }

    return { ...this.stats };
  }

  /**
   * Handle new block: fetch new work and restart if epoch changed
   */
  private async handleNewBlock(): Promise<void> {
    try {
      // Get new work
      const newWork = await this.etcClient.getWork();

      // Check if epoch changed
      if (hasEpochChanged(this.currentWork!.seedHash, newWork.seedHash)) {
        console.log('🔄 Epoch changed, regenerating DAG...');

        const newEpoch = getEpochFromSeedHash(newWork.seedHash);
        if (newEpoch === -1) {
          console.error('Failed to determine new epoch');
          return;
        }

        this.currentEpoch = newEpoch;
        this.setup = await setupHashimotoGPU(this.currentEpoch, this.device);

        // Recreate reusable buffers for new DAG
        createReusableBuffers(this.config.maxBatchSize, this.device, this.setup);

        console.log('✓ DAG regenerated for new epoch');
      }

      // Update current work
      this.currentWork = newWork;
      this.stats.currentBlock = newWork.blockNumber;
      this.stats.currentDifficulty = hexToBigInt(newWork.target);

      console.log(`✓ Mining updated to block ${newWork.blockNumber}`);
    } catch (error) {
      console.error('Error handling new block:', error);
    }
  }

  /**
   * Mine a single batch of nonces
   */
  private async mineBatch(): Promise<void> {
    if (!this.setup || !this.currentWork) {
      return;
    }

    // Generate random nonce range (no coordination needed)
    const nonces = this.generateRandomNonceRange(this.config.batchSize);

    // Convert work data
    const headerHash = hexToBytes(this.currentWork.headerHash);
    const target = hexToBigInt(this.currentWork.target);

    // Mine batch on GPU with difficulty filter
    const batchStart = performance.now();

    const result = await runHashimotoBatchGPU(
      headerHash,
      nonces,
      this.device,
      this.setup,
      { batchSize: this.config.batchSize },
      target  // GPU automatically filters by difficulty
    );

    const batchTime = performance.now() - batchStart;

    // Update stats
    this.stats.totalHashes += this.config.batchSize;
    this.stats.hashrate = (this.config.batchSize / batchTime) * 1000; // Hashes per second

    // Submit any winning shares
    if (result.filterResult && result.filterResult.validNonces.length > 0) {
      console.log(`\n🎉 Found ${result.filterResult.validNonces.length} winning share(s)!`);

      for (const nonce of result.filterResult.validNonces) {
        await this.submitShare(nonce, result.results);
      }
    }

    // Report stats periodically
    if (Date.now() - this.lastReportTime >= this.config.reportInterval) {
      this.reportStats();
      this.lastReportTime = Date.now();

      if (this.onStatsUpdate) {
        this.onStatsUpdate(this.getStats());
      }
    }
  }

  /**
   * Generate random nonce range
   * Uses Math.random() to pick a starting point in the 2^64 nonce space
   * Collision probability is negligible (~0%)
   */
  private generateRandomNonceRange(count: number): Uint8Array[] {
    // Pick random starting nonce (use safe integer range)
    const startNonce = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

    const nonces: Uint8Array[] = [];
    for (let i = 0; i < count; i++) {
      const nonce = startNonce + BigInt(i);
      const nonceBytes = new Uint8Array(8);
      const view = new DataView(nonceBytes.buffer);
      view.setBigUint64(0, nonce, true); // Little-endian
      nonces.push(nonceBytes);
    }

    return nonces;
  }

  /**
   * Submit a winning share to the network
   */
  private async submitShare(nonce: Uint8Array, results: any[]): Promise<void> {
    if (!this.currentWork) {
      return;
    }

    // Find the corresponding result for this nonce
    const result = results.find(r => {
      return r.nonce.every((byte: number, i: number) => byte === nonce[i]);
    });

    if (!result) {
      console.error('Could not find result for nonce');
      return;
    }

    // Convert to hex strings
    const nonceHex = bytesToHex(nonce);
    const mixDigestHex = bytesToHex(result.hash); // TODO: Extract actual mixDigest from Hashimoto

    try {
      console.log(`  Submitting share: nonce=${nonceHex}`);

      const accepted = await this.etcClient.submitWork(
        nonceHex,
        this.currentWork.headerHash,
        mixDigestHex
      );

      if (accepted) {
        console.log('  ✅ Share ACCEPTED by network!');
        this.stats.sharesFound++;
        this.stats.sharesAccepted++;
      } else {
        console.log('  ❌ Share REJECTED by network');
        this.stats.sharesFound++;
        this.stats.sharesRejected++;
      }
    } catch (error) {
      console.error('  ❌ Error submitting share:', error);
      this.stats.sharesRejected++;
    }
  }

  /**
   * Report current mining stats
   */
  private reportStats(): void {
    const stats = this.getStats();
    const hashrateM = (stats.hashrate / 1_000_000).toFixed(2);
    const totalHashesM = (stats.totalHashes / 1_000_000).toFixed(2);

    console.log(`\n📊 Mining Stats:`);
    console.log(`  Hashrate: ${hashrateM} MH/s`);
    console.log(`  Total hashes: ${totalHashesM}M`);
    console.log(`  Shares: ${stats.sharesAccepted} accepted, ${stats.sharesRejected} rejected`);
    console.log(`  Block: ${stats.currentBlock}`);
    console.log(`  Uptime: ${this.formatUptime(stats.uptime)}`);
  }

  /**
   * Format uptime seconds as human-readable string
   */
  private formatUptime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;

    if (hours > 0) {
      return `${hours}h ${mins}m ${secs}s`;
    } else if (mins > 0) {
      return `${mins}m ${secs}s`;
    } else {
      return `${secs}s`;
    }
  }
}
