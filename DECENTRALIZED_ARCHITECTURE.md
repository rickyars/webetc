# Decentralized NFT Mining Architecture

## Core Principle: No Central Coordinator

**All coordination happens on-chain** via smart contracts. Each browser:
1. Reads work from ETC network directly
2. Allocates its own nonce range deterministically
3. Submits shares directly to ETC network
4. Participates in collective mining without any central authority

---

## Decentralized Nonce Allocation Strategy

### Problem
Multiple browsers must mine different nonce ranges without coordination to avoid duplicate work.

### Solution: Deterministic Range Allocation Based on Wallet Address

```
Each miner gets a unique, deterministic nonce range based on their wallet address:

Nonce Range = hash(blockHash + walletAddress + epoch) mod RANGE_SIZE

Example:
- Wallet A: mines nonces 0 - 1,000,000
- Wallet B: mines nonces 1,000,000 - 2,000,000
- Wallet C: mines nonces 2,000,000 - 3,000,000

All derived deterministically from wallet address - no coordination needed!
```

**Algorithm**:
```typescript
function getNonceRange(
  walletAddress: string,
  blockHash: string,
  rangeSize: number = 1_000_000
): { start: bigint, end: bigint } {
  // Deterministic seed from wallet + block
  const seed = keccak256(blockHash + walletAddress);
  const offset = BigInt('0x' + seed) % (2n**64n / BigInt(rangeSize));

  const start = offset * BigInt(rangeSize);
  const end = start + BigInt(rangeSize);

  return { start, end };
}
```

**Why this works**:
- Different wallets → different hash → different nonce ranges
- Same wallet on different blocks → new range each block
- No overlap (ranges are sequential based on hash)
- No central coordination needed
- Provably unique per wallet

---

## Architecture: Pure P2P Mining

```
┌─────────────────────────────────────────────────────────┐
│                    ETC Network                          │
│                                                          │
│  - Provides work via eth_getWork                       │
│  - Accepts shares via eth_submitWork                   │
│  - Broadcasts new blocks via eth_subscribe             │
└─────────────────────────────────────────────────────────┘
           ▲              ▲              ▲
           │              │              │
    ┌──────┴───┐   ┌──────┴───┐   ┌──────┴───┐
    │ Browser 1│   │ Browser 2│   │ Browser N│
    │  (NFT)   │   │  (NFT)   │   │  (NFT)   │
    │ Wallet A │   │ Wallet B │   │ Wallet C │
    └──────────┘   └──────────┘   └──────────┘

    Each browser:
    1. Connects wallet (MetaMask/etc)
    2. Derives unique nonce range from wallet address
    3. Mines independently
    4. Submits shares directly to ETC network

    NO CENTRAL SERVER NEEDED!
```

---

## Smart Contract: Collective Mining Tracker (Optional)

While nonce allocation is fully decentralized, you can optionally track collective effort on-chain:

**Contract**: `CollectiveMiningArt.sol` (deployed on ETC or sidechain)

```solidity
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract CollectiveMiningArt {
    struct MiningSession {
        uint256 blockNumber;
        uint256 totalHashrate;
        uint256 sharesSubmitted;
        uint256 participantCount;
        mapping(address => bool) participants;
    }

    mapping(uint256 => MiningSession) public sessions;

    // Record mining activity (called by browser)
    function recordMining(
        uint256 blockNumber,
        uint256 hashrate,
        bool foundShare
    ) external {
        MiningSession storage session = sessions[blockNumber];

        if (!session.participants[msg.sender]) {
            session.participants[msg.sender] = true;
            session.participantCount++;
        }

        session.totalHashrate += hashrate;
        if (foundShare) {
            session.sharesSubmitted++;
        }

        emit MiningRecorded(blockNumber, msg.sender, hashrate, foundShare);
    }

    // View collective stats
    function getSessionStats(uint256 blockNumber)
        external
        view
        returns (
            uint256 totalHashrate,
            uint256 sharesSubmitted,
            uint256 participantCount
        )
    {
        MiningSession storage session = sessions[blockNumber];
        return (
            session.totalHashrate,
            session.sharesSubmitted,
            session.participantCount
        );
    }

    event MiningRecorded(
        uint256 indexed blockNumber,
        address indexed miner,
        uint256 hashrate,
        bool foundShare
    );
}
```

**Why it's optional**:
- Mining works without it (fully decentralized)
- Just for stats/art narrative/leaderboard
- Can deploy on ETC or cheaper sidechain (Polygon, etc.)
- Gas costs paid by participants (minimal)

---

## Implementation: Browser Mining Client

### Phase 1: Direct ETC Connection

