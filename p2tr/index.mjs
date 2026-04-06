#!/usr/bin/env node
/**
 * p2tr.mjs – Pay-to-Taproot (P2TR, BIP-341) demo on Bitcoin Regtest
 *
 * P2TR is the native taproot spending mechanism with two paths:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │                        P2TR Output                              │
 *   │                  scriptPubKey Format                            │
 *   │        OP_1 (0x51)  |  OP_PUSHBYTES_32 (0x20)  |  <key>        │
 *   │                    SegWit v1  (tb1p...)                        │
 *   │                                                                  │
 *   │   Path 1: Key-Path Spend (Most Private)                        │
 *   │      • Witness: [<schnorr_signature>]                          │
 *   │      • Looks like any key spend on-chain                       │
 *   │      • cheapest spend path                                     │
 *   │                                                                  │
 *   │   Path 2: Script-Path Spend (Reveals Script)                   │
 *   │      • Witness: [<...args...>, <script>, <control_block>]      │
 *   │      • Control block includes: leaf_version | parity |         │
 *   │        internal_key(32B) | merkle_proof...                     │
 *   │      • Only one script in tree revealed (others stay hidden)    │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * Usage:
 *   node p2tr.mjs <mnemonic.json>
 *
 * Where <mnemonic.json> is a JSON file containing the BIP-39 word array:
 *   ["word1","word2",...,"word12"]
 *
 * This demo shows:
 *   1. Key-Path Spend: account0 → account1  (most private, schnorr signature)
 *   2. Script-Path Spend: hash-lock example (anyone with preimage can spend)
 *
 * Transactions are broadcast to the local regtest blockchain.
 */

import { readFile } from "node:fs/promises";
import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinClient } from "./lib.mjs";
import { createRpcClient } from "../scripts/rpc-client.mjs";

// Encode a witness stack into the Bitcoin serialization format
function serializeWitness(items) {
    const encodeVarInt = n => n < 0xfd
        ? Buffer.from([n])
        : Buffer.concat([Buffer.from([0xfd]), Buffer.from([n & 0xff, (n >> 8) & 0xff])]);
    return Buffer.concat([
        encodeVarInt(items.length),
        ...items.flatMap(item => [encodeVarInt(item.length), item])
    ]);
}

// ─── Config ────────────────────────────────────────────────────────────────────

const network = bitcoin.networks.regtest;

// ─── Load Mnemonic ─────────────────────────────────────────────────────────────

if (!process.argv[2]) {
  console.error("Usage: node p2tr.mjs <mnemonic.json>");
  process.exit(1);
}

const mnemonic = JSON.parse(await readFile(process.argv[2]));

// ─── Initialize RPC Client ────────────────────────────────────────────────────

console.log("🚀 Connecting to Bitcoin regtest via RPC...\n");
const rpc = await createRpcClient();
const client = new BitcoinClient(network, rpc);

// ─── 1. Key-Path Spend  ────────────────────────────────────────────────────────
//
//  The key-path spend is the default path for P2TR outputs. It requires only
//  a single Schnorr signature and reveals no script information on-chain.
//  No script is revealed — maximally private and efficient.

console.log("=== P2TR Key-Path Spend (Most Private) ===\n");

const keyPathAccount0 = client.getTaprootKeyPathWallet(mnemonic, 0);
console.log(`Account 0  address : ${keyPathAccount0.address}`);
console.log(`Account 0  balance : ${await client.getBalance(keyPathAccount0.address)} BTC\n`);

const keyPathAccount1 = client.getTaprootKeyPathWallet(mnemonic, 1);
console.log(`Account 1  address : ${keyPathAccount1.address}`);
console.log(`Account 1  balance : ${await client.getBalance(keyPathAccount1.address)} BTC\n`);

// Create and sign transaction (key-path spend)
//   • No script tree involved — just tweaked key + schnorr sig
//   • Cheapest spend path (only 64-byte signature in witness)
//   • Indistinguishable from other P2TR key-path spends
const keyPathAmount = BigInt(Math.floor(0.001 * 100000000)); // 100 000 sats
try {
    const unsignedKeyPathTx = await keyPathAccount0.createTransaction(keyPathAccount1.address, keyPathAmount);
    const signedKeyPathTx = await keyPathAccount0.signTransaction(unsignedKeyPathTx);
    console.log(`[Key-Path] Transaction created and signed`);
    console.log(`Witness stack: [<schnorr_signature(64 bytes)>]\n`);
    const keyPathTxid = await client.sendTransaction(signedKeyPathTx);
    console.log(`[Key-Path] Transaction sent: ${keyPathTxid}`);
    // Generate a block to confirm
    await rpc.call('generatetoaddress', [1, (await rpc.call('getnewaddress', []))]);
    console.log(`[Key-Path] Block generated and transaction confirmed\n`);
} catch (e) {
    console.log(`[Key-Path] Transaction creation skipped: ${e.message}\n`);
}

