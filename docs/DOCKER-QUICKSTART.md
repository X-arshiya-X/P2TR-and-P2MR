# Quick Start: Regtest Bitcoin Environment

> Using **ruimarinho/bitcoin-core** Docker image for instant Bitcoin testing

## One-Command Setup

```bash
# Start Bitcoin Core regtest in Docker
docker-compose up -d

# Initialize blockchain with test coins
npm run setup-regtest

# Run example (requires mnemonic.json)
npm run example-regtest mnemonic.json
```

That's it! You now have a private Bitcoin regtest blockchain running.

## What You Get

✅ **Local Bitcoin Core** running in regtest mode  
✅ **Instant block generation** - no waiting  
✅ **Unlimited test coins** - generate more as needed  
✅ **Easy cleanup** - just `docker-compose down`  
✅ **Persistent data** - stops/starts without losing blockchain  

## Common Tasks

### Fund a Wallet
```bash
# Get a miner address
MINER_ADDR=$(docker exec bitcoin-regtest bitcoin-cli -regtest getnewaddress)

# Generate 50 blocks to earn 50 BTC
docker exec bitcoin-regtest bitcoin-cli -regtest generatetoaddress 50 $MINER_ADDR

# Send 10 BTC to your address
docker exec bitcoin-regtest bitcoin-cli -regtest sendtoaddress <your-address> 10

# Generate 1 block to confirm
docker exec bitcoin-regtest bitcoin-cli -regtest generatetoaddress 1 $MINER_ADDR
```

### Check Status
```bash
# Block height
docker exec bitcoin-regtest bitcoin-cli -regtest getblockcount

# Wallet balance
docker exec bitcoin-regtest bitcoin-cli -regtest getbalance

# List addresses
docker exec bitcoin-regtest bitcoin-cli -regtest listreceivedbyaddress 0 true
```

### Reset Blockchain
```bash
# Stop and delete all data
docker-compose down -v

# Start fresh
docker-compose up -d
npm run setup-regtest
```

## Using in Your Code

See [REGTEST-SETUP.md](REGTEST-SETUP.md) for complete integration guide.

Quick example:
```javascript
import { BitcoinClient, RpcDataLayer } from './unified-client.mjs';
import { createRpcClient } from './rpc-client.mjs';

const rpc = await createRpcClient();
const dataLayer = new RpcDataLayer(rpc);
const client = new BitcoinClient('regtest', dataLayer);

const wallet = client.getAccountWallet(mnemonic, 0);
console.log(`Address: ${wallet.address}`);
console.log(`Balance: ${await client.getBalance(wallet.address)} BTC`);
```

## Docker Troubleshooting

### Container won't start
```bash
docker-compose logs bitcoin-regtest
docker-compose down -v  # Reset everything
docker-compose up -d
```

### Port already in use
Change the port in `docker-compose.yml`:
```yaml
ports:
  - "18332:18332"  # Change first number to something else like "18335:18332"
```

### Need to access Bitcoin CLI
```bash
docker exec -it bitcoin-regtest bash
bitcoin-cli -regtest getblockcount
```

## Files Overview

- **docker-compose.yml** - Start Bitcoin Core with one command
- **rpc-client.mjs** - RPC client for communicating with Bitcoin Core
- **unified-client.mjs** - Works with both testnet and regtest
- **setup-regtest.mjs** - Initialize regtest blockchain
- **example-regtest.mjs** - Full example using regtest
- **REGTEST-SETUP.md** - Detailed setup and reference guide

## Next Steps

1. ✅ Start Docker: `docker-compose up -d`
2. ✅ Initialize: `npm run setup-regtest`
3. ✅ Create mnemonic: `echo '["word1","word2",...]' > mnemonic.json`
4. ✅ Fund wallet: See "Fund a Wallet" section above
5. ✅ Run example: `npm run example-regtest mnemonic.json`

**Ready to test! 🚀**
