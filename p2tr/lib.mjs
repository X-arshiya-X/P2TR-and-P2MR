/**
 * lib.mjs – Bitcoin helper library for P2TR demos on testnet4
 *
 * This module provides:
 *   - BitcoinClient: Network context + wallet factory methods
 *   - TaprootKeyPathWallet: P2TR wallet for key-path spends (Schnorr signature)
 *   - TaprootScriptPathWallet: P2TR wallet for script-path spends (tapscript)
 *
 * All wallets use BIP-86 derivation for taproot (m/86'/1'/account'/0/0)
 * on Bitcoin testnet4 using mempool.space API for balance/UTXO queries.
 *
 * Key Concepts:
 *   • Key-Path: Sign with tweaked private key (most private path)
 *   • Script-Path: Reveal and execute a committed tap-script
 *   • Tapscript: BIP-342 Bitcoin script executed in Merkle tree leaves
 *   • Internal Key: The base Schnorr key before tweak (can be NUMS for script-only)
 */

import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from "ecpair";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

const DUST = 546;

// ─── Network Helpers ──────────────────────────────────────────────────────────

/**
 * Fetch JSON from mempool.space-compatible API
 * @param {string} path – Full API endpoint URL
 * @returns {Promise<Object>} Parsed JSON response
 * @throws {Error} If response is not 2xx
 */
async function jget(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

/**
 * Select UTXOs from address using greedy algorithm (largest first)
 * Estimates transaction size and calculates fees automatically
 * @param {string} mempool – Mempool API base URL
 * @param {string} address – Bitcoin address to select from
 * @param {bigint} amount – Satoshis to send
 * @param {string} feeSelection – Fee tier: 'fastestFee' (default), 'halfHourFee', 'hourFee', 'economyFee'
 * @returns {Promise<{utxos: Array, total: bigint, fee: bigint}>} Selected UTXOs and calculated fee
 * @throws {Error} If insufficient funds available
 */
async function selectUtxos(mempool, address, amount, feeSelection = 'halfHourFee'){
    // Get current network fees from mempool.space
    // Fee tiers:
    //   • fastestFee: Next block (urgent)
    //   • halfHourFee: ~30 minutes (default)
    //   • hourFee: ~1 hour (low priority)
    //   • economyFee: No time limit (cheapest)
    const fees = await jget(`${mempool}/v1/fees/recommended`);

    // Fetch and sort UTXOs (largest first for greedy selection)
    const utxos = await jget(`${mempool}/address/${address}/utxo`);
    utxos.forEach(u => u.value = BigInt(u.value));
    utxos.sort((a, b) => (a.value < b.value ? 1 : -1));

    // Select UTXOs until we have enough to cover amount + estimated fee
    let total = 0n;
    let fee = 0n;
    let index = 0;
    do {
        if (index >= utxos.length) throw new Error("Not enough funds");
        const utxo = utxos[index++];
        total += utxo.value;
        
        // Estimate P2TR transaction size:
        //   • 10 bytes: version + locktime
        //   • 58 bytes per input: prevout(36) + scriptSigLength(1) + witness(~20)
        //   • 31 bytes per output: value(8) + scriptPubKeyLength(1) + P2TR_script(34)
        const size = 10 + 58 * (index + 1) + 31 * 2;
        fee = BigInt(fees[feeSelection] * size);
    } while (total < (amount + fee));

    return { utxos: utxos.slice(0, index), total, fee };
}

// ─── TaprootKeyPathWallet (Key-Path P2TR Spend) ─────────────────────────────

/**
 * Pay-to-Taproot wallet for key-path spending
 *
 * Key-path is the "default" way to spend a P2TR output:
 *   • Sign with tweaked private key
 *   • Witness = [schnorr_signature] (64 bytes)
 *   • Most private (looks like any other key spend)
 *   • Only 64B signature revealed on-chain
 *
 * Derivation: m/86'/1'/account'/0/0 (BIP-86)
 */
class TaprootKeyPathWallet {
    
    /**
     * Create a P2TR key-path wallet from mnemonic
     * @param {bitcoin.Network} network – Bitcoin network (mainnet/testnet/regtest)
     * @param {string} mempool – Mempool API base URL
     * @param {string|string[]} mnemonic – BIP-39 mnemonic (space-separated string or word array)
     * @param {number} accountNumber – BIP-44 account index (0-based)
     */
    constructor(network, mempool, mnemonic, accountNumber) {
        // Derive HD node from BIP-39 mnemonic
        const phrase = Array.isArray(mnemonic) ? mnemonic.join(" ") : mnemonic;
        const seed = bip39.mnemonicToSeedSync(phrase);
        const root = bip32.fromSeed(seed, network);
        
        // BIP-86 path: m/86'/1'/account'/0/0
        //   • purpose 86: taproot
        //   • coin 1: Bitcoin testnet
        //   • account: as specified
        //   • change 0: external (receive) chain
        //   • index 0: first address
        const node = root
            .deriveHardened(86)              // Purpose 86 (taproot)
            .deriveHardened(1)               // Coin type 1 (testnet)
            .deriveHardened(accountNumber)   // Account
            .derive(0)                       // External chain
            .derive(0);                      // Index
        
        // Create P2TR output: OP_1 <x-only_pubkey>
        //   x-only = 32 bytes (33-byte compressed pubkey without prefix)
        const pay = bitcoin.payments.p2tr({ 
            internalPubkey: node.publicKey.subarray(1), 
            network 
        });
        
        this.network = network;
        this.mempool = mempool;
        this.address = pay.address;
        this.publicKey = node.publicKey;
        this.privateKey = node.privateKey;
        this.internalPubkey = node.publicKey.subarray(1);
        this.output = pay.output;
    }
    
    /**
     * Sign a PSBT with the key-path private key
     * Uses BIP-340 Schnorr signing with SIGHASH_DEFAULT (0x00)
     * @param {string} psbtHex – Hex-encoded PSBT
     * @returns {string} Signed transaction hex
     */
    signTransaction(psbtHex) {
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: this.network });
        for (let i = 0; i < psbt.data.inputs.length; i++) {
            const keyPair = ECPair.fromPrivateKey(this.privateKey, { network: this.network });
            psbt.signInput(i, keyPair, undefined, 0x81); // 0x81 = SIGHASH_ALL for taproot
        }
        return psbt.toHex();
    }
    
    /**
     * Build an unsigned PSBT sending to an address
     * Automatically selects UTXOs and calculates fee
     * @param {string} toAddress – Destination Bitcoin address
     * @param {bigint} amount – Satoshis to send
     * @param {string} feeSelection – Fee tier ('halfHourFee' by default)
     * @returns {Promise<string>} Unsigned PSBT hex
     */
    async createTransaction(toAddress, amount, feeSelection = 'halfHourFee') {
        const { utxos, total, fee } = await selectUtxos(this.mempool, this.address, amount, feeSelection);
    
        // Create PSBT (Partially Signed Bitcoin Transaction)
        const psbt = new bitcoin.Psbt({ network: this.network });

        // Add inputs (UTXOs to spend)
        for (const inp of utxos) {
            psbt.addInput({
              hash: inp.txid,
              index: inp.vout,
              witnessUtxo: {
                script: this.output,
                value: inp.value,
              },
            });
        }
    
        // Add payment output
        psbt.addOutput({
            address: toAddress,
            value: amount,
        });
    
        // Add change output (if any)
        let change = total - amount - fee;
        if (change >= DUST) {
            psbt.addOutput({ address: this.address, value: change });
        }
    
        return psbt.toHex();
    }
}

