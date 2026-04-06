#!/usr/bin/env node
/**
 * Fund wallets for P2TR and P2MR demos
 */

import { createRpcClient } from './scripts/rpc-client.mjs';

async function fundWallets() {
  const rpc = await createRpcClient();

  console.log('🪙 Funding wallets for demos...\n');

  // P2TR and P2MR wallets (account 0 from bip39 standard test mnemonic)
  const account0P2tr = 'bcrt1p7rmutwk8ptscdsgda22n22rt8nch2z5tyf5ndyc70u4qy7l6rhzqacms53';

  try {
    // Send 2 BTC to account 0 (enough for both demos)
    console.log(`Sending 2 BTC to account 0: ${account0P2tr}`);
    let txid = await rpc.call('sendtoaddress', [account0P2tr, 2]);
    console.log(`  ✓ txid: ${txid}`);

    // Generate a block to confirm
    console.log('\n⛏️  Generating block to confirm...');
    const minerAddr = await rpc.call('getnewaddress', []);
    const blocks = await rpc.call('generatetoaddress', [1, minerAddr]);
    console.log(`✓ Generated block: ${blocks[0]}\n`);

    console.log('✅ Wallets funded!');
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

fundWallets();
