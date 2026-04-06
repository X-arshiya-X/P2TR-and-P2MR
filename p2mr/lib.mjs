/**
 * lib.mjs – Bitcoin helper library for P2MR (BIP-360) demos on testnet4
 *
 * This module provides:
 *   - BitcoinClient: Network context + wallet factory methods
 *   - MerkleRootDirectWallet: P2MR wallet for direct spending (no key-path)
 *   - MerkleRootScriptWallet: P2MR wallet with multiple tap-scripts
 *   - Helper functions: tapLeafHash, tapBranchHash (BIP-341)
 *
 * P2MR (Pay-to-Merkle-Root) is a draft Bitcoin feature (BIP-360):
 *   • SegWit version 2 (tb1z... on testnet)
 *   • Like P2TR script-path but WITHOUT key-path spend
 *   • Smaller control blocks (no internal key revealed)
 *   • Protects against long-exposure quantum attacks
 *   • Not yet activated – treat as experimental
 *
 * All wallets use BIP-86 derivation (m/86'/1'/account'/0/0) on testnet4.
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
 * @returns {Promise<Object>} Parsed JSON
 * @throws {Error} If response is not 2xx
 */
async function jget(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}
/**
 * Select UTXOs from RPC client (for regtest)
 * @param {Object} rpc – Bitcoin RPC client
 * @param {string} address – Bitcoin address to select from
 * @param {bigint} amount – Satoshis to send
 * @param {string} feeSelection – Fee tier (not used for regtest, uses fixed 1 sat/vB)
 * @returns {Promise<{utxos: Array, total: bigint, fee: bigint}>} Selected UTXOs and calculated fee
 */
async function selectUtxosRpc(rpc, address, amount) {
    // Use scantxoutset to find UTXOs for any address (including mnemonic-derived)
    const result = await rpc.call('scantxoutset', ['start', [`addr(${address})`]]);
    const utxos = (result?.unspents ?? [])
        .map(u => ({
            txid: u.txid,
            vout: u.vout,
            value: BigInt(Math.floor(u.amount * 100000000))
        }))
        .sort((a, b) => (a.value < b.value ? 1 : -1));
    
    // Use fixed 1 sat/vB for regtest
    let total = 0n;
    let fee = 0n;
    let index = 0;
    do {
        if (index >= utxos.length) throw new Error("Not enough funds");
        const utxo = utxos[index++];
        total += utxo.value;
        const size = 10 + 58 * (index + 1) + 31 * 2;
        fee = BigInt(size); // 1 sat/vB
    } while (total < (amount + fee));

    return { utxos: utxos.slice(0, index), total, fee };
}
/**
 * Select UTXOs using greedy algorithm (largest first)
 * Estimates transaction size for P2MR (similar to P2TR)
 * @param {string} mempool – Mempool API base URL
 * @param {string} address – Bitcoin address
 * @param {bigint} amount – Satoshis to send
 * @param {string} feeSelection – Fee tier ('halfHourFee', 'fastestFee', etc.)
 * @returns {Promise<{utxos: Array, total: bigint, fee: bigint}>} Selected UTXOs and fee
 */
async function selectUtxos(mempool, address, amount, feeSelection = 'halfHourFee') {
    // Fetch network fees from mempool.space API
    const fees = await jget(`${mempool}/v1/fees/recommended`);

    // Fetch and sort UTXOs (largest first for greedy selection)
    const utxos = await jget(`${mempool}/address/${address}/utxo`);
    utxos.forEach(u => u.value = BigInt(u.value));
    utxos.sort((a, b) => (a.value < b.value ? 1 : -1));

    // Greedily select UTXOs until we have enough to cover amount + fee
    let total = 0n;
    let fee = 0n;
    let index = 0;
    do {
        if (index >= utxos.length) throw new Error("Not enough funds");
        const utxo = utxos[index++];
        total += utxo.value;
        
        // Estimate P2MR transaction size (similar to P2TR):
        //   • 10 bytes: version + locktime
        //   • 58 bytes per input: prevout(36) + scriptSigLength(1) + witness(~20)
        //   • 31 bytes per output: value(8) + scriptPubKeyLength(1) + script(34)
        const size = 10 + 58 * (index + 1) + 31 * 2;
        fee = BigInt(fees[feeSelection] * size);
    } while (total < (amount + fee));

    return { utxos: utxos.slice(0, index), total, fee };
}

