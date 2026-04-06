# Bitcoin Regtest Setup Guide

This project supports testing on a private Bitcoin regtest blockchain. You have two options:

## Option 1: Docker (Recommended - Easiest)

### Prerequisites
- Docker and Docker Compose installed

### Steps

1. **Start Bitcoin Core in Docker:**
   ```bash
   docker-compose up -d
   ```

2. **Initialize regtest:**
   ```bash
   npm run setup-regtest
   ```

3. **Verify it's running:**
   ```bash
   docker logs bitcoin-regtest
   ```

4. **To stop:**
   ```bash
   docker-compose down
   ```

5. **To restart (keeps blockchain state):**
   ```bash
   docker-compose restart
   ```

6. **To reset blockchain (delete all data):**
   ```bash
   docker-compose down -v
   docker-compose up -d
   npm run setup-regtest
   ```

## Option 2: Local Bitcoin Core

### Prerequisites
- Bitcoin Core 18.0 or later installed
- Available on: https://bitcoin.org/en/download

### Steps

1. **Start Bitcoin Core in regtest mode:**
   
   **Linux/macOS:**
   ```bash
   bitcoind -regtest -server -rpcuser=bitcoin -rpcpassword=bitcoin -rpcallowip=0.0.0.0/0
   ```

   **Windows:**
   ```cmd
   bitcoin-qt.exe -regtest -server -rpcuser=bitcoin -rpcpassword=bitcoin -rpcallowip=0.0.0.0/0
   ```

   Or create a `bitcoin.conf` file in your Bitcoin data directory:
   ```
   regtest=1
   server=1
   rpcuser=bitcoin
   rpcpassword=bitcoin
   rpcallowip=0.0.0.0/0
   txindex=1
   fallbackfee=0.0001
   ```

   Then start: `bitcoind -regtest`

2. **Initialize regtest:**
   ```bash
   npm run setup-regtest
   ```

3. **Verify it's working:**
   ```bash
   bitcoin-cli -regtest getblockcount
   ```

## RPC Configuration

The default RPC configuration is:
- **Host:** localhost
- **Port:** 18332 (regtest default)
- **Username:** bitcoin
- **Password:** bitcoin

You can modify these in `rpc-client.mjs` if needed.

## Using Regtest in Your Code

### Switch to regtest in your scripts:

```javascript
import { BitcoinClient } from './unified-client.mjs';
import { RpcDataLayer } from './unified-client.mjs';
import { createRpcClient } from './rpc-client.mjs';

// Create RPC client
const rpc = await createRpcClient();

// Create data layer
const dataLayer = new RpcDataLayer(rpc);

// Create Bitcoin client with regtest
const client = new BitcoinClient('regtest', dataLayer);

// Now use normally
const wallet = client.getAccountWallet(mnemonic, 0);
console.log(wallet.address);
```

## Useful Commands

```bash
# Generate blocks
bitcoin-cli -regtest generatetoaddress 1 $(bitcoin-cli -regtest getnewaddress)

# Get balance
bitcoin-cli -regtest getbalance

# Get new address
bitcoin-cli -regtest getnewaddress

# Send BTC to address (address and amount in BTC)
bitcoin-cli -regtest sendtoaddress <address> 10

# Get block count
bitcoin-cli -regtest getblockcount

# Get transaction info
bitcoin-cli -regtest gettransaction <txid>

# List unspent outputs
bitcoin-cli -regtest listunspent
```

## Key Differences from Testnet

| Feature | Testnet | Regtest |
|---------|---------|---------|
| **Speed** | ~10 min blocks | Instant (you control) |
| **Privacy** | Public | Private (local only) |
| **Funds** | Free faucet | Generate instantly |
| **Reset** | Permanent | Easy reset |
| **Use Case** | Development/Testing | Unit tests, quick demos |

## Advantages of Regtest

1. ✅ **Instant block generation** - No waiting for blocks
2. ✅ **Unlimited funds** - Generate as much as you need
3. ✅ **Private network** - Complete control and isolation
4. ✅ **Deterministic** - Same behavior every time
5. ✅ **Fast testing** - Perfect for CI/CD pipelines
6. ✅ **Easy reset** - Delete data and start fresh

## Docker Tips

### View logs:
```bash
docker logs bitcoin-regtest
```

### Execute commands in container:
```bash
docker exec bitcoin-regtest bitcoin-cli -regtest getblockcount
```

### Connect to container shell:
```bash
docker exec -it bitcoin-regtest bash
```

### Remove old container and data:
```bash
docker-compose down -v
```

## Troubleshooting

### "Connection refused"
- Make sure Bitcoin Core is running
- Check host and port (should be localhost:18332 for regtest)
- Check firewall settings

### "Not enough funds"
- Generate blocks to create coinbase rewards: `bitcoin-cli -regtest generatetoaddress 10 <address>`
- Send BTC from the miner address to your wallet

### Docker container won't start
```bash
# Check logs
docker logs bitcoin-regtest

# Rebuild image
docker-compose build --no-cache

# Remove old volumes
docker-compose down -v
```

### RPC authentication fails
- Verify username/password (default: bitcoin/bitcoin)
- Check `rpcuser` and `rpcpassword` in bitcoin.conf or startup parameters
