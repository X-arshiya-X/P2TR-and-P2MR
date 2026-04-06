#!/usr/bin/env node
import { createRpcClient } from './scripts/rpc-client.mjs';

const rpc = await createRpcClient();

const utxos = await rpc.call('listunspent', [0, 999999]);

console.log(`All UTXOs in wallet (${utxos.length} total):\n`);
utxos.forEach((u, i) => {
  console.log(`[${i}] ${u.address} - ${u.amount} BTC (${Math.floor(u.amount * 100000000)} sats)`);
});