// ─── BIP-341 Tap-Tree Helpers ─────────────────────────────────────────────────

/**
 * Compute BIP-341 TapLeaf hash for a script
 * Used in constructing Merkle trees for tap-scripts
 * @param {Buffer} script – Compiled Bitcoin script
 * @param {number} leafVersion – Leaf version (0xc0 for BIP-342 tapscript, default)
 * @returns {Buffer} 32-byte TapLeaf hash
 */
export function tapLeafHash(script, leafVersion = 0xc0) {
  const lenBuf = _compactSize(script.length);
  return bitcoin.crypto.taggedHash(
    "TapLeaf",
    Buffer.concat([Buffer.from([leafVersion]), lenBuf, script])
  );
}

/**
 * Compute BIP-341 TapBranch hash for two child hashes
 * Needed when building multi-leaf Merkle trees
 * @param {Buffer} a – First hash (32 bytes)
 * @param {Buffer} b – Second hash (32 bytes)
 * @returns {Buffer} 32-byte TapBranch hash
 */
export function tapBranchHash(a, b) {
  // Sort lexicographically before hashing (required by BIP-341)
  return a.compare(b) <= 0
    ? bitcoin.crypto.taggedHash("TapBranch", Buffer.concat([a, b]))
    : bitcoin.crypto.taggedHash("TapBranch", Buffer.concat([b, a]));
}

/**
 * Encode an integer as Bitcoin compact-size (variable-length)
 * Used for script length encoding in TapLeaf hashes
 * @param {number} n – Integer to encode
 * @returns {Buffer} Compact-size encoded buffer
 */
function _compactSize(n) {
  if (n < 0xfd) return Buffer.from([n]);
  const buf = Buffer.allocUnsafe(3);
  buf[0] = 0xfd;
  buf.writeUInt16LE(n, 1);
  return buf;
}

// ─── P2MR Helper Functions (SegWit v2) ────────────────────────────────────────

/**
 * Create a P2MR scriptPubKey (SegWit version 2)
 * Format: OP_2 (0x52) + PUSH32 + <merkle_root>
 * @param {Buffer} merkleRoot – 32-byte Merkle root
 * @returns {Buffer} P2MR scriptPubKey
 */
function createP2MRScriptPubKey(merkleRoot) {
  if (merkleRoot.length !== 32) {
    throw new Error("Merkle root must be 32 bytes");
  }
  // OP_2 (0x52) + PUSH32 (0x20) + merkle_root (32 bytes)
  return Buffer.concat([Buffer.from([0x52, 0x20]), merkleRoot]);
}

/**
 * Encode a P2MR address (SegWit v2)
 * @param {Buffer} merkleRoot – 32-byte Merkle root
 * @param {bitcoin.Network} network – Bitcoin network
 * @returns {string} Bech32m-encoded address (tb1z... for testnet)
 */
function encodeP2MRAddress(merkleRoot, network) {
  const scriptPubKey = createP2MRScriptPubKey(merkleRoot);
  
  // Extract witness version and program
  const witnessVersion = scriptPubKey[0] - 0x50; // OP_2 = 0x52, so version = 2
  const witnessProgram = scriptPubKey.slice(2); // Skip OP_2 and PUSH32
  
  // Use bech32m encoding for witness version 2+
  // (different from bech32 for v0/v1)
  const result = bitcoin.address.fromOutputScript(scriptPubKey, network);
  return result;
}

/**
 * Compute P2MR merkle root from a single script (leaf)
 * For a single-leaf P2MR with no alternative branches
 * @param {Buffer} script – Bitcoin script
 * @returns {Buffer} 32-byte merkle root (which is the tap leaf hash for single leaf)
 */
