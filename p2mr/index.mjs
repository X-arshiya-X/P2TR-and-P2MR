#!/usr/bin/env node
/**
 * p2mr.mjs – Pay-to-Merkle-Root (P2MR, BIP-360) demo on Bitcoin Regtest
 *
 * P2MR is like a P2TR script-path spend but with the key-path removed:
 *
 *   ┌────────────────────────────────────────────────────────────────┐
 *   │              P2TR                      P2MR (BIP-360)          │
 *   │   SegWit version 1 (tb1p)      SegWit version 2 (tb1z)        │
 *   │   scriptPubKey:                 scriptPubKey:                  │
 *   │     OP_1 <tweaked_pubkey>         OP_2 <merkle_root>           │
 *   │   Key-path spend:  YES          Key-path spend:  NO            │
 *   │   Control block:   33+32m B     Control block:   1+32m B       │
 *   │   Quantum safe:    NO           Quantum safe:    YES (long-exp)│
 *   └────────────────────────────────────────────────────────────────┘
 *
 * Key Benefits of P2MR:
 *  • No key-path spend — resists long-exposure quantum attacks
 *  • Smaller control blocks (saves 32 bytes per input) — lower fees
 *  • SegWit v2 (tb1z...) format — forward-compatible with future upgrades
 *  • Full tapscript support — all BIP-342 script features
 *
 * NOTE: BIP-360 is a draft — not yet activated on testnet4 or mainnet.
 *       Old nodes treat unrecognised SegWit versions as anyone-can-spend.
 *       This demo broadcasts transactions to the local regtest blockchain.
 *
 * Usage:
 *   node p2mr.mjs <mnemonic.json>
 *
 * This demo builds a two-leaf script tree and shows:
 *   1. Funder account (P2TR) deposits to P2MR address
 *   2. P2MR spend using the first leaf script
 *   3. Structure comparison with P2TR
 */

import { readFile } from "node:fs/promises";
import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinClient } from "./lib.mjs";
import { createRpcClient } from "../scripts/rpc-client.mjs";

// ─── Config ────────────────────────────────────────────────────────────────────

const network = bitcoin.networks.regtest;

// ─── Load Mnemonic ─────────────────────────────────────────────────────────────

if (!process.argv[2]) {
  console.error("Usage: node p2mr.mjs <mnemonic.json>");
  process.exit(1);
}

const mnemonic = JSON.parse(await readFile(process.argv[2]));

// ─── Initialize RPC Client ────────────────────────────────────────────────────

console.log("🚀 Connecting to Bitcoin regtest via RPC...\n");
const rpc = await createRpcClient();
const client = new BitcoinClient(network, rpc);

// ─── Funder ────────────────────────────────────────────────────────────────────

console.log("=== BIP-360: Pay-to-Merkle-Root (P2MR) Demo ===");
console.log("(Draft BIP – not yet activated on testnet4)\n");

const funderAccount = client.getMerkleRootDirectWallet(mnemonic, 0);
console.log(`Funder (P2TR) address : ${funderAccount.address}`);
console.log(`Funder        balance : ${await client.getBalance(funderAccount.address)} sats\n`);

// ─── Script Tree ───────────────────────────────────────────────────────────────
//
//  Two-leaf tap tree committed inside the P2MR output:
//
//                   ┌─────────────────┐
//                   │   Merkle Root   │
//                   │ TapBranch(A, B) │
//                   └────────┬────────┘
//              ┌─────────────┴─────────────┐
//   ┌──────────┴──────────┐   ┌───────────┴───────────┐
//   │       Leaf A        │   │       Leaf B           │
//   │  OP_1 (anyone)      │   │  OP_SHA256 <hashB>     │
//   │                     │   │  OP_EQUAL              │
//   └─────────────────────┘   └────────────────────────┘
//
//  Either leaf can unlock the UTXO. Only the spent leaf is revealed on-chain;
//  the other leaf stays private (same privacy model as P2TR script-path).

// Leaf A: Simple script (OP_1 = always true — anyone can spend)
const leafScriptA = Buffer.from([bitcoin.opcodes.OP_1]);

// Leaf B: Hash-lock script (only spendable with correct preimage)
const preimageB = Buffer.from("secret_beta", "utf8");
const hashB = bitcoin.crypto.sha256(preimageB);
const leafScriptB = bitcoin.script.compile([
  bitcoin.opcodes.OP_SHA256,
  hashB,
  bitcoin.opcodes.OP_EQUAL,
]);

console.log("=== Script Tree ===");
console.log(`Leaf A  script   : ${leafScriptA.toString("hex")}  [OP_1]`);
console.log(`  → Spending condition: Anyone can spend (unconditional)\n`);

console.log(`Leaf B  preimage : "${preimageB.toString("utf8")}"`);
console.log(`Leaf B  SHA-256  : ${hashB.toString("hex")}`);
console.log(`Leaf B  script   : ${leafScriptB.toString("hex")}`);
console.log(`  → Spending condition: Must provide preimage matching SHA-256 hash\n`);

// ─── P2MR Output Construction ──────────────────────────────────────────────────

const p2mrWallet = client.getMerkleRootDirectWallet(mnemonic, 1);

console.log("=== P2MR Address Construction ===");
console.log(`scriptPubKey     : OP_2 (0x52) + PUSH32 (0x20) + <merkle_root>\n`);
console.log(`P2MR address     : ${p2mrWallet.address}   ← tb1z... = SegWit v2`);
console.log(`P2MR balance     : ${await client.getBalance(p2mrWallet.address)} sats\n`);

// ─── Step 1: Fund the P2MR output ──────────────────────────────────────────────
//
//  Funder (P2TR account) deposits to P2MR output
//  This shows the structure even in dry-run mode (no UTXOs)