// ─── TaprootScriptPathWallet (Script-Path P2TR Spend) ────────────────────────

/**
 * Pay-to-Taproot wallet for script-path spending
 *
 * Script-path is the alternative spend path for P2TR:
 *   • Reveals and executes a committed tap-script
 *   • Witness = [script_args, redeemScript, controlBlock] (variable size)
 *   • More complex but still private (only one branch revealed)
 *   • Uses BIP-342 tapscript for more powerful script operations
 *
 * This template creates a simple pubkey hash script; subclass
 * or modify to use different locking scripts.
 */
class TaprootScriptPathWallet {
    
    /**
     * Create a P2TR script-path wallet from mnemonic
     * @param {bitcoin.Network} network – Bitcoin network
     * @param {string} mempool – Mempool API base URL
     * @param {string|string[]} mnemonic – BIP-39 mnemonic
     * @param {number} accountNumber – BIP-44 account index
     */
    constructor(network, mempool, mnemonic, accountNumber) {
        // Derive HD node (same as key-path)
        const phrase = Array.isArray(mnemonic) ? mnemonic.join(" ") : mnemonic;
        const seed = bip39.mnemonicToSeedSync(phrase);
        const root = bip32.fromSeed(seed, network);
        const node = root
            .deriveHardened(86)
            .deriveHardened(1)
            .deriveHardened(accountNumber)
            .derive(0)
            .derive(0);
        
        // Create a P2PKH-equivalent script: OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
        // This is a standard signature script executed at spend time
        const pubkeyHash = bitcoin.crypto.hash160(node.publicKey);
        const scriptElements = [
            bitcoin.opcodes.OP_DUP,
            bitcoin.opcodes.OP_HASH160,
            pubkeyHash,
            bitcoin.opcodes.OP_EQUALVERIFY,
            bitcoin.opcodes.OP_CHECKSIG
        ];
        const script = bitcoin.script.compile(scriptElements);
        
        // Create P2TR with this script as the single leaf in the tap tree
        const taproot = bitcoin.payments.p2tr({
            internalPubkey: node.publicKey.subarray(1),
            scriptTree: {
                output: script
            },
            network
        });
        
        this.network = network;
        this.mempool = mempool;
        this.address = taproot.address;
        this.publicKey = node.publicKey;
        this.privateKey = node.privateKey;
        this.internalPubkey = node.publicKey.subarray(1);
        this.output = taproot.output;
        this.script = script;
        this.scriptTree = taproot.scriptTree;
    }
    