function computeSingleLeafMerkleRoot(script) {
  // For a single leaf, the merkle root IS the tap leaf hash
  return tapLeafHash(script, 0xc0);
}

// ─── MerkleRootDirectWallet (Direct Spend) ────────────────────────────────────

/**
 * Direct spending P2MR wallet (no script tree)
 *
 * For spending, uses:
 *   • Witness: [schnorr_signature]
 *   • Same as P2TR key-path but with SegWit v2 output
 *
 * NOTE: This is similar to key-path spend but for a P2MR output.
 * In practice, this is rarely used; P2MR's main advantage is script-path spending.
 *
 * Derivation: m/86'/1'/account'/0/0 (BIP-86)
 */
class MerkleRootDirectWallet {
    
    /**
     * Create a P2MR direct wallet from mnemonic
     * @param {bitcoin.Network} network – Bitcoin network
     * @param {string|Object} mempoolOrRpc – Mempool API base URL (string) or RPC client (object)
     * @param {string|string[]} mnemonic – BIP-39 seed phrase
     * @param {number} accountNumber – BIP-44 account index
     */
    constructor(network, mempoolOrRpc, mnemonic, accountNumber) {
        const phrase = Array.isArray(mnemonic) ? mnemonic.join(" ") : mnemonic;
        const seed = bip39.mnemonicToSeedSync(phrase);
        const root = bip32.fromSeed(seed, network);
        const node = root
            .deriveHardened(86)
            .deriveHardened(1)
            .deriveHardened(accountNumber)
            .derive(0)
            .derive(0);
        
        // P2MR: Single leaf merkle root (no key path, only script path)
        // For direct wallet, use a simple OP_1 script as the only leaf
        const singleLeafScript = Buffer.from([bitcoin.opcodes.OP_1]);
        const merkleRoot = computeSingleLeafMerkleRoot(singleLeafScript);
        const output = createP2MRScriptPubKey(merkleRoot);
        
        // Encode P2MR address (SegWit v2)
        const address = encodeP2MRAddress(merkleRoot, network);
        
        this.network = network;
        this.isRpc = typeof mempoolOrRpc === 'object';
        this.mempool = this.isRpc ? null : mempoolOrRpc;
        this.rpc = this.isRpc ? mempoolOrRpc : null;
        this.address = address;
        this.publicKey = node.publicKey;
        this.privateKey = node.privateKey;
        this.internalPubkey = node.publicKey.subarray(1);
        this.output = output;
        this.merkleRoot = merkleRoot;
        this.leafScript = singleLeafScript;
    }
    
    /**
     * Sign a PSBT using script-path spending (P2MR has NO key-path)
     * Uses the OP_1 script (always succeeds)
     * @param {string} psbtHex – Unsigned PSBT hex
     * @returns {string} Signed transaction hex
     */
    signTransaction(psbtHex) {
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: this.network });
        
        // P2MR script-path: witness = [OP_1 script, control block]
        // OP_1 requires no signatures, so witness is [<empty>, leafScript, controlBlock]
        for (let i = 0; i < psbt.data.inputs.length; i++) {
            const input = psbt.data.inputs[i];
            
            // Control block for P2MR:
            // - 1 byte: leaf version (0xc0 for tapscript) + 0 since no siblings
            // - No merkle proof needed for single leaf
            const controlBlock = Buffer.from([0xc0]);
            
            // Finalize with script-path witness: [empty arg, script, control]
            psbt.finalizeInput(i, () => ({
                finalScriptWitness: Buffer.concat([
                    bitcoin.script.compile([Buffer.alloc(0)]),  // empty arg for OP_1
                    bitcoin.script.compile([this.leafScript]),
                    bitcoin.script.compile([controlBlock])
                ])
            }));
        }
        
        return psbt.extractTransaction().toHex();
    }
    
    /**
     * Build an unsigned PSBT
     * @param {string} toAddress – Destination address
     * @param {bigint} amount – Satoshis to send
     * @param {string} feeSelection – Fee tier
     * @returns {Promise<string>} Unsigned PSBT hex
     */
    async createTransaction(toAddress, amount, feeSelection = 'halfHourFee') {
        const { utxos, total, fee } = this.isRpc
            ? await selectUtxosRpc(this.rpc, this.address, amount)
            : await selectUtxos(this.mempool, this.address, amount, feeSelection);
    
        const psbt = new bitcoin.Psbt({ network: this.network });

        for (const inp of utxos) {
            psbt.addInput({
              hash: inp.txid,
              index: inp.vout,
              witnessUtxo: {
                script: this.output,
                value: Number(inp.value), // bip174 requires Number, not BigInt
              },
              tapInternalKey: this.internalPubkey, // required for key-path taproot signing
            });
        }
    
        psbt.addOutput({
            address: toAddress,
            value: Number(amount),
        });
    
        let change = total - amount - fee;
        if (change >= DUST) {
            psbt.addOutput({ address: this.address, value: Number(change) });
        }
    
        return psbt.toHex();
    }
}