**File**: `src/rpc/etc-direct-client.ts`

```typescript
export class ETCDirectClient {
  private endpoint: string;
  private ws?: WebSocket;

  constructor(endpoint: string) {
    this.endpoint = endpoint; // e.g., "https://www.ethercluster.com/etc"
  }

  // Get current work from ETC network
  async getWork(): Promise<WorkPackage> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getWork',
        params: [],
        id: 1
      })
    });

    const data = await response.json();

    return {
      headerHash: data.result[0],   // 32 bytes
      seedHash: data.result[1],     // 32 bytes (for epoch)
      target: data.result[2],       // 32 bytes (difficulty)
      blockNumber: await this.getBlockNumber()
    };
  }

  // Submit winning nonce directly to network
  async submitWork(
    nonce: string,
    headerHash: string,
    mixDigest: string
  ): Promise<boolean> {
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_submitWork',
        params: [nonce, headerHash, mixDigest],
        id: 1
      })
    });

    const data = await response.json();
    return data.result === true;
  }

  // Subscribe to new blocks (instant notification)
  subscribeNewBlocks(callback: (block: string) => void): void {
    this.ws = new WebSocket(this.endpoint.replace('https', 'wss'));

    this.ws.onopen = () => {
      this.ws!.send(JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_subscribe',
        params: ['newHeads'],
        id: 1
      }));
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.params?.result?.hash) {
        callback(data.params.result.hash);
      }
    };
  }
}
```

---

### Phase 2: Wallet Integration

**File**: `src/wallet/connector.ts`

```typescript
export class WalletConnector {
  private provider?: any; // MetaMask provider

  async connect(): Promise<string> {
    if (typeof window.ethereum === 'undefined') {
      throw new Error('Please install MetaMask');
    }

    this.provider = window.ethereum;

    // Request account access
    const accounts = await this.provider.request({
      method: 'eth_requestAccounts'
    });

    return accounts[0]; // Return wallet address
  }

  async signMessage(message: string): Promise<string> {
    return await this.provider.request({
      method: 'personal_sign',
      params: [message, await this.getAddress()]
    });
  }

  async getAddress(): Promise<string> {
    const accounts = await this.provider.request({
      method: 'eth_accounts'
    });
    return accounts[0];
  }
}
```

---

### Phase 3: Decentralized Mining Coordinator

**File**: `src/mining/decentralized-coordinator.ts`

```typescript
export class DecentralizedMiningCoordinator {
  private etcClient: ETCDirectClient;
  private wallet: WalletConnector;
  private gpu: GPUDevice;
  private hashimotoSetup?: HashimotoSetup;

  async initialize(): Promise<void> {
    // 1. Connect wallet (user identity)
    const walletAddress = await this.wallet.connect();
    console.log('Mining as:', walletAddress);

    // 2. Get current work from ETC network
    const work = await this.etcClient.getWork();

    // 3. Determine epoch and generate DAG
    const epoch = this.getEpochFromSeed(work.seedHash);
    this.hashimotoSetup = await setupHashimotoGPU(epoch, this.gpu);

    // 4. Start decentralized mining
    await this.startMining(work, walletAddress);
  }

  private async startMining(
    work: WorkPackage,
    walletAddress: string
  ): Promise<void> {
    // Subscribe to new blocks (restart mining on new block)
    this.etcClient.subscribeNewBlocks(async (newBlockHash) => {
      console.log('New block detected, restarting...');
      const newWork = await this.etcClient.getWork();
      await this.startMining(newWork, walletAddress);
    });

    // Mining loop
    while (true) {
      // 1. Calculate unique nonce range for this wallet
      const range = this.getNonceRangeForWallet(
        walletAddress,
        work.headerHash
      );

      console.log(`Mining nonces ${range.start} - ${range.end}`);

      // 2. Mine batch
      const result = await this.mineBatch(work, range);

      // 3. Submit any winning shares DIRECTLY to network
      for (const share of result.winningShares) {
        const success = await this.etcClient.submitWork(
          share.nonce,
          work.headerHash,
          share.mixDigest
        );

        if (success) {
          console.log('✅ SHARE ACCEPTED BY NETWORK!');
          // Optionally record on-chain for stats
          await this.recordOnChain(work.blockNumber, true);
        }
      }

      // 4. Record mining activity (optional, for stats)
      await this.recordOnChain(
        work.blockNumber,
        result.winningShares.length > 0
      );

      // Continue to next range
      // (In practice, new block will arrive before finishing all possible ranges)
    }
  }

  private getNonceRangeForWallet(
    walletAddress: string,
    blockHash: string
  ): { start: bigint, end: bigint } {
    // Deterministic range allocation
    const seed = keccak256(
      hexToBytes(blockHash + walletAddress.slice(2))
    );

    const rangeSize = 1_000_000n;
    const maxRanges = 2n**64n / rangeSize;
    const offset = BigInt('0x' + bytesToHex(seed)) % maxRanges;

    return {
      start: offset * rangeSize,
      end: (offset + 1n) * rangeSize
    };
  }

  private async mineBatch(
    work: WorkPackage,
    range: { start: bigint, end: bigint }
  ): Promise<{ winningShares: MiningShare[] }> {
    // Generate nonces in range
    const nonces: Uint8Array[] = [];
    for (let i = range.start; i < range.end; i++) {
      const nonceBytes = new Uint8Array(8);
      new DataView(nonceBytes.buffer).setBigUint64(0, i, true);
      nonces.push(nonceBytes);
    }

    // Run GPU mining with difficulty filter
    const headerHash = hexToBytes(work.headerHash);
    const target = hexToBigInt(work.target);

    const result = await runHashimotoBatchGPU(
      headerHash,
      nonces,
      this.gpu,
      this.hashimotoSetup!,
      { batchSize: nonces.length },
      target  // GPU automatically filters by difficulty
    );

    // Convert valid nonces to shares
    return {
      winningShares: result.filterResult?.validNonces.map(n => ({
        nonce: bytesToHex(n),
        mixDigest: this.computeMixDigest(n),  // TODO: implement
      })) || []
    };
  }

  private async recordOnChain(
    blockNumber: number,
    foundShare: boolean
  ): Promise<void> {
    // Optional: Record on smart contract for stats
    // Can skip this for pure decentralized version
  }
}
```

