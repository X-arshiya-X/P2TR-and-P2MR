#!/usr/bin/env node
/**
 * Import taproot xpub from mnemonic into Bitcoin Core wallet
 */

import { createRpcClient } from './scripts/rpc-client.mjs';
import { readFile } from 'fs/promises';
import * as bip39 from 'bip39';
import { BIP32Factory } from 'bip32';
import * as ecc from 'tiny-secp256k1';

const rpc = await createRpcClient();
const bip32 = BIP32Factory(ecc);

console.log('📥 Importing taproot key into Bitcoin Core...\n');

try {
  const mnemonic = JSON.parse(await readFile('./mnemonic.json'));
  const phrase = mnemonic.join(' ');
  const seed = bip39.mnemonicToSeedSync(phrase);
  const root = bip32.fromSeed(seed, { bip32: {
    "bip32_prefix": 0x04b24746,  // tpub prefix for testnet
    "private_prefix": 0x04b2430c  // tprv prefix for testnet
  }});

  // BIP-86 path: m/86'/1'/account'/0/0
  const account0 = root
    .deriveHardened(86)
    .deriveHardened(1)
    .deriveHardened(0);

  const xpub = account0.neutered().toBase58();
  console.log(`Derived xpub: ${xpub}`);

  // Import public key descriptor for receiving addresses
  const desc = `tr(${xpub}/0/*)#7s925a22`;
  
  console.log(`Importing descriptor: ${desc}\n`);
  
  const result = await rpc.call('importdescriptors', [[{
    "descriptor": desc,
    "timestamp": "now",
    "active": true,
    "range": [0, 100],
    "internal": false
  }]]);

  console.log('✓ Import result:');
  console.log(JSON.stringify(result, null, 2));
  
  // List addresses
  console.log('\nDerived addresses:');
  for (let i = 0; i < 5; i++) {
    const node = account0.derive(0).derive(i);
    const p2tr = require('bitcoinjs-lib').payments.p2tr({
      internalPubkey: node.publicKey.subarray(1),
      network: { messagePrefix: '\x18Bitcoin Signed Message:\n', bech32: 'bcrt', pubKeyHash: 111, scriptHash: 196, wif: 239 }
    });
    console.log(`  [${i}] ${p2tr.address}`);
  }

} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}
