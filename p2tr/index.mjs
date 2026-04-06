#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import * as bitcoin from 'bitcoinjs-lib';
import { BitcoinClient } from "./lib.mjs";

const network = bitcoin.networks.testnet;
const mempool = "https://mempool.space/testnet4/api";

const client = new BitcoinClient(network, mempool);

const mnemonic = JSON.parse(await readFile(process.argv[2]));

// ============================================
// P2TR Key-Path Spend Example
// ============================================
console.log("=== P2TR Key-Path Spend ===");
const keyPathAccount0 = client.getTaprootKeyPathWallet(mnemonic, 0);
console.log(`Key-Path Account 0 address: ${keyPathAccount0.address}`);
console.log(`Key-Path Account 0 Balance: ${await client.getBalance(keyPathAccount0.address)}`);

const keyPathAccount1 = client.getTaprootKeyPathWallet(mnemonic, 1);
console.log(`Key-Path Account 1 address: ${keyPathAccount1.address}`);
console.log(`Key-Path Account 1 Balance: ${await client.getBalance(keyPathAccount1.address)}`);

// Create and sign transaction (key-path spend)
const keyPathAmount = BigInt(Math.floor(0.001 * 100000000));
try {
    const unsignedKeyPathTx = await keyPathAccount0.createTransaction(keyPathAccount1.address, keyPathAmount);
    const signedKeyPathTx = await keyPathAccount0.signTransaction(unsignedKeyPathTx);
    console.log(`Key-Path transaction created and signed`);
    // console.log(await client.sendTransaction(signedKeyPathTx));
} catch (e) {
    console.log(`Transaction creation skipped: ${e.message}`);
}

console.log("\n");

// ============================================
// P2TR Script-Path Spend Example
// ============================================
console.log("=== P2TR Script-Path Spend ===");
const scriptPathAccount0 = client.getTaprootScriptPathWallet(mnemonic, 2);
console.log(`Script-Path Account 0 address: ${scriptPathAccount0.address}`);
console.log(`Script-Path Account 0 Balance: ${await client.getBalance(scriptPathAccount0.address)}`);

const scriptPathAccount1 = client.getTaprootScriptPathWallet(mnemonic, 3);
console.log(`Script-Path Account 1 address: ${scriptPathAccount1.address}`);
console.log(`Script-Path Account 1 Balance: ${await client.getBalance(scriptPathAccount1.address)}`);

// Create and sign transaction (script-path spend)
const scriptPathAmount = BigInt(Math.floor(0.001 * 100000000));
try {
    const unsignedScriptPathTx = await scriptPathAccount0.createTransaction(scriptPathAccount1.address, scriptPathAmount);
    const signedScriptPathTx = await scriptPathAccount0.signTransaction(unsignedScriptPathTx);
    console.log(`Script-Path transaction created and signed`);
    // console.log(await client.sendTransaction(signedScriptPathTx));
} catch (e) {
    console.log(`Transaction creation skipped: ${e.message}`);
}