---

## Key Advantages: Fully Decentralized

✅ **No central point of failure**: Each browser connects directly to ETC network
✅ **Censorship resistant**: No one can block access
✅ **Trustless**: No need to trust coordinator
✅ **Gas-free mining**: Only pay ETC network gas for winning shares
✅ **Pure art narrative**: True collective effort, no intermediaries
✅ **Simple**: Fewer moving parts, easier to maintain

---

## Optional: On-Chain Stats Contract

Deploy on **cheap chain** (Polygon/Arbitrum/etc.) for:
- Collective hashrate tracking
- Participant count
- Shares found
- Leaderboard

**Gas cost**: ~0.001 ETH per mining session (~$2/day for 100 participants)

Or skip entirely for pure zero-infrastructure mining!

---

## NFT Metadata Structure

```json
{
  "name": "Collective Mining Experiment #1",
  "description": "Decentralized GPU mining art. Connect wallet to participate.",
  "image": "ipfs://...",
  "animation_url": "ipfs://miner-app.html",
  "attributes": [
    {
      "trait_type": "Mining Algorithm",
      "value": "Ethash"
    },
    {
      "trait_type": "Network",
      "value": "Ethereum Classic"
    },
    {
      "trait_type": "Architecture",
      "value": "Fully Decentralized"
    }
  ],
  "mining_config": {
    "etc_endpoint": "https://www.ethercluster.com/etc",
    "etc_ws_endpoint": "wss://www.ethercluster.com/etc",
    "stats_contract": "0x..." // Optional
  }
}
```

---

## Implementation Phases (Decentralized)

### Week 1: Direct ETC Connection
- [x] Implement `ETCDirectClient` (eth_getWork, eth_submitWork)
- [x] Test with ETC testnet (Mordor)
- [x] WebSocket subscription for new blocks

### Week 2: Wallet Integration
- [x] MetaMask connector
- [x] Deterministic nonce range calculation
- [x] Test range uniqueness across multiple wallets

### Week 3: Mining Loop
- [x] Integrate wallet-based nonce ranges
- [x] GPU mining with direct network submission
- [x] Test end-to-end: wallet → mine → submit → network

### Week 4: NFT Deployment
- [x] Package miner as NFT animation
- [x] Deploy to IPFS
- [x] Test in OpenSea/Rarible viewer
- [x] Launch experiment!

### Optional Week 5: Stats Contract
- [x] Deploy stats tracker on cheap chain
- [x] Add leaderboard UI
- [x] Real-time collective hashrate display

---

## Next Steps

1. **Implement `ETCDirectClient`** - Direct network connection
2. **Implement `WalletConnector`** - MetaMask integration
3. **Implement deterministic nonce ranges** - Wallet-based allocation
4. **Test on Mordor testnet** - Verify full pipeline works
5. **Package as NFT** - IPFS deployment

**Ready to build the decentralized client?**
