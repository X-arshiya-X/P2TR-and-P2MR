#!/usr/bin/env node
/**
 * Import mnemonic/seed into Bitcoin Core wallet for regtest demo
 */

import { createRpcClient } from './scripts/rpc-client.mjs';
import { readFile } from 'fs/promises';

const rpc = await createRpcClient();

// Load mnemonic
const mnemonic = JSON.parse(await readFile('./mnemonic.json'));
const mnemonicStr = mnemonic.join(' ');

console.log('📖 Importing mnemonic into Bitcoin Core wallet...\n');

try {
  // Create a new wallet
  const walletName = 'demo-mnemonic';
  
  // Try to create wallet
  try {
    await rpc.call('createwallet', [walletName]);
    console.log(`✓ Created wallet: ${walletName}`);
  } catch (e) {
    if (e.message.includes('already exists')) {
      console.log(`ℹ Wallet already exists: ${walletName}`);
    } else {
      throw e;
    }
  }

  // Load wallet
  await rpc.call('loadwallet', [walletName]);
  console.log(`✓ Loaded wallet: ${walletName}`);

  // Import the descriptor
  // For BIP86 (Taproot) with standard derivation: m/86'/1'/account'/0/0
  const result = await rpc.call('importmulti', [[{
    "descriptor": `pkh(tpub...)`,
    "timestamp": "now",
    "range": [0, 100],
    "internal": false
  }]]);
  
  console.log('Import result:');
  console.log(JSON.stringify(result, null, 2));

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