    /**
     * Sign a PSBT using script-path (requires passing scriptTree)
     * The scriptTree tells bitcoinjs-lib which Merkle leaf to reveal
     * @param {string} psbtHex – Unsigned PSBT hex
     * @returns {string} Signed transaction hex
     */
    signTransaction(psbtHex) {
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: this.network });
        for (let i = 0; i < psbt.data.inputs.length; i++) {
            const keyPair = ECPair.fromPrivateKey(this.privateKey, { network: this.network });
            // Pass scriptTree to enable script-path signing
            psbt.signInput(i, keyPair, undefined, 0x81, this.scriptTree);
        }
        return psbt.toHex();
    }
    
    /**
     * Build an unsigned PSBT (same as key-path wallet)
     * @param {string} toAddress – Destination address
     * @param {bigint} amount – Satoshis to send
     * @param {string} feeSelection – Fee tier
     * @returns {Promise<string>} Unsigned PSBT hex
     */
    async createTransaction(toAddress, amount, feeSelection = 'halfHourFee') {
        const { utxos, total, fee } = await selectUtxos(this.mempool, this.address, amount, feeSelection);
    
        // Create PSBT
        const psbt = new bitcoin.Psbt({ network: this.network });

        // Add inputs
        for (const inp of utxos) {
            psbt.addInput({
              hash: inp.txid,
              index: inp.vout,
              witnessUtxo: {
                script: this.output,
                value: inp.value,
              },
            });
        }
    
        // Add payment output
        psbt.addOutput({
            address: toAddress,
            value: amount,
        });
    
        // Add change output
        let change = total - amount - fee;
        if (change >= DUST) {
            psbt.addOutput({ address: this.address, value: change });
        }
    
        return psbt.toHex();
    }
}

// ─── CustomTaprootScriptWallet (Custom Script-Path P2TR Spend) ──────────────

/**
 * Pay-to-Taproot wallet with a custom tap-script
 *
 * Allows creating P2TR outputs that commit to any arbitrary tap-script.
 * The internal key is supplied by the caller; typically use the account pubkey
 * or a NUMS (Nothing-Up-My-Sleeve) point to disable key-path entirely.
 *
 * To spend, must provide the script arguments + script + control block in witness.
 */
class CustomTaprootScriptWallet {
    
    /**
     * Create a custom script-path P2TR wallet
     * @param {Buffer} redeemScript – Compiled tap-script (use bitcoin.script.compile)
     * @param {Buffer} internalPubkey – 32-byte x-only internal key
     * @param {BitcoinClient} client – Bitcoin client context
     */
    constructor(redeemScript, internalPubkey, client) {
        this._client = client;
        this._redeemScript = redeemScript;
        this._internalPubkey = internalPubkey;

        // Build a single-leaf tap tree with the supplied script
        const scriptTree = { output: redeemScript };

        const p2tr = bitcoin.payments.p2tr({
            internalPubkey,
            scriptTree: scriptTree,
            network: client.network,
        });

        this.address = p2tr.address;
        this.output = p2tr.output;
        this._redeem = bitcoin.payments.p2tr({
            internalPubkey,
            scriptTree: scriptTree,
            redeem: { output: redeemScript, redeemVersion: 0xc0 },
            network: client.network,
        });
    }

