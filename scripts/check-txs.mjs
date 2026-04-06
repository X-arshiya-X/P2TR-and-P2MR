#!/usr/bin/env node
import { createRpcClient } from './scripts/rpc-client.mjs';

const rpc = await createRpcClient();

const txlist = [
  '067a71f5fb6f50e68362f798bea8ca2542879db0f6d34f5797e8fe085ba35951',
  '056cdb527ce9910627c37c1494240c6645491571e3e4fab69b2415fe625d06a8'
];

for (const txid of txlist) {
  try {
    const tx = await rpc.call('getrawtransaction', [txid, true]);
    console.log(`\nTransaction: ${txid}`);
    console.log(`Confirmations: ${tx.confirmations}`);
    console.log(`Outputs:`);
    tx.vout.forEach((vout, i) => {
      console.log(`  [${i}] ${vout.value} BTC - ${vout.scriptPubKey.address}`);
    });
  } catch (e) {
    console.log(`❌ Error getting tx ${txid}: ${e.message}`);
  }
}