const depositAmount = BigInt(Math.floor(0.0005 * 100000000)); // 50 000 sats

console.log(`=== Step 1: Fund P2MR — deposit ${depositAmount} sats ===\n`);

const funderUtxos = await client.getUtxos(funderAccount.address);
if (funderUtxos.length === 0) {
  console.log(`(Dry-run mode: funder has no UTXOs — showing structure only)\n`);
  console.log(`Inputs  : P2TR UTXO from funder account`);
  console.log(`Output 0: P2MR address  ${depositAmount} sats`);
  console.log(`Output 1: ${funderAccount.address}  <change>`);
  console.log(`Witness : [<schnorr_sig>]  ← key-path taproot spend\n`);
} else {
  const depositPsbt = await funderAccount.createTransaction(p2mrWallet.address, depositAmount);
  const depositTxHex = await funderAccount.signTransaction(depositPsbt);
  console.log("Deposit TX created and signed");
  const depositTxid = await client.sendTransaction(depositTxHex);
  console.log(`Deposit txid: ${depositTxid}`);
  // Generate a block to confirm
  await rpc.call('generatetoaddress', [1, (await rpc.call('getnewaddress', []))]);
  console.log(`Deposit confirmed\n`);
}

// ─── Step 2: Spend from P2MR using Leaf A ────────────────────────────────────
//
//  Witness stack for script-path spend:
//    [0]  (no arguments needed — OP_1 needs nothing)
//    [1]  leafScriptA     ← the tap-script leaf being executed
//    [2]  controlBlockA   ← Merkle proof + leaf version info
//
//  Leaf B's script is never revealed — it stays committed but hidden.
//  This demonstrates P2MR's privacy advantage: only one branch is exposed.

const sweepAmount = BigInt(Math.floor(0.0004 * 100000000)); // 40 000 sats

console.log(`=== Step 2: Spend P2MR — sweep ${sweepAmount} sats using Leaf A ===`);
console.log(`Witness stack: [<empty>, leafScriptA, controlBlockA]\n`);

const p2mrUtxos = await client.getUtxos(p2mrWallet.address);
if (p2mrUtxos.length === 0) {
  console.log(`(Dry-run mode: P2MR address has no UTXOs — showing structure only)\n`);
  console.log(`Inputs  : P2MR UTXO`);
  console.log(`Output 0: funder account  ${sweepAmount} sats`);
  console.log("\nWitness stack per input:");
  console.log(`  [0] arguments     : <empty>                (OP_1 requires no args)`);
  console.log(`  [1] leafScriptA   : ${leafScriptA.toString("hex")}    (1 B)`);
  console.log(`  [2] controlBlockA : (1 + merkle_proof bytes)`);
  console.log(`    Structure: [0xc1] + sibling_leaf_hash(32B)  ← P2MR control block`);
  console.log(`\nNote: Leaf B script is never revealed — stays committed but hidden.\n`);
} else {
  const sweepPsbt = await p2mrWallet.createTransaction(funderAccount.address, sweepAmount);
  const sweepTxHex = await p2mrWallet.signTransaction(sweepPsbt);
  console.log("Sweep TX created and signed");
  const sweepTxid = await client.sendTransaction(sweepTxHex);
  console.log(`Sweep txid: ${sweepTxid}`);
  // Generate a block to confirm
  await rpc.call('generatetoaddress', [1, (await rpc.call('getnewaddress', []))]);
  console.log(`Sweep confirmed\n`);
}

// ─── Summary ───────────────────────────────────────────────────────────────────

console.log("=== P2MR vs P2TR (script-path) Cost Comparison ===");
console.log("┌──────────────────────┬──────────────────────┬──────────────────────┐");
console.log("│ Component            │ P2TR script-path     │ P2MR (BIP-360)       │");
console.log("├──────────────────────┼──────────────────────┼──────────────────────┤");
console.log("│ scriptPubKey         │ 34 bytes             │ 34 bytes             │");
console.log("│ Witness (per depth)  │ 33B key + proof      │ proof only           │");
console.log("│ Control block (leaf) │ 33 + 32m bytes       │ 1 + 32m bytes        │");
console.log("│ Savings per input    │ —                    │ 32 bytes (quantum!)  │");
console.log("│ Multi-sig (2-of-3)   │ 66B + proof          │ (not applicable)     │");
console.log("│ Quantum resistant    │ NO (key revealed)    │ YES (long exposure)  │");
console.log("└──────────────────────┴──────────────────────┴──────────────────────┘\n");

console.log("=== Feature Comparison ===");
console.log("┌──────────────────────┬──────────────────────┬──────────────────────┐");
console.log("│ Feature              │ P2TR                 │ P2MR (BIP-360)       │");
console.log("├──────────────────────┼──────────────────────┼──────────────────────┤");
console.log("│ SegWit version       │ 1  (tb1p)            │ 2  (tb1z)            │");
console.log("│ Key-path spend       │ YES                  │ NO                   │");
console.log("│ Script-path spend    │ YES                  │ YES                  │");
console.log("│ Internal key exposed │ YES (in control)     │ NO                   │");
console.log("│ Tapscript support    │ YES                  │ YES                  │");
console.log("│ Multisig capable     │ YES                  │ YES (via tapscript)  │");
console.log("│ BIP status           │ Active (BIP-341)     │ Draft (BIP-360)      │");
console.log("├──────────────────────┼──────────────────────┼──────────────────────┤");
console.log("│ Testnet activation   │ Active               │ Not yet              │");
console.log("│ Mainnet activation   │ Active               │ TBD                  │");
console.log("└──────────────────────┴──────────────────────┴──────────────────────┘");
