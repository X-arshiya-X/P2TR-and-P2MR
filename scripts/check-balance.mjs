#!/usr/bin/env node
import { createRpcClient } from './scripts/rpc-client.mjs';

const rpc = await createRpcClient();
const addr = 'bcrt1p7rmutwk8ptscdsgda22n22rt8nch2z5tyf5ndyc70u4qy7l6rhzqacms53';

const utxos = await rpc.call('listunspent', [0, 999999]);
const filtered = utxos.filter(u => u.address === addr);

console.log(`UTXOs for ${addr}:`);
console.log(JSON.stringify(filtered, null, 2));
