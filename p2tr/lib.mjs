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
    // - fastestFee: Urgent (next block)
    // - halfHourFee: default (within ~30min)
    // - hourFee: low (within ~1h)
    // - economyFee: cheapest (no time bounded)
    // - minimumFee: hard floor (tx rejected below that)
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
        // estimate transaction bytes for taproot
        // - 10 bytes base
        // - 58 bytes per input (taproot signatures are smaller)
        // - 31 bytes per output
        const size = 10 + 58 * (index+1) + 31 * 2;
        // calculate fee
        fee = BigInt(fees[feeSelection] * size);
    } while (total < (amount + fee))

    return { utxos: utxos.slice(0, index), total, fee }
}

// P2TR Key-Path Spend: Direct spending using the taproot key
class TaprootKeyPathWallet{
    
    constructor(network, mempool, mnemonic, accountNumber) {
        const seed = bip39.mnemonicToSeedSync(mnemonic.join(" "));
        // BIP86 testnet coin_type = 1' (for taproot)
        // path: m/86'/1'/account'/0/0
        const root = bip32.fromSeed(seed, network);
        const node = root.deriveHardened(86).deriveHardened(1).deriveHardened(accountNumber).derive(0).derive(0);
        
        // Create taproot output using the public key
        const pay = bitcoin.payments.p2tr({ internalPubkey: node.publicKey.subarray(1), network });
        
        this.network = network;
        this.mempool = mempool;
        this.address = pay.address;
        this.publicKey = node.publicKey;
        this.privateKey = node.privateKey;
        this.internalPubkey = node.publicKey.subarray(1); // remove prefix for taproot
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
    
        // create PSBT (Partially Signed Bitcoin Transaction)
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

// P2TR Script-Path Spend: Spending via a script committed to the taproot tree
class TaprootScriptPathWallet{
    
    constructor(network, mempool, mnemonic, accountNumber) {
        const seed = bip39.mnemonicToSeedSync(mnemonic.join(" "));
        // BIP86 testnet coin_type = 1'
        // path: m/86'/1'/account'/0/0
        const root = bip32.fromSeed(seed, network);
        const node = root.deriveHardened(86).deriveHardened(1).deriveHardened(accountNumber).derive(0).derive(0);
        
        // Create a simple script: OP_DUP OP_HASH160 <pubkeyhash> OP_EQUALVERIFY OP_CHECKSIG
        const pubkeyHash = bitcoin.crypto.hash160(node.publicKey);
        const scriptElements = [
            bitcoin.opcodes.OP_DUP,
            bitcoin.opcodes.OP_HASH160,
            pubkeyHash,
            bitcoin.opcodes.OP_EQUALVERIFY,
            bitcoin.opcodes.OP_CHECKSIG
        ];
        const script = bitcoin.script.compile(scriptElements);
        
        // Create taproot with the script-path
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
    
    signTransaction(psbtHex){
        const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: this.network });
        for (let i=0; i<psbt.data.inputs.length; i++) {
            const keyPair = ECPair.fromPrivateKey(this.privateKey, { network: this.network });
            psbt.signInput(i, keyPair, undefined, 0x81, this.scriptTree); // Pass scriptTree for script-path spend
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
  
  getTaprootKeyPathWallet(mnemonic, accountNumber){
      return new TaprootKeyPathWallet(this.network, this.mempool, mnemonic, accountNumber);
  }

  getTaprootScriptPathWallet(mnemonic, accountNumber){
      return new TaprootScriptPathWallet(this.network, this.mempool, mnemonic, accountNumber);
  }
  
  getUtxos(address){
      return getUtxos(this.mempool, address);
  }
  
  async getBalance(address){
      return Number((await this.getUtxos(address)).reduce((acc,u)=>acc+u.value, 0n))/100000000;
  }
}
