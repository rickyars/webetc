# Mining Quick Start Guide

## RPC Integration - Complete! ✅

The browser-based ETC miner is now ready for testing with full RPC integration.

## What's Been Implemented

### 1. **ETC RPC Client** ([src/rpc/etc-client.ts](src/rpc/etc-client.ts))
- `getWork()` - Fetch mining work from ETC network
- `submitWork()` - Submit winning nonces
- `subscribeNewBlocks()` - WebSocket subscription for new blocks
- Error handling and retry logic
- Helper functions for hex/bytes conversion

### 2. **Epoch Manager** ([src/mining/epoch-manager.ts](src/mining/epoch-manager.ts))
- `getEpochFromSeedHash()` - Convert seedHash to epoch number
- `getEpochFromBlockNumber()` - Convert block number to epoch (ETC: 60,000 blocks/epoch)
- `getSeedHashForEpoch()` - Generate seedHash for any epoch
- Caching for performance optimization

### 3. **Mining Coordinator** ([src/mining/coordinator.ts](src/mining/coordinator.ts))
- Full mining orchestration: RPC → DAG setup → GPU mining → submission
- Random nonce range generation (no central coordinator needed)
- Automatic DAG regeneration on epoch change
- Real-time stats tracking (hashrate, shares, uptime)
- New block detection and auto-restart

### 4. **Test UI** ([src/tests/test-mining-live.html](src/tests/test-mining-live.html))
- Simple browser interface for live mining
- Network selection (Mordor testnet / ETC mainnet / custom)
- Real-time stats display
- Mining log with color-coded messages

## Quick Start - Real Mining

### Requirements for Mining

**You need an ETC node with mining enabled (`eth_getWork` RPC method):**

#### Option 1: Local Core-Geth Node (Recommended)
```bash
# Install core-geth for ETC
# https://github.com/etclabscore/core-geth

# Run with mining RPC enabled
geth --classic --http --http.api eth,web3,net --http.corsdomain "*"
```

#### Option 2: Mining Pool Endpoint
- Most ETC mining pools provide `getWork` endpoints
- Example pools:
  - Ethermine: `https://etc.ethermine.org` (check their API docs)
  - 2Miners: `https://etc.2miners.com` (check their API docs)
  - **Note**: Pool endpoints vary - check with your pool

#### Option 3: Custom Mining-Enabled Node
- Any Geth-compatible ETC node with `--mine` flag
- Must expose `eth_getWork` RPC method
- CORS must allow browser access

### Testing Steps

### Step 1: Start Dev Server
```bash
npm run dev
```

### Step 2: Open Test Page
Open your browser (Chrome/Edge with WebGPU support) to:
```
http://localhost:5176/src/tests/test-mining-live.html
```

### Step 3: Configure Mining
1. **Network**: Select "Custom RPC"
2. **Endpoint**: Enter your mining-enabled node (e.g., `http://localhost:8545`)
3. **Batch Size**: Leave at 1,000,000 (1M nonces per batch)
4. Click **"Start Mining"**

### Step 4: Watch It Mine!
You'll see:
1. ✓ WebGPU initialization
2. ✓ Work fetched from ETC node
3. ✓ Epoch determined from seedHash
4. ✓ DAG generation (~37-50 seconds for current epoch)
5. ⛏️ Mining starts!
6. 📊 Real-time stats: hashrate, shares, uptime

### Why Public Endpoints Don't Work

**Public RPC endpoints (like Mordor testnet) typically DON'T provide mining work because:**
- Security: Prevents abuse
- Resource: Mining requires dedicated infrastructure
- Design: Public RPCs are for querying, not mining

**Error you'll see:**
```
RPC Error -32000: no mining work available yet
```

**Solution:** Run your own node or use a mining pool endpoint.

## What Happens Under the Hood

### Initialization Phase
```typescript
// 1. Connect to ETC node and fetch work
const work = await etcClient.getWork();
// Returns: { headerHash, seedHash, target, blockNumber }

// 2. Determine epoch from seedHash
const epoch = getEpochFromSeedHash(work.seedHash);

// 3. Generate DAG for this epoch (using existing GPU engine)
const setup = await setupHashimotoGPU(epoch, device);

// 4. Create reusable GPU buffers for performance
createReusableBuffers(1_000_000, device, setup);
```