// ─── MerkleRootScriptWallet (Script-Path Spend) ────────────────────────────────

/**
 * Script-path spending P2MR wallet
 *
 * Allows spending via multiple tap-scripts committed in a Merkle tree.
 * This template creates 3 example scripts, but can be extended.
 *
 * Spending requires:
 *   • Witness: [script_args..., redeemScript, controlBlock]
 *   • Control block is smaller than P2TR (no internal key)
 *   • Only one script leaf revealed; others stay private
 *
 * Derivation: m/86'/1'/account'/0/0 (BIP-86)
 */
class MerkleRootScriptWallet {
    
    /**
     * Create a P2MR script-path wallet with multiple spending conditions
     * @param {bitcoin.Network} network – Bitcoin network
     * @param {string|Object} mempoolOrRpc – Mempool API base URL (string) or RPC client (object)
     * @param {string|string[]} mnemonic – BIP-39 seed phrase
     * @param {number} accountNumber – BIP-44 account index
     * @param {number} numScripts – Number of script conditions (default 3)
     */
    constructor(network, mempoolOrRpc, mnemonic, accountNumber, numScripts = 3) {
        const phrase = Array.isArray(mnemonic) ? mnemonic.join(" ") : mnemonic;
        const seed = bip39.mnemonicToSeedSync(phrase);
        const root = bip32.fromSeed(seed, network);
        const node = root
            .deriveHardened(86)
            .deriveHardened(1)
            .deriveHardened(accountNumber)
            .derive(0)
            .derive(0);
        
        // Script 1: Standard P2PKH (OP_DUP OP_HASH160 <hash> OP_EQUALVERIFY OP_CHECKSIG)
        const pubkeyHash = bitcoin.crypto.hash160(node.publicKey);
        const script1 = bitcoin.script.compile([
            bitcoin.opcodes.OP_DUP,
            bitcoin.opcodes.OP_HASH160,
            pubkeyHash,
            bitcoin.opcodes.OP_EQUALVERIFY,
            bitcoin.opcodes.OP_CHECKSIG
        ]);
        
        // Script 2: Hash-lock (OP_SHA256 <hash> OP_EQUAL)
        const preimage = Buffer.from("secret_preimage_123", "utf8");
        const scriptHash = bitcoin.crypto.sha256(preimage);
        const script2 = bitcoin.script.compile([
            bitcoin.opcodes.OP_SHA256,
            scriptHash,
            bitcoin.opcodes.OP_EQUAL
        ]);
        
        // Script 3: Time-lock (OP_CHECKLOCKTIMEVERIFY OP_DROP)
        const script3 = bitcoin.script.compile([
            bitcoin.script.number.encode(500),
            bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
            bitcoin.opcodes.OP_DROP,
            bitcoin.opcodes.OP_0
        ]);
        
        // Compute P2MR merkle root from script tree:
        //           root
        //         /      \
        //     leaf1       branch
        //              /         \
        //           leaf2      leaf3
        const leaf1 = tapLeafHash(script1, 0xc0);
        const leaf2 = tapLeafHash(script2, 0xc0);
        const leaf3 = tapLeafHash(script3, 0xc0);
        const branch = tapBranchHash(leaf2, leaf3);
        const merkleRoot = tapBranchHash(leaf1, branch);
        
        // Create P2MR scriptPubKey (SegWit v2)
        const output = createP2MRScriptPubKey(merkleRoot);
        
        // Encode P2MR address
        const address = encodeP2MRAddress(merkleRoot, network);
        
        this.network = network;
        this.isRpc = typeof mempoolOrRpc === 'object';
        this.mempool = this.isRpc ? null : mempoolOrRpc;
        this.rpc = this.isRpc ? mempoolOrRpc : null;
        this.address = address;
        this.publicKey = node.publicKey;
        this.privateKey = node.privateKey;
        this.internalPubkey = node.publicKey.subarray(1);
        this.output = output;
        this.script1 = script1;
        this.script2 = script2;
        this.script3 = script3;
        this.merkleRoot = merkleRoot;
        this.preimage = preimage;
        // Store leaf hashes for witness stack construction
        this.leaf1 = leaf1;
        this.leaf2 = leaf2;
        this.leaf3 = leaf3;
        this.branch = branch;
    }
    