// ─── 2. Script-Path Spend  ────────────────────────────────────────────────────
//
//  We commit a "hash-lock" script inside the tap tree:
//
//    OP_SHA256 <hash> OP_EQUALVERIFY OP_TRUE
//
//  To spend, the witness stack must be:
//    <preimage>  <redeemScript>  <controlBlock>
//
//  This demonstrates how tap-script leaves provide flexible spending conditions.
//  The hash-lock is a simple example; real use cases include multisig, timelocks, etc.

console.log("=== P2TR Script-Path Spend (Hash-Lock Example) ===\n");

// Step 1: Create a hash-lock script that accepts anyone who knows a preimage
const preimage = Buffer.from("hello taproot", "utf8");
const preimageHash = bitcoin.crypto.sha256(preimage);

console.log(`Preimage         : "${preimage.toString("utf8")}"`);
console.log(`SHA-256(preimage): ${preimageHash.toString("hex")}`);

// Script reads top of stack, hashes it, and compares against the commitment
//   OP_SHA256 <expected_hash> OP_EQUALVERIFY OP_TRUE
const hashLockScript = bitcoin.script.compile([
  bitcoin.opcodes.OP_SHA256,
  preimageHash,
  bitcoin.opcodes.OP_EQUALVERIFY,
  bitcoin.opcodes.OP_TRUE,
]);

console.log(`Hash-lock script : ${hashLockScript.toString("hex")}\n`);

// Step 2: Create a P2TR address that commits to this script
// Need x-only pubkey (32 bytes), so strip the prefix from 33-byte compressed pubkey
const internalPubkey = keyPathAccount0.publicKey.subarray(1);
const scriptWallet = client.getTaprootScriptWallet(hashLockScript, internalPubkey);

console.log(`Script P2TR address : ${scriptWallet.address}`);
console.log(`Script balance      : ${await client.getBalance(scriptWallet.address)} BTC\n`);

// Step 3: Deposit into the hash-lock address
const depositAmount = BigInt(Math.floor(0.0005 * 100000000)); // 50 000 sats

console.log(`[Script-Path] Depositing ${depositAmount} sats into hash-lock address…`);
try {
    const depositPsbt = await keyPathAccount0.createTransaction(scriptWallet.address, depositAmount);
    const depositTxHex = await keyPathAccount0.signTransaction(depositPsbt);
    console.log(`[Script-Path] Deposit transaction created and signed`);
    const depositTxid = await client.sendTransaction(depositTxHex);
    console.log(`[Script-Path] Deposit transaction sent: ${depositTxid}`);
    // Generate a block to confirm
    await rpc.call('generatetoaddress', [1, (await rpc.call('getnewaddress', []))]);
    console.log(`[Script-Path] Deposit confirmed\n`);
} catch (e) {
    console.log(`[Script-Path] Deposit transaction skipped: ${e.message}\n`);
}

// Step 4: Spend from hash-lock address back using the script path
//   Witness stack: [preimage, redeemScript, controlBlock]
const sweepAmount = BigInt(Math.floor(0.0004 * 100000000)); // 40 000 sats

console.log(`[Script-Path] Sweeping ${sweepAmount} sats back to account0…`);
console.log(`Witness stack: [<preimage>, <redeemScript>, <controlBlock>]\n`);

try {
    const sweepPsbt = await scriptWallet.createTransaction(keyPathAccount0.address, sweepAmount);
    // Finalize the sweep with the preimage — witness: [preimage, script, controlBlock]
    const psbt = bitcoin.Psbt.fromHex(sweepPsbt, { network });
    psbt.finalizeInput(0, (_idx, input) => ({
        finalScriptWitness: serializeWitness([
            preimage,
            input.tapLeafScript[0].script,
            input.tapLeafScript[0].controlBlock,
        ])
    }));
    const sweepTxHex = psbt.extractTransaction().toHex();
    
    const sweepTxid = await client.sendTransaction(sweepTxHex);
    console.log(`[Script-Path] Sweep transaction sent: ${sweepTxid}`);
    // Generate a block to confirm
    await rpc.call('generatetoaddress', [1, (await rpc.call('getnewaddress', []))]);
    console.log(`[Script-Path] Sweep confirmed\n`);
} catch (e) {
    console.log(`[Script-Path] Sweep transaction skipped: ${e.message}\n`);
}

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log("=== P2TR Key-Path vs Script-Path Comparison ===");
console.log("┌──────────────────────┬──────────────────────┬──────────────────────┐");
console.log("│ Feature              │ Key-Path             │ Script-Path          │");
console.log("├──────────────────────┼──────────────────────┼──────────────────────┤");
console.log("│ Privacy              │ Maximum (no script)  │ Minimal (reveals 1)  │");
console.log("│ Witness size         │ 64 bytes (sig)       │ 64B + script + proof │");
console.log("│ Cost                 │ Cheapest             │ More expensive       │");
console.log("│ Complexity           │ Single key           │ Multiple conditions  │");
console.log("│ Control block        │ Never needed         │ Includes 33+ bytes   │");
console.log("│ Default path         │ YES (preferred)      │ Fallback             │");
console.log("└──────────────────────┴──────────────────────┴──────────────────────┘");