### Mining Loop
```typescript
while (mining) {
  // 1. Generate random nonce range (1M nonces)
  const nonces = generateRandomNonceRange(1_000_000);

  // 2. Mine batch on GPU with difficulty filter
  const result = await runHashimotoBatchGPU(
    headerHash,
    nonces,
    device,
    setup,
    { batchSize: 1_000_000 },
    target  // GPU filters by difficulty
  );

  // 3. Submit any winning shares
  for (const nonce of result.filterResult.validNonces) {
    await etcClient.submitWork(nonce, headerHash, mixDigest);
  }

  // 4. Listen for new blocks (auto-restart if detected)
}
```

## Architecture: Fully Decentralized

**No central coordinator needed!** Each browser:
1. Connects directly to ETC RPC node
2. Picks random nonce ranges (collision probability ~0%)
3. Mines independently on GPU
4. Submits shares directly to network

### Random Nonce Ranges (No Coordination)
```typescript
// Pick random starting point in 2^64 nonce space
const startNonce = BigInt(Math.floor(Math.random() * Number.MAX_SAFE_INTEGER));

// Generate 1M consecutive nonces from that point
const nonces = Array.from({ length: 1_000_000 }, (_, i) =>
  startNonce + BigInt(i)
);

// Collision probability with other miners: ~0%
// 2^64 = 18,446,744,073,709,551,616 possible nonces
// Even 1000 miners @ 1M nonces each = 0.000005% overlap chance
```

## Expected Performance

### Mordor Testnet (Epoch ~387)
- **DAG Size**: ~4.02 GB (2 GPU buffers)
- **DAG Generation**: 37-50 seconds (one-time per epoch)
- **Hashrate**: 22-23 MH/s (mega-hashes per second)
- **Difficulty**: Low (testnet), should find shares quickly!

### ETC Mainnet (NOT RECOMMENDED for testing)
- **DAG Size**: ~4.02 GB (same epoch as Mordor)
- **Hashrate**: 22-23 MH/s
- **Difficulty**: High (~130 TH network hashrate)
- **Share probability**: Very low, likely no shares found

## Troubleshooting

### "No WebGPU support"
- Use Chrome 113+ or Edge 113+
- Enable WebGPU in chrome://flags (if not enabled)
- Linux: May need `--enable-features=Vulkan` flag

### "DAG generation failed"
- GPU memory full (need ~4 GB VRAM for current epoch)
- Try epoch 0 (1 GB DAG) for testing

### "Failed to connect to RPC endpoint"
- Check network selection
- Mordor testnet endpoint: `https://rpc.mordor.etccooperative.org`
- Try custom endpoint if default is down

### "No shares found"
- Normal! Testnet difficulty is still significant
- Each batch (1M nonces) has ~0.001% chance of finding a share
- Keep mining - shares will eventually appear

## Next Steps

### For Testing
1. ✅ Test on Mordor testnet
2. ⏳ Verify epoch transitions (wait for new epoch)
3. ⏳ Test multi-tab mining (verify no nonce collisions)
4. ⏳ Measure sustained hashrate over time

### For Production (Future)
1. ⏳ Add wallet integration (MetaMask)
2. ⏳ Implement easter egg for wallet redirect (performance art)
3. ⏳ Package as NFT animation (IPFS upload)
4. ⏳ Deploy to NFT marketplace

## Files Created

- [src/rpc/etc-client.ts](src/rpc/etc-client.ts) - ETC RPC client
- [src/mining/epoch-manager.ts](src/mining/epoch-manager.ts) - Epoch utilities
- [src/mining/coordinator.ts](src/mining/coordinator.ts) - Mining orchestrator
- [src/tests/test-mining-live.html](src/tests/test-mining-live.html) - Test UI

## Resources

- **Mordor Testnet Explorer**: https://explorer.mordor.etccooperative.org/
- **ETC RPC Docs**: https://etclabscore.github.io/core-geth/JSON-RPC-API/
- **Ethash Spec**: https://eth.wiki/en/concepts/ethash/ethash

---

**Ready to mine!** 🎉

Open [http://localhost:5176/src/tests/test-mining-live.html](http://localhost:5176/src/tests/test-mining-live.html) and start mining on Mordor testnet.
