#!/usr/bin/env node

/**
 * Setup script for Bitcoin regtest environment
 * 
 * This script:
 * 1. Checks if Bitcoin Core is accessible via RPC
 * 2. Initializes the blockchain with some blocks
 * 3. Creates test wallets
 * 4. Generates initial funds
 */

import { createRpcClient } from './rpc-client.mjs';
import * as fs from 'fs/promises';
import * as path from 'path';

const CONFIG_DIR = './config/regtest';
const WALLETS_FILE = path.join(CONFIG_DIR, 'wallets.json');

async function ensureConfigDir() {
  try {
    await fs.mkdir(CONFIG_DIR, { recursive: true });
  } catch (error) {
    // Directory might already exist
  }
}

async function setupRegtest() {
  console.log('🚀 Bitcoin Regtest Setup\n');

  try {
    // Connect to Bitcoin Core
    console.log('📡 Connecting to Bitcoin Core...');
    const rpc = await createRpcClient();

    // Check if regtest
    const isRegtest = await rpc.isRegtest();
    if (!isRegtest) {
      throw new Error('Bitcoin Core is not running in regtest mode!');
    }

    console.log('✓ Connected to regtest node\n');

    // Get current block count
    const blockCount = await rpc.getBlockcount();
    console.log(`Current block height: ${blockCount}`);

    // Create a wallet if it doesn't exist
    console.log('\n🔐 Creating wallet...');
    try {
      await rpc.call('createwallet', ['default', false, false, '', false, false, true]); // descriptor wallet for modern setup
      console.log('✓ Wallet created');
    } catch (error) {
      if (error.message.includes('already exists')) {
        console.log('✓ Wallet already exists');
      } else if (error.message.includes('Wallet default already')) {
        console.log('✓ Wallet already exists');
      } else {
        console.log(`⚠️  Wallet creation: ${error.message}`);
      }
    }

    // Ensure we have enough blocks for coinbase maturity
    let minerAddress = null;
    if (blockCount < 101) {
      console.log('\n💎 Generating initial blocks...');
      minerAddress = await rpc.getNewAddress();
      const blocks = await rpc.generateBlocks(101, minerAddress);
      console.log(`✓ Generated ${blocks.length} blocks`);
      console.log(`✓ Miner address: ${minerAddress}`);
    } else {
      // Get a miner address for later use
      minerAddress = await rpc.getNewAddress();
    }

    // Get balance
    const balance = await rpc.getBalance();
    console.log(`\n💰 Wallet balance: ${balance} BTC\n`);

    // Create test addresses
    console.log('🔑 Creating test addresses...');
    await ensureConfigDir();

    const wallets = {
      createdAt: new Date().toISOString(),
      addresses: [],
      minerAddress: minerAddress
    };

    for (let i = 0; i < 3; i++) {
      const addr = await rpc.getNewAddress();
      wallets.addresses.push({
        name: `test-address-${i}`,
        address: addr,
        index: i
      });
      console.log(`  [${i}] ${addr}`);
      
      // Import the address into the wallet (for watch-only or similar)
      try {
        // Send a small amount to each address to ensure they have UTXOs
        await rpc.call('sendtoaddress', [addr, 1]);
      } catch (e) {
        // Address might not need importing
      }
    }

    // Generate one more block to confirm the sends
    console.log('\n⛏️  Generating block to confirm addresses...');
    const newAddr = await rpc.getNewAddress();
    await rpc.generateBlocks(1, newAddr);
    console.log('✓ Block generated');

    // Save wallet info
    await fs.writeFile(WALLETS_FILE, JSON.stringify(wallets, null, 2));
    console.log(`\n✓ Wallet addresses saved to ${WALLETS_FILE}`);

    console.log('\n✅ Regtest setup complete!\n');
    console.log('💰 Wallet Summary:');
    const finalBalance = await rpc.getBalance();
    console.log(`  Total balance: ${finalBalance} BTC`);
    console.log(`  Miner address: ${minerAddress}`);
    console.log(`  Test addresses: ${wallets.addresses.length} created\n`);
    console.log('🎯 Next steps:');
    console.log('  1. Fund your test wallets from the addresses above');
    console.log('  2. Update your BIP39 mnemonic in test-mnemonic.json');
    console.log('  3. Run: npm run example-regtest test-mnemonic.json\n');
  } catch (error) {
    console.error('❌ Setup failed:', error.message);
    console.error('\n💡 Troubleshooting:');
    console.error('   Make sure Bitcoin Core is running in regtest mode:');
    console.error('   Option 1 (Local): bitcoind -regtest -rpcuser=bitcoin -rpcpassword=bitcoin');
    console.error('   Option 2 (Docker): docker-compose up -d');
    process.exit(1);
  }
}

setupRegtest();
