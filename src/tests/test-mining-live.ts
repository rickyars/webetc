/**
 * Live Mining Test - TypeScript Module
 * Main entry point for live mining test UI
 */

import { createGPUDevice } from '../gpu/device-helper';
import { ETCClient } from '../rpc/etc-client';
import { MiningCoordinator } from '../mining/coordinator';

let coordinator: MiningCoordinator | null = null;
let device: GPUDevice | null = null;

// Network presets
const networks = {
  mordor: {
    http: 'https://rpc.mordor.etccooperative.org',
    ws: 'wss://rpc.mordor.etccooperative.org'
  },
  mainnet: {
    http: 'https://www.ethercluster.com/etc',
    ws: 'wss://www.ethercluster.com/etc'
  },
  mainnet2: {
    http: 'https://etc.rivet.link',
    ws: undefined
  },
  mainnet3: {
    http: 'https://besu-de.etc-network.info',
    ws: undefined
  }
};

// Logging
function log(message: string, type: string = 'info') {
  const logDiv = document.getElementById('log');
  if (!logDiv) return;

  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  logDiv.appendChild(entry);
  logDiv.scrollTop = logDiv.scrollHeight;
}

// Update stats display
function updateStats(stats: any) {
  const el = (id: string) => document.getElementById(id);

  if (el('hashrate')) el('hashrate')!.textContent = (stats.hashrate / 1_000_000).toFixed(2) + ' MH/s';
  if (el('totalHashes')) el('totalHashes')!.textContent = (stats.totalHashes / 1_000_000).toFixed(2) + 'M';
  if (el('sharesFound')) el('sharesFound')!.textContent = stats.sharesFound;
  if (el('sharesAccepted')) el('sharesAccepted')!.textContent = stats.sharesAccepted;
  if (el('sharesRejected')) el('sharesRejected')!.textContent = stats.sharesRejected;
  if (el('currentBlock')) el('currentBlock')!.textContent = stats.currentBlock || '-';
  if (el('uptime')) el('uptime')!.textContent = formatUptime(stats.uptime);
}

function formatUptime(seconds: number): string {
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

function setStatus(text: string, badge: string) {
  const statusText = document.getElementById('statusText');
  const badgeEl = document.getElementById('statusBadge');

  if (statusText) statusText.textContent = text;
  if (badgeEl) {
    badgeEl.textContent = badge;
    badgeEl.className = `status ${badge.toLowerCase()}`;
  }
}

// Start mining
export async function startMining() {
  try {
    const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
    if (startBtn) startBtn.disabled = true;

    setStatus('INITIALIZING', 'INITIALIZING');
    log('Starting mining...', 'info');

    // Get configuration
    const networkSelect = (document.getElementById('network') as HTMLSelectElement).value;
    const batchSize = parseInt((document.getElementById('batchSize') as HTMLInputElement).value);

    let endpoint: { http: string; ws?: string };
    if (networkSelect === 'custom') {
      endpoint = {
        http: (document.getElementById('customEndpoint') as HTMLInputElement).value,
        ws: undefined
      };
    } else {
      endpoint = networks[networkSelect as keyof typeof networks];
    }

    log(`Connecting to ${networkSelect} (${endpoint.http})...`, 'info');

    // Initialize GPU
    if (!device) {
      log('Initializing WebGPU...', 'info');
      device = await createGPUDevice();
      log('✓ WebGPU initialized', 'success');
    }

    // Create RPC client
    const etcClient = new ETCClient({
      httpEndpoint: endpoint.http,
      wsEndpoint: endpoint.ws,
    });

    // Create coordinator
    coordinator = new MiningCoordinator(
      etcClient,
      device,
      {
        batchSize,
        maxBatchSize: 1_000_000,
        reportInterval: 10_000,
        autoRestart: true,
      }
    );

    // Initialize (fetch work, generate DAG)
    await coordinator.initialize();
    log('✓ Coordinator initialized', 'success');

    // Start mining
    setStatus('MINING', 'MINING');
    const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
    if (stopBtn) stopBtn.disabled = false;
    log('⛏️ Mining started!', 'success');

    // Start mining with stats callback
    coordinator.startMining((stats) => {
      updateStats(stats);
    }).catch(err => {
      log(`Mining error: ${err.message}`, 'error');
      setStatus('ERROR', 'IDLE');
      if (startBtn) startBtn.disabled = false;
      if (stopBtn) stopBtn.disabled = true;
    });

  } catch (error) {
    log(`Error: ${(error as Error).message}`, 'error');
    setStatus('ERROR', 'IDLE');
    const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
    if (startBtn) startBtn.disabled = false;
  }
}

// Stop mining
export function stopMining() {
  if (coordinator) {
    coordinator.stopMining();
    log('Mining stopped', 'warning');
    setStatus('STOPPED', 'IDLE');

    const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
    const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
  }
}

// Initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  // Handle network selection
  const networkSelect = document.getElementById('network') as HTMLSelectElement;
  if (networkSelect) {
    networkSelect.addEventListener('change', (e) => {
      const customGroup = document.getElementById('customEndpointGroup');
      if (customGroup) {
        customGroup.style.display = (e.target as HTMLSelectElement).value === 'custom' ? 'block' : 'none';
      }
    });
  }

  // Attach button handlers
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');

  if (startBtn) startBtn.addEventListener('click', startMining);
  if (stopBtn) stopBtn.addEventListener('click', stopMining);

  // Override console.log to capture logs
  const originalLog = console.log;
  console.log = function(...args: any[]) {
    originalLog.apply(console, args);
    const message = args.join(' ');

    if (message.includes('✓') || message.includes('✅')) {
      log(message, 'success');
    } else if (message.includes('❌') || message.includes('Error')) {
      log(message, 'error');
    } else if (message.includes('🎉') || message.includes('Found')) {
      log(message, 'success');
    } else if (message.includes('⚠️') || message.includes('warning')) {
      log(message, 'warning');
    } else {
      log(message, 'info');
    }
  };

  // Initial log
  log('Mining interface ready', 'success');
  log('Select network and click "Start Mining" to begin', 'info');
});
