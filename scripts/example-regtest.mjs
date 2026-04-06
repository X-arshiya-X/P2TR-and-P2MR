#!/usr/bin/env node

/**
 * Example: Using regtest for testing
 * 
 * This demonstrates how to use the unified client with regtest mode
 * 
 * Usage:
 *   node example-regtest.mjs <mnemonic-file>
 */

import { readFile } from "node:fs/promises";
import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinClient, RpcDataLayer } from './unified-client.mjs';
import { createRpcClient } from './rpc-client.mjs';

async function main() {
  try {
    // Check arguments
    if (process.argv.length < 3) {
      console.error('Usage: node example-regtest.mjs <mnemonic-file>');
      console.error('Example: node example-regtest.mjs mnemonic.json');
      process.exit(1);
    }

    // Connect to Bitcoin Core regtest
    console.log('🚀 Connecting to Bitcoin regtest...\n');
    const rpc = await createRpcClient();

    // Create data layer for regtest
    const dataLayer = new RpcDataLayer(rpc);

    // Create Bitcoin client with regtest
    const client = new BitcoinClient('regtest', dataLayer);

    // Load mnemonic
    console.log('📖 Loading mnemonic...');
    const mnemonic = JSON.parse(await readFile(process.argv[2]));

    // Create wallets for different accounts
    console.log('🔑 Creating wallets from mnemonic...\n');

    const account0 = client.getAccountWallet(mnemonic, 0);
    console.log(`Account 0 address: ${account0.address}`);
    console.log(`Account 0 Balance: ${await client.getBalance(account0.address)} BTC`);

    const account1 = client.getAccountWallet(mnemonic, 1);
    console.log(`\nAccount 1 address: ${account1.address}`);
    console.log(`Account 1 Balance: ${await client.getBalance(account1.address)} BTC`);

    // Get UTXOs
    console.log('\n📊 UTXOs for Account 0:');
    const utxos = await client.getUtxos(account0.address);
    if (utxos.length === 0) {
      console.log('  No UTXOs found. To fund this address:');
      console.log(`  1. Generate blocks: bitcoin-cli -regtest generatetoaddress 10 $(bitcoin-cli -regtest getnewaddress)`);
      console.log(`  2. Send BTC: bitcoin-cli -regtest sendtoaddress ${account0.address} 1`);
      console.log(`  3. Generate a block: bitcoin-cli -regtest generatetoaddress 1 $(bitcoin-cli -regtest getnewaddress)`);
    } else {
      utxos.forEach((utxo, i) => {
        console.log(`  [${i}] ${utxo.txid}:${utxo.vout} = ${Number(utxo.value) / 100000000} BTC`);
      });
    }

    // Transaction example
    console.log('\n💸 Creating transaction example...');
    const amount = BigInt(Math.floor(0.001 * 100000000)); // 0.001 BTC in satoshis

    try {
      const unsignedTx = await account0.createTransaction(account1.address, amount);
      const signedTx = account0.signTransaction(unsignedTx);

      console.log('✓ Transaction created and signed');
      console.log(`  Sending 0.001 BTC to ${account1.address}`);
      console.log(`  Raw TX (first 100 chars): ${signedTx.slice(0, 100)}...`);

      // Optionally send transaction
      console.log('\n📤 To broadcast this transaction:');
      console.log('  1. Uncomment the sendTransaction call in this script');
      console.log('  2. Run: bitcoin-cli -regtest generatetoaddress 1 $(bitcoin-cli -regtest getnewaddress)');
      console.log('  3. Check balance: bitcoin-cli -regtest getbalance');

      // Uncomment to actually send:
      // const txid = await client.sendTransaction(signedTx);
      // console.log(`✓ Transaction sent: ${txid}`);
      // 
      // // Generate a block to confirm
      // const blocks = await rpc.generateBlocks(1);
      // console.log(`✓ Generated block: ${blocks[0]}`);
      // 
      // // Check new balances
      // console.log(`\nNew balances after confirmation:`);
      // console.log(`Account 0: ${await client.getBalance(account0.address)} BTC`);
      // console.log(`Account 1: ${await client.getBalance(account1.address)} BTC`);

    } catch (error) {
      console.log('⚠️  Cannot create transaction (likely not enough funds)');
      console.log(`   Error: ${error.message}`);
    }

    console.log('\n✅ Example complete!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

main();