    /**
     * Build an unsigned PSBT spending this script-path output to an address
     * The caller is responsible for manually adding witness items (script arguments)
     * @param {string} toAddress – Destination address
     * @param {bigint} amount – Satoshis to send
     * @returns {Promise<bitcoin.Psbt>} Unsigned PSBT (not hex)
     */
    async createTransaction(toAddress, amount) {
        const utxos = await this._client.getUtxos(this.address);
        if (!utxos.length) throw new Error(`No UTXOs at ${this.address}`);

        const feeRate = await this._client.getFeeRate();
        const estimatedFee = BigInt(Math.ceil(feeRate * 250));

        const psbt = new bitcoin.Psbt({ network: this._client.network });
        let inputTotal = 0n;

        for (const utxo of utxos) {
            const txData = await this._client.getTx(utxo.txid);
            const prevout = txData.vout[utxo.vout];

            // Get the control block from the redeem payment
            const controlBlock = this._redeem.witness[this._redeem.witness.length - 1];

            psbt.addInput({
              hash: utxo.txid,
              index: utxo.vout,
              witnessUtxo: {
                script: Buffer.from(prevout.scriptpubkey, "hex"),
                value: BigInt(utxo.value),
              },
              tapLeafScript: [
                {
                  leafVersion: 0xc0,
                  script: this._redeemScript,
                  controlBlock: controlBlock,
                },
              ],
              tapInternalKey: this._internalPubkey,
            });

            inputTotal += BigInt(utxo.value);
            if (inputTotal >= amount + estimatedFee) break;
        }

        if (inputTotal < amount + estimatedFee) {
            throw new Error(
                `Insufficient funds: have ${inputTotal} sats, need ${amount + estimatedFee} sats`
            );
        }

        psbt.addOutput({ address: toAddress, value: amount });

        const change = inputTotal - amount - estimatedFee;
        if (change > 546n) {
            // Change goes back to a plain key-path address of the internal key
            const changeAddr = bitcoin.payments.p2tr({
                internalPubkey: this._internalPubkey,
                network: this._client.network,
            }).address;
            psbt.addOutput({ address: changeAddr, value: change });
        }

        return psbt;
    }
}

// ─── BitcoinClient ────────────────────────────────────────────────────────────

/**
 * Main entry point for Bitcoin operations on testnet4
 *
 * Responsibilities:
 *   • Manage network config + mempool API connection
 *   • Factory methods to create wallets
 *   • Query balance and UTXOs for addresses
 */
export class BitcoinClient {
  
    /**
     * Create a Bitcoin client
     * @param {bitcoin.Network} network – e.g. bitcoin.networks.testnet or bitcoin.networks.regtest
     * @param {string} mempool – Base URL of mempool.space-compatible API
     */
    constructor(network, mempool) {
        this.network = network;
        this.mempool = mempool;
    }
  
    /**
     * Create a key-path P2TR wallet at the given account index
     * @param {string|string[]} mnemonic – BIP-39 seed phrase
     * @param {number} accountNumber – Account index (0-based)
     * @returns {TaprootKeyPathWallet}
     */
    getTaprootKeyPathWallet(mnemonic, accountNumber) {
        return new TaprootKeyPathWallet(this.network, this.mempool, mnemonic, accountNumber);
    }

    /**
     * Create a script-path P2TR wallet at the given account index
     * @param {string|string[]} mnemonic – BIP-39 seed phrase
     * @param {number} accountNumber – Account index (0-based)
     * @returns {TaprootScriptPathWallet}
     */
    getTaprootScriptPathWallet(mnemonic, accountNumber) {
        return new TaprootScriptPathWallet(this.network, this.mempool, mnemonic, accountNumber);
    }
    /**
     * Create a P2TR wallet with a custom tap-script
     * Used for creating script-path wallets with arbitrary locking conditions
     * @param {Buffer} redeemScript – Compiled tap-script
     * @param {Buffer} internalPubkey – 32-byte x-only internal key (or pass account pubkey)
     * @returns {CustomTaprootScriptWallet} Script wallet for custom script conditions
     */
    getTaprootScriptWallet(redeemScript, internalPubkey) {
        return new CustomTaprootScriptWallet(redeemScript, internalPubkey, this);
    }  
    /**
     * Get all UTXOs for an address
     * @param {string} address – Bitcoin address
     * @returns {Promise<Array>} Array of UTXO objects {txid, vout, value, status}
     */
    getUtxos(address) {
        return jget(`${this.mempool}/address/${address}/utxo`);
    }

    /**
     * Fetch a raw transaction by txid
     * @param {string} txid – Transaction ID
     * @returns {Promise<Object>} Transaction data including inputs/outputs
     */
    async getTx(txid) {
        return jget(`${this.mempool}/tx/${txid}`);
    }

    /**
     * Estimate fee rate (sat/vB) for a given confirmation target
     * @param {number} target – Blocks until confirmation (default 1 = next block)
     * @returns {Promise<number>} Fee rate in sat/vB
     */
    async getFeeRate(target = 1) {
        const data = await jget(`${this.mempool}/v1/fees/recommended`);
        return data.fastestFee ?? data.halfHourFee ?? 2;
    }
  
    /**
     * Get confirmed + unconfirmed balance of an address
     * @param {string} address – Bitcoin address
     * @returns {Promise<number>} Balance in BTC (converted from sats)
     */
    async getBalance(address) {
        const utxos = await this.getUtxos(address);
        return Number(utxos.reduce((acc, u) => acc + BigInt(u.value), 0n)) / 100000000;
    }
}