    /**
     * Sign a PSBT using script-path spending (P2MR approach)
     * Uses script1 (P2PKH) with standard ECDSA signature
     * @param {string} psbtHex – Unsigned PSBT hex
     * @param {number} scriptIndex – Which script to use (default 0 = script1)
     * @returns {string} Signed transaction hex
     */
    signTransaction(psbtHex, scriptIndex = 0) {
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: this.network });
        const keyPair = ECPair.fromPrivateKey(this.privateKey, { network: this.network });
        
        for (let i = 0; i < psbt.data.inputs.length; i++) {
            const input = psbt.data.inputs[i];
            
            // Sign with the private key (standard ECDSA for P2PKH script)
            const sig = keyPair.sign(psbt.hashForSignAll(i, this.script1, Buffer.from([0xc1])));
            const sigPushData = bitcoin.script.signature.encode(sig, bitcoin.Transaction.SIGHASH_ALL);
            
            // Construct control block for P2MR with merkle proof
            // leaf1 is in the tree with sibling = hash(leaf2, leaf3)
            // Control block: [leaf_version (0xc0)] + [merkle_proof]
            // merkle_proof includes the branch hash (32 bytes)
            const controlBlock = Buffer.concat([
                Buffer.from([0xc0]),  // leaf version
                this.branch           // merkle proof: the branch containing leaf2-leaf3
            ]);
            
            // P2MR witness stack for script1 (P2PKH):
            // [sig, pubkey, script1, controlBlock]
            psbt.finalizeInput(i, () => ({
                finalScriptWitness: bitcoin.script.compile([
                    sigPushData,
                    this.publicKey,
                    this.script1,
                    controlBlock
                ])
            }));
        }
        
        return psbt.extractTransaction().toHex();
    }
    
    /**
     * Build an unsigned PSBT for script-path spending
     * @param {string} toAddress – Destination address
     * @param {bigint} amount – Satoshis to send
     * @param {string} feeSelection – Fee tier
     * @returns {Promise<string>} Unsigned PSBT hex
     */
    async createTransaction(toAddress, amount, feeSelection = 'halfHourFee') {
        const { utxos, total, fee } = this.isRpc
            ? await selectUtxosRpc(this.rpc, this.address, amount)
            : await selectUtxos(this.mempool, this.address, amount, feeSelection);
    
        const psbt = new bitcoin.Psbt({ network: this.network });

        for (const inp of utxos) {
            psbt.addInput({
              hash: inp.txid,
              index: inp.vout,
              witnessUtxo: {
                script: this.output,
                value: Number(inp.value), // bip174 requires Number, not BigInt
              },
              tapInternalKey: this.internalPubkey,
            });
        }
    
        psbt.addOutput({
            address: toAddress,
            value: Number(amount),
        });
    
        let change = total - amount - fee;
        if (change >= DUST) {
            psbt.addOutput({ address: this.address, value: Number(change) });
        }
    
        return psbt.toHex();
    }
}

