import * as bitcoin from 'bitcoinjs-lib';
import * as bip39 from "bip39";
import { BIP32Factory } from "bip32";
import * as ecc from 'tiny-secp256k1';
import { ECPairFactory } from "ecpair";

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const ECPair = ECPairFactory(ecc);

const DUST = 546;

async function get(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.text();
}

async function jget(path) {
  const r = await fetch(path);
  if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

async function post(path, body) {
    const r = await fetch(path, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body,
    });
    if (!r.ok) throw new Error(`${path} -> ${r.status} ${await r.text()}`);
    return r.text();
}

async function getUtxos(mempool, address){
    const utxos = await jget(`${mempool}/address/${address}/utxo`);
    utxos.forEach(function(u){
        u.value = BigInt(u.value);
    });
    return utxos;
}

async function selectUtxos(mempool, address, amount, feeSelection){
    // get network fees
    const fees = await jget(`${mempool}/v1/fees/recommended`);

    // sort utxos - greedy select (largest first)
    const utxos = await getUtxos(mempool, address);
    utxos.sort((a, b) => (a.value < b.value ? 1 : -1));

    // select utxos
    let total = 0n;
    let fee = 0n;
    let index = 0;
    do{
        if (index>=utxos.length) throw new Error("Not enough funds");
        const utxo = utxos[index++];
        total += utxo.value;
        // estimate transaction bytes for merkle root (similar to taproot)
        // - 10 bytes base
        // - 58 bytes per input
        // - 31 bytes per output
        const size = 10 + 58 * (index+1) + 31 * 2;
        // calculate fee
        fee = BigInt(fees[feeSelection] * size);
    } while (total < (amount + fee))

    return { utxos: utxos.slice(0, index), total, fee }
}

// P2MR Direct Spend: Single condition merkle root (key-path equivalent)
class MerkleRootDirectWallet{
    
    constructor(network, mempool, mnemonic, accountNumber) {
        const seed = bip39.mnemonicToSeedSync(mnemonic.join(" "));
        // BIP86 path for merkle root spending
        // path: m/86'/1'/account'/0/0
        const root = bip32.fromSeed(seed, network);
        const node = root.deriveHardened(86).deriveHardened(1).deriveHardened(accountNumber).derive(0).derive(0);
        
        // For P2MR direct spend, use a simple script hashed as the merkle root
        // Create the internal key from our keypair
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
    
    signTransaction(psbtHex){
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: this.network });
        for (let i=0; i<psbt.data.inputs.length; i++) {
            const keyPair = ECPair.fromPrivateKey(this.privateKey, { network: this.network });
            psbt.signInput(i, keyPair, undefined, 0x81); // SIGHASH_ALL for taproot
        };
        return psbt.toHex();
    }
    
    async createTransaction(toAddress, amount, feeSelection='halfHourFee'){
        const { utxos, total, fee } = await selectUtxos(this.mempool, this.address, amount, feeSelection);
    
        // create PSBT
        const psbt = new bitcoin.Psbt({ network: this.network });

        // inputs
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
    
        // transfer amount
        psbt.addOutput({
            address: toAddress,
            value: amount,
        });
    
        // change (if any)
        let change = total - amount - fee;
        if (change >= DUST) {
            psbt.addOutput({ address: this.address, value: change });
        }
    
        return psbt.toHex();
    }
}

// P2MR Script Spend: Multiple conditions in merkle tree (script-path equivalent)
class MerkleRootScriptWallet{
    
    constructor(network, mempool, mnemonic, accountNumber, numScripts = 3) {
        const seed = bip39.mnemonicToSeedSync(mnemonic.join(" "));
        // BIP86 path
        // path: m/86'/1'/account'/0/0
        const root = bip32.fromSeed(seed, network);
        const node = root.deriveHardened(86).deriveHardened(1).deriveHardened(accountNumber).derive(0).derive(0);
        
        // Create multiple scripts for merkle tree
        // Script 1: OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
        const pubkeyHash = bitcoin.crypto.hash160(node.publicKey);
        const script1Elements = [
            bitcoin.opcodes.OP_DUP,
            bitcoin.opcodes.OP_HASH160,
            pubkeyHash,
            bitcoin.opcodes.OP_EQUALVERIFY,
            bitcoin.opcodes.OP_CHECKSIG
        ];
        const script1 = bitcoin.script.compile(script1Elements);
        
        // Script 2: Hash-lock style (OP_SHA256 <hash> OP_EQUAL)
        const preimage = Buffer.from("secret_preimage_123", "utf8");
        const scriptHash = bitcoin.crypto.sha256(preimage);
        const script2Elements = [
            bitcoin.opcodes.OP_SHA256,
            scriptHash,
            bitcoin.opcodes.OP_EQUAL
        ];
        const script2 = bitcoin.script.compile(script2Elements);
        
        // Script 3: Time-lock style (for example purposes)
        const script3Elements = [
            bitcoin.script.number.encode(500), // Block height as buffer
            bitcoin.opcodes.OP_CHECKLOCKTIMEVERIFY,
            bitcoin.opcodes.OP_DROP,
            bitcoin.opcodes.OP_0
        ];
        const script3 = bitcoin.script.compile(script3Elements);
        
        // Build merkle tree with multiple scripts
        const scriptTree = { 
            output: script1, 
            left: { output: script2 },
            right: { output: script3 }
        };
        
        // Create taproot with merkle tree
        const taproot = bitcoin.payments.p2tr({
            internalPubkey: node.publicKey.subarray(1),
            scriptTree: scriptTree,
            network
        });
        
        this.network = network;
        this.mempool = mempool;
        this.address = taproot.address;
        this.publicKey = node.publicKey;
        this.privateKey = node.privateKey;
        this.internalPubkey = node.publicKey.subarray(1);
        this.output = taproot.output;
        this.script1 = script1;
        this.script2 = script2;
        this.script3 = script3;
        this.scriptTree = scriptTree;
        this.preimage = preimage;
    }
    
    signTransaction(psbtHex, scriptIndex = 0){
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: this.network });
        for (let i=0; i<psbt.data.inputs.length; i++) {
            const keyPair = ECPair.fromPrivateKey(this.privateKey, { network: this.network });
            // Sign with scriptTree for script-path spending
            psbt.signInput(i, keyPair, undefined, 0x81, this.scriptTree);
        };
        return psbt.toHex();
    }
    
    async createTransaction(toAddress, amount, feeSelection='halfHourFee'){
        const { utxos, total, fee } = await selectUtxos(this.mempool, this.address, amount, feeSelection);
    
        // create PSBT
        const psbt = new bitcoin.Psbt({ network: this.network });

        // inputs
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
    
        // transfer amount
        psbt.addOutput({
            address: toAddress,
            value: amount,
        });
    
        // change (if any)
        let change = total - amount - fee;
        if (change >= DUST) {
            psbt.addOutput({ address: this.address, value: change });
        }
    
        return psbt.toHex();
    }
}

export class BitcoinClient {
  
  constructor(network, mempool) {
      this.network = network;
      this.mempool = mempool;
  }
  
  getMerkleRootDirectWallet(mnemonic, accountNumber){
      return new MerkleRootDirectWallet(this.network, this.mempool, mnemonic, accountNumber);
  }

  getMerkleRootScriptWallet(mnemonic, accountNumber){
      return new MerkleRootScriptWallet(this.network, this.mempool, mnemonic, accountNumber);
  }
  
  getUtxos(address){
      return getUtxos(this.mempool, address);
  }
  
  async getBalance(address){
      return Number((await this.getUtxos(address)).reduce((acc,u)=>acc+u.value, 0n))/100000000;
  }
}
