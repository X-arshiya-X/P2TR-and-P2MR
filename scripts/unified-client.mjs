/**
 * Unified Bitcoin Client that works with both Testnet and Regtest
 * Abstracts differences between mempool.space API and Bitcoin Core RPC
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

// Data layer abstraction
class DataLayer {
  async getUtxos(address) {
    throw new Error('Not implemented');
  }

  async getTransaction(txid) {
    throw new Error('Not implemented');
  }

  async sendRawTransaction(txHex) {
    throw new Error('Not implemented');
  }

  async getBalance(address) {
    const utxos = await this.getUtxos(address);
    return utxos.reduce((sum, u) => sum + u.value, 0n);
  }
}

// Mempool.space API data layer (for testnet)
class MempoolDataLayer extends DataLayer {
  constructor(mempoolUrl) {
    super();
    this.url = mempoolUrl;
  }

  async getUtxos(address) {
    const utxos = await jget(`${this.url}/address/${address}/utxo`);
    utxos.forEach(function(u) {
      u.value = BigInt(u.value);
    });
    return utxos;
  }

  async getTransaction(txid) {
    return jget(`${this.url}/tx/${txid}`);
  }

  async getRawTransaction(txid) {
    return get(`${this.url}/tx/${txid}/hex`);
  }

  async sendRawTransaction(txHex) {
    return await fetch(`${this.url}/tx`, {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: txHex
    }).then(r => r.text());
  }

  async getRecommendedFees() {
    return jget(`${this.url}/v1/fees/recommended`);
  }
}

// Bitcoin Core RPC data layer (for regtest)
class RpcDataLayer extends DataLayer {
  constructor(rpcClient) {
    super();
    this.rpc = rpcClient;
  }

  async getUtxos(address) {
    try {
      // Use scantxoutset to find UTXOs for any address (including external/mnemonic-derived)
      const result = await this.rpc.call('scantxoutset', ['start', [`addr(${address})`]]);
      if (!result || !result.unspents) return [];

      return result.unspents.map(u => ({
        txid: u.txid,
        vout: u.vout,
        value: BigInt(Math.floor(u.amount * 100000000)),
        height: u.height
      }));
    } catch (error) {
      console.error(`Error fetching UTXOs for ${address}:`, error.message);
      return [];
    }
  }

  async getTransaction(txid) {
    return this.rpc.call('getrawtransaction', [txid, true]);
  }

  async getRawTransaction(txid) {
    return this.rpc.call('getrawtransaction', [txid, false]);
  }

  async sendRawTransaction(txHex) {
    return this.rpc.call('sendrawtransaction', [txHex]);
  }

  async getRecommendedFees() {
    // Return fixed fees for regtest
    return {
      fastestFee: 10,
      halfHourFee: 5,
      hourFee: 2,
      economyFee: 1,
      minimumFee: 1
    };
  }
}

async function selectUtxos(dataLayer, address, amount, feeSelection = 'halfHourFee') {
  const fees = await dataLayer.getRecommendedFees();
  
  const utxos = await dataLayer.getUtxos(address);
  utxos.sort((a, b) => (a.value < b.value ? 1 : -1));

  let total = 0n;
  let fee = 0n;
  let index = 0;
  do {
    if (index >= utxos.length) throw new Error("Not enough funds");
    const utxo = utxos[index++];
    total += utxo.value;
    const size = 10 + 68 * (index + 1) + 31 * 2;
    fee = BigInt(fees[feeSelection] * size);
  } while (total < (amount + fee));

  return { utxos: utxos.slice(0, index), total, fee };
}

class AccountWallet {
  constructor(network, dataLayer, mnemonic, accountNumber) {
    const seed = bip39.mnemonicToSeedSync(mnemonic.join(" "));
    const coinType = network === 'regtest' ? 1 : 1; // Use 1' for both for consistency
    const root = bip32.fromSeed(seed, bitcoin.networks[network]);
    const node = root.deriveHardened(84).deriveHardened(coinType).deriveHardened(accountNumber).derive(0).derive(0);
    const pay = bitcoin.payments.p2wpkh({ pubkey: node.publicKey, network: bitcoin.networks[network] });
    
    this.network = network;
    this.dataLayer = dataLayer;
    this.address = pay.address;
    this.publicKey = node.publicKey;
    this.privateKey = node.privateKey;
    this.script = pay.output;
  }

  signTransaction(psbtHex) {
    const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: bitcoin.networks[this.network] });
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const keyPair = ECPair.fromPrivateKey(this.privateKey, { network: bitcoin.networks[this.network] });
      psbt.signInput(i, keyPair);
    }
    return psbt.toHex();
  }

  async createTransaction(toAddress, amount, feeSelection = 'halfHourFee') {
    const { utxos, total, fee } = await selectUtxos(this.dataLayer, this.address, amount, feeSelection);

    const psbt = new bitcoin.Psbt({ network: bitcoin.networks[this.network] });

    for (const inp of utxos) {
      psbt.addInput({
        hash: inp.txid,
        index: inp.vout,
        witnessUtxo: {
          script: this.script,
          value: Number(inp.value),  // Convert BigInt to Number for bitcoinjs-lib
        },
      });
    }

    psbt.addOutput({
      address: toAddress,
      value: Number(amount), // Ensure amount is a Number
    });

    let change = total - amount - fee;
    if (change >= BigInt(DUST)) {
      psbt.addOutput({ address: this.address, value: Number(change) }); // Convert to Number
    }

    return psbt.toHex();
  }
}

class MultiSigWallet {
  constructor(network, dataLayer, publicKeys, threshold) {
    const pubkeys = [...publicKeys].sort(Buffer.compare);
    const redeem = bitcoin.payments.p2ms({ m: threshold, pubkeys, network: bitcoin.networks[network] });
    const p2sh = bitcoin.payments.p2sh({ redeem, network: bitcoin.networks[network] });
    
    this.network = network;
    this.dataLayer = dataLayer;
    this.address = p2sh.address;
    this.script = redeem.output;
  }

  async createTransaction(toAddress, amount, feeSelection = 'halfHourFee') {
    const { utxos, total, fee } = await selectUtxos(this.dataLayer, this.address, amount, feeSelection);

    const psbt = new bitcoin.Psbt({ network: bitcoin.networks[this.network] });

    for (const inp of utxos) {
      const txHex = await this.dataLayer.getRawTransaction(inp.txid);
      psbt.addInput({
        hash: inp.txid,
        index: inp.vout,
        nonWitnessUtxo: Buffer.from(txHex, 'hex'),
        redeemScript: this.script,
      });
    }

    psbt.addOutput({
      address: toAddress,
      value: Number(amount),  // Convert to Number
    });

    let change = total - amount - fee;
    if (change >= BigInt(DUST)) {
      psbt.addOutput({ address: this.address, value: Number(change) }); // Convert to Number
    }

    return psbt.toHex();
  }

  async signTransaction(psbtHex) {
    const psbt = bitcoin.Psbt.fromHex(psbtHex, { network: bitcoin.networks[this.network] });
    for (let i = 0; i < psbt.data.inputs.length; i++) {
      const keyPair = ECPair.fromPrivateKey(this.privateKey, { network: bitcoin.networks[this.network] });
      psbt.signInput(i, keyPair);
    }
    return psbt.toHex();
  }
}

export class BitcoinClient {
  constructor(network, dataLayer) {
    this.network = network;
    this.dataLayer = dataLayer;
  }

  getAccountWallet(mnemonic, accountNumber) {
    return new AccountWallet(this.network, this.dataLayer, mnemonic, accountNumber);
  }

  getMultiSigWallet(publicKeys, threshold) {
    return new MultiSigWallet(this.network, this.dataLayer, publicKeys, threshold);
  }

  getUtxos(address) {
    return this.dataLayer.getUtxos(address);
  }

  async getBalance(address) {
    return Number(await this.dataLayer.getBalance(address)) / 100000000;
  }

  async sendTransaction(txHex) {
    return this.dataLayer.sendRawTransaction(txHex);
  }
}

export { MempoolDataLayer, RpcDataLayer };