// ─── BitcoinClient ────────────────────────────────────────────────────────────

/**
 * Main entry point for P2MR Bitcoin operations on testnet4 or regtest
 * Manages network context and provides wallet factory methods
 */
export class BitcoinClient {
  
    /**
     * Create a Bitcoin client for P2MR operations
     * @param {bitcoin.Network} network – Bitcoin network (mainnet/testnet/regtest)
     * @param {string|Object} mempoolOrRpc – Base URL of mempool.space-compatible API or RPC client
     */
    constructor(network, mempoolOrRpc) {
        this.network = network;
        this.isRpc = typeof mempoolOrRpc === 'object';
        this.mempool = this.isRpc ? null : mempoolOrRpc;
        this.rpc = this.isRpc ? mempoolOrRpc : null;
    }
  
    /**
     * Create a P2MR direct-spend wallet at given account index
     * @param {string|string[]} mnemonic – BIP-39 seed phrase
     * @param {number} accountNumber – Account index (0-based)
     * @returns {MerkleRootDirectWallet}
     */
    getMerkleRootDirectWallet(mnemonic, accountNumber) {
        const dataLayer = this.isRpc ? this.rpc : this.mempool;
        return new MerkleRootDirectWallet(this.network, dataLayer, mnemonic, accountNumber);
    }

    /**
     * Create a P2MR script-path wallet at given account index
     * Provides multiple spending conditions (3 scripts in Merkle tree)
     * @param {string|string[]} mnemonic – BIP-39 seed phrase
     * @param {number} accountNumber – Account index (0-based)
     * @returns {MerkleRootScriptWallet}
     */
    getMerkleRootScriptWallet(mnemonic, accountNumber) {
        const dataLayer = this.isRpc ? this.rpc : this.mempool;
        return new MerkleRootScriptWallet(this.network, dataLayer, mnemonic, accountNumber);
    }
  
    /**
     * Get all UTXOs for an address
     * @param {string} address – Bitcoin address
     * @returns {Promise<Array>} Array of UTXO objects
     */
    async getUtxos(address) {
        if (this.isRpc) {
            try {
                // Use scantxoutset to find UTXOs for any address (including mnemonic-derived)
                const result = await this.rpc.call('scantxoutset', ['start', [`addr(${address})`]]);
                return (result?.unspents ?? []).map(u => ({
                    txid: u.txid,
                    vout: u.vout,
                    value: BigInt(Math.floor(u.amount * 100000000))
                }));
            } catch (e) {
                console.error(`Error fetching UTXOs for ${address}:`, e.message);
                return [];
            }
        } else {
            return jget(`${this.mempool}/address/${address}/utxo`);
        }
    }
  
    /**
     * Get balance (confirmed + unconfirmed) for an address
     * @param {string} address – Bitcoin address
     * @returns {Promise<number>} Balance in BTC
     */
    async getBalance(address) {
        const utxos = await this.getUtxos(address);
        return Number(utxos.reduce((acc, u) => acc + BigInt(u.value), 0n)) / 100000000;
    }

    /**
     * Send a raw transaction to the network
     * @param {string} txHex – Raw transaction hex
     * @returns {Promise<string>} Transaction ID
     */
    async sendTransaction(txHex) {
        if (this.isRpc) {
            return this.rpc.call('sendrawtransaction', [txHex]);
        } else {
            const response = await fetch(`${this.mempool}/tx`, {
                method: 'POST',
                headers: { 'content-type': 'text/plain' },
                body: txHex
            });
            return response.text();
        }
    }
}
