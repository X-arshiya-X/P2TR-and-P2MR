#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinClient } from "./lib.mjs";

const network = bitcoin.networks.testnet;
const mempool = "https://mempool.space/testnet4/api";

const client = new BitcoinClient(network, mempool);

const mnemonic = JSON.parse(await readFile(process.argv[2]));

// ============================================
// P2MR Direct Spend Example
// ============================================
console.log("=== P2MR Direct Spend (Single Condition) ===");
const directAccount0 = client.getMerkleRootDirectWallet(mnemonic, 0);
console.log(`Direct-Spend Account 0 address: ${directAccount0.address}`);
console.log(`Direct-Spend Account 0 Balance: ${await client.getBalance(directAccount0.address)}`);

const directAccount1 = client.getMerkleRootDirectWallet(mnemonic, 1);
console.log(`Direct-Spend Account 1 address: ${directAccount1.address}`);
console.log(`Direct-Spend Account 1 Balance: ${await client.getBalance(directAccount1.address)}`);

// Create and sign transaction (direct spend)
const directAmount = BigInt(Math.floor(0.001 * 100000000));
try {
    const unsignedDirectTx = await directAccount0.createTransaction(directAccount1.address, directAmount);
    const signedDirectTx = await directAccount0.signTransaction(unsignedDirectTx);
    console.log(`Direct-Spend transaction created and signed`);
    // console.log(await client.sendTransaction(signedDirectTx));
} catch (e) {
    console.log(`Transaction creation skipped: ${e.message}`);
}

console.log("\n");

// ============================================
// P2MR Script Spend Example
// ============================================
console.log("=== P2MR Script Spend (Multiple Conditions in Merkle Tree) ===");
const scriptAccount0 = client.getMerkleRootScriptWallet(mnemonic, 2);
console.log(`Script-Spend Account 0 address: ${scriptAccount0.address}`);
console.log(`Script-Spend Account 0 Balance: ${await client.getBalance(scriptAccount0.address)}`);

const scriptAccount1 = client.getMerkleRootScriptWallet(mnemonic, 3);
console.log(`Script-Spend Account 1 address: ${scriptAccount1.address}`);
console.log(`Script-Spend Account 1 Balance: ${await client.getBalance(scriptAccount1.address)}`);

// Display available scripts in merkle tree
console.log(`\nAvailable spending conditions in merkle tree:`);
console.log(`  Script 1: OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG`);
console.log(`  Script 2: OP_SHA256 <hash> OP_EQUAL (hash-lock)`);
console.log(`  Script 3: <blockheight> OP_CHECKLOCKTIMEVERIFY OP_DROP OP_0 (time-lock)`);
console.log(`  Preimage for Script 2: ${scriptAccount0.preimage.toString()}`);

// Create and sign transaction (script spend)
const scriptAmount = BigInt(Math.floor(0.001 * 100000000));
try {
    const unsignedScriptTx = await scriptAccount0.createTransaction(scriptAccount1.address, scriptAmount);
    const signedScriptTx = await scriptAccount0.signTransaction(unsignedScriptTx, 0);
    console.log(`\nScript-Spend transaction created and signed`);
    // console.log(await client.sendTransaction(signedScriptTx));
} catch (e) {
    console.log(`\nTransaction creation skipped: ${e.message}`);
}
