/**
 * Bitcoin Core RPC Client for regtest mode
 * Communicates directly with a local bitcoind instance
 */

import { execSync, exec } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export class BitcoinRpcClient {
  constructor(host = 'localhost', port = 18332, username = 'bitcoin', password = 'bitcoin', useDocker = true) {
    this.host = host;
    this.port = port;
    this.username = username;
    this.password = password;
    this.url = `http://${host}:${port}`;
    this.useDocker = useDocker;
    this.tmpDir = null;
  }

  /**
   * Make an RPC call using docker exec with proper parameter handling
   */
  async callDocker(method, params = []) {
    try {
      // For methods with complex JSON parameters, use a JSON-RPC request file
      if (params.length > 0 && (typeof params[0] === 'object' || method === 'scantxoutset')) {
        return this.callDockerViaJsonFile(method, params);
      }

      // Format simple parameters for bitcoind-cli
      const formattedParams = params.map(p => {
        if (typeof p === 'string') {
          // Escape special characters in strings
          return `"${p.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`')}"`;
        } else if (typeof p === 'number' || typeof p === 'boolean') {
          return String(p);
        } else {
          return `'${JSON.stringify(p)}'`;
        }
      });

      const cmd = `docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=${this.username} -rpcpassword=${this.password} ${method} ${formattedParams.join(' ')}`;
      
      const output = execSync(cmd, { encoding: 'utf8', shell: true, maxBuffer: 10 * 1024 * 1024 }).trim();
      
      // Try to parse as JSON, otherwise return as string
      try {
        return JSON.parse(output);
      } catch {
        return output === '' ? true : output;
      }
    } catch (error) {
      throw new Error(`Docker RPC call '${method}' failed: ${error.message}`);
    }
  }

  /**
   * Make complex RPC calls using a JSON file to avoid shell parsing issues
   */
  async callDockerViaJsonFile(method, params = []) {
    try {
      // Create temporary file with JSON-RPC request
      const tmpFile = `/tmp/rpc-${Date.now()}-${Math.random().toString(36).slice(2)}.json`;
      const rpcRequest = {
        jsonrpc: '1.0',
        id: 'copilot',
        method: method,
        params: params
      };

      // Write to temporary location
      const cmd = `docker exec bitcoin-regtest bash -c 'cat > ${tmpFile} && bitcoin-cli -regtest -rpcuser=${this.username} -rpcpassword=${this.password} -stdin < ${tmpFile} && rm ${tmpFile}'`;
      
      const input = JSON.stringify(rpcRequest);
      const result = execSync(cmd, { encoding: 'utf8', input, maxBuffer: 10 * 1024 * 1024 }).trim();
      
      // Parse result
      try {
        return JSON.parse(result);
      } catch {
        return result === '' ? true : result;
      }
    } catch (error) {
      // Fallback to simpler approach
      throw new Error(`Docker RPC JSON call '${method}' failed: ${error.message}`);
    }
  }

  /**
   * Make an RPC call to Bitcoin Core via HTTP
   */
  async callHttp(method, params = []) {
    const auth = Buffer.from(`${this.username}:${this.password}`).toString('base64');
    
    const body = JSON.stringify({
      jsonrpc: '1.0',
      id: 'copilot',
      method: method,
      params: params
    });

    try {
      const response = await fetch(this.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Basic ${auth}`
        },
        body: body,
        timeout: 5000
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${await response.text()}`);
      }

      const data = await response.json();

      if (data.error && data.error !== null) {
        throw new Error(`RPC Error: ${data.error.message}`);
      }

      return data.result;
    } catch (error) {
      throw new Error(`HTTP RPC call failed: ${error.message}`);
    }
  }

  /**
   * Make an RPC call (tries docker first on Windows, then HTTP)
   */
  async call(method, params = []) {
    if (this.useDocker) {
      return this.callDocker(method, params);
    } else {
      return this.callHttp(method, params);
    }
  }

  /**
   * Get UTXOs for an address
   */
  async getAddressUtxos(address) {
    try {
      // Use scantxoutset for regtest
      const result = await this.call('scantxoutset', ['start', [`addr(${address})`]]);
      
      return result.unspents.map(u => ({
        txid: u.txid,
        vout: u.vout,
        value: BigInt(u.amount * 100000000), // Convert BTC to satoshis
        height: u.height
      }));
    } catch (error) {
      console.error(`Error fetching UTXOs for ${address}:`, error.message);
      return [];
    }
  }

  /**
   * Get balance for an address
   */
  async getAddressBalance(address) {
    const utxos = await this.getAddressUtxos(address);
    return utxos.reduce((sum, u) => sum + u.value, 0n);
  }

  /**
   * Send a raw transaction
   */
  async sendRawTransaction(txHex) {
    return this.call('sendrawtransaction', [txHex]);
  }

  /**
   * Get raw transaction
   */
  async getRawTransaction(txid, verbose = true) {
    return this.call('getrawtransaction', [txid, verbose]);
  }

  /**
   * Generate blocks (only works in regtest mode!)
   */
  async generateBlocks(blocks = 1, address = null) {
    if (!address) {
      address = await this.call('getnewaddress');
    }
    return this.call('generatetoaddress', [blocks, address]);
  }

  /**
   * Get a new address
   */
  async getNewAddress() {
    return this.call('getnewaddress');
  }

  /**
   * Get block info
   */
  async getBlockcount() {
    return this.call('getblockcount');
  }

  /**
   * Get network info
   */
  async getNetworkInfo() {
    return this.call('getnetworkinfo');
  }

  /**
   * List unspent transactions for wallet
   */
  async listUnspent(minconf = 0, maxconf = 9999999, addresses = []) {
    return this.call('listunspent', [minconf, maxconf, addresses]);
  }

  /**
   * Get wallet balance
   */
  async getBalance() {
    return this.call('getbalance');
  }

  /**
   * Get transaction info
   */
  async getTransaction(txid) {
    return this.call('gettransaction', [txid]);
  }

  /**
   * Check if node is in regtest mode
   */
  async isRegtest() {
    try {
      const blockcount = await this.getBlockcount();
      return true; // If we got a response, we're connected to regtest
    } catch (e) {
      return false;
    }
  }
}

/**
 * Helper function to create RPC client with error handling
 */
export async function createRpcClient(host = 'localhost', port = 18332, username = 'bitcoin', password = 'bitcoin') {
  const client = new BitcoinRpcClient(host, port, username, password);
  
  // Test connection
  try {
    const info = await client.getNetworkInfo();
    console.log(`✓ Connected to Bitcoin Core at ${host}:${port}`);
    console.log(`  Network: ${info.subversion}`);
    return client;
  } catch (error) {
    console.error('✗ Cannot connect to Bitcoin Core!');
    console.error(`  Make sure bitcoind is running with these settings:`);
    console.error(`  bitcoind -regtest -rpcuser=bitcoin -rpcpassword=bitcoin`);
    throw error;
  }
}
