# P2TR & P2MR Demo Guide

Complete step-by-step instructions to run the Pay-to-Taproot (P2TR) and Pay-to-Merkle-Root (P2MR) demos on a local Bitcoin regtest blockchain.

## Prerequisites

- Docker installed
- Node.js and npm installed
- This repository cloned

## Step 1: Start Bitcoin Regtest in Docker

Start the Bitcoin Core regtest environment:

```bash
docker-compose up -d
```

Verify it's running:

```bash
docker ps | grep bitcoin
```

You should see the `bitcoin-regtest` container running.

## Step 2: Initialize the Blockchain

Set up the regtest blockchain with initial test coins:

```bash
npm run setup-regtest
```

This will:
- Create a default wallet
- Generate 101 blocks (earn 101 BTC for testing)
- Set up the foundation for the demos

## Step 3: Create a BIP-39 Mnemonic

Generate a random 12-word mnemonic phrase and save it to `mnemonic.json`:

```bash
node --input-type=module <<'EOF'
import * as bip39 from 'bip39';
import { writeFileSync } from 'fs';

const mnemonic = bip39.generateMnemonic();
const words = mnemonic.split(' ');
writeFileSync('mnemonic.json', JSON.stringify(words, null, 2));
console.log('Mnemonic saved to mnemonic.json');
console.log('Words:', words);
EOF
```

This creates `mnemonic.json` with your seed phrase (as a JSON array).

## Step 4: Derive Your Address from Mnemonic

Get your P2TR address from your mnemonic:

```bash
node --input-type=module <<'EOF'
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { readFileSync } from 'fs';

bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);

const mnemonicWords = JSON.parse(readFileSync('mnemonic.json', 'utf8'));
const mnemonic = mnemonicWords.join(' ');
const seed = bip39.mnemonicToSeedSync(mnemonic);
const root = bip32.fromSeed(seed, bitcoin.networks.regtest);

// Derive Account 0 using BIP-86 path: m/86'/1'/0'/0/0 (regtest)
const account0 = root.derivePath("m/86'/1'/0'/0/0");
const { address } = bitcoin.payments.p2tr({
  internalPubkey: account0.publicKey.subarray(1),
  network: bitcoin.networks.regtest
});

console.log('Account 0 P2TR Address:', address);
EOF
```

**Save this address** — you'll need it in the next step. Example output: `bcrt1pr43as0rueu3pfag4r9y3w2ktsl5snhsjxjr4277ykhruznp6kgds2mhj30`

## Step 5: Fund Your Mnemonic Account

Send test Bitcoin to your derived address:

```bash
# Get a miner address for block generation
MINER_ADDR=$(docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=bitcoin -rpcpassword=bitcoin -rpcwallet=default getnewaddress)

# Send 2 BTC to your mnemonic Account 0 (replace with YOUR address from above)
docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=bitcoin -rpcpassword=bitcoin -rpcwallet=default sendtoaddress YOUR_ACCOUNT_0_ADDRESS 2

# Mine a block to confirm
docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=bitcoin -rpcpassword=bitcoin -rpcwallet=default generatetoaddress 1 "$MINER_ADDR"
```

**Replace `YOUR_ACCOUNT_0_ADDRESS`** with the address from the previous step.

## Step 6: Run P2TR Demo

Execute the Pay-to-Taproot demo with your mnemonic:

```bash
npm run p2tr mnemonic.json
```

**Expected Output:**
- ✅ Key-Path Spend transaction sent and confirmed
- ✅ Script-Path Spend (hash-lock) transactions sent and confirmed
- 📊 Comparison table of P2TR features

This demonstrates:
1. **Key-Path Spend**: Schnorr signature (most private, cheapest)
2. **Script-Path Spend**: Hash-lock example (reveals one script branch)

## Step 7: Run P2MR Demo

Execute the Pay-to-Merkle-Root demo with your mnemonic:

```bash
npm run p2mr mnemonic.json
```

**Expected Output:**
- ✅ P2MR deposit transaction sent and confirmed
- ✅ P2MR sweep transaction (using Leaf A script) sent and confirmed
- 📊 Comparison table of P2MR vs P2TR features

This demonstrates:
1. **Deposit**: Funding a P2MR address from P2TR account
2. **Script-Path Spend**: Using the first script leaf to spend
3. **Privacy**: Leaf B stays hidden (not revealed on-chain)

## Cleanup

### Stop and Restart Blockchain

To reset the blockchain state:

```bash
docker-compose down -v
docker-compose up -d
npm run setup-regtest
```

### Stop Without Deleting Data

To stop the blockchain while preserving state:

```bash
docker-compose down
```

### Restart Without Resetting

To resume with preserved blockchain:

```bash
docker-compose up -d
```

## Troubleshooting

### Container won't start

```bash
docker-compose logs bitcoin-regtest
docker-compose down -v
docker-compose up -d
```

### Port already in use

Edit `docker-compose.yml` and change:
```yaml
ports:
  - "18332:18332"  # Change first number to something else like "18335:18332"
```

### Out of funds

Generate more blocks and re-fund:

```bash
MINER_ADDR=$(docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=bitcoin -rpcpassword=bitcoin -rpcwallet=default getnewaddress)
docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=bitcoin -rpcpassword=bitcoin -rpcwallet=default generatetoaddress 20 "$MINER_ADDR"
```

Then re-fund your mnemonic account.

### Check blockchain status

```bash
# Block height
docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=bitcoin -rpcpassword=bitcoin getblockcount

# Wallet balance
docker exec bitcoin-regtest bitcoin-cli -rpcuser=bitcoin -rpcpassword=bitcoin -rpcwallet=default getbalance
```

## Complete Quick-Start Script

Run everything in sequence:

```bash
# 1. Start Docker
docker-compose up -d

# 2. Initialize blockchain
npm run setup-regtest

# 3. Create mnemonic
node --input-type=module <<'EOF'
import * as bip39 from 'bip39';
import { writeFileSync } from 'fs';
const mnemonic = bip39.generateMnemonic();
const words = mnemonic.split(' ');
writeFileSync('mnemonic.json', JSON.stringify(words, null, 2));
console.log('Mnemonic saved to mnemonic.json');
console.log('Words:', words);
EOF

# 4. Derive your address from mnemonic
ACCOUNT_0_ADDR=$(node --input-type=module <<'INNER_EOF'
import { BIP32Factory } from 'bip32';
import * as bip39 from 'bip39';
import * as bitcoin from 'bitcoinjs-lib';
import * as ecc from 'tiny-secp256k1';
import { readFileSync } from 'fs';
bitcoin.initEccLib(ecc);
const bip32 = BIP32Factory(ecc);
const mnemonicWords = JSON.parse(readFileSync('mnemonic.json', 'utf8'));
const mnemonic = mnemonicWords.join(' ');
const seed = bip39.mnemonicToSeedSync(mnemonic);
const root = bip32.fromSeed(seed, bitcoin.networks.regtest);
const account0 = root.derivePath("m/86'/1'/0'/0/0");
const { address } = bitcoin.payments.p2tr({
  internalPubkey: account0.publicKey.subarray(1),
  network: bitcoin.networks.regtest
});
console.log(address);
INNER_EOF
)

# 5. Fund your account and mine a block
MINER_ADDR=$(docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=bitcoin -rpcpassword=bitcoin -rpcwallet=default getnewaddress)
docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=bitcoin -rpcpassword=bitcoin -rpcwallet=default sendtoaddress "$ACCOUNT_0_ADDR" 2
docker exec bitcoin-regtest bitcoin-cli -regtest -rpcuser=bitcoin -rpcpassword=bitcoin -rpcwallet=default generatetoaddress 1 "$MINER_ADDR"

# 6. Run P2TR demo
npm run p2tr mnemonic.json

# 7. Run P2MR demo
npm run p2mr mnemonic.json
```

## File Locations

- **Mnemonic**: `./mnemonic.json`
- **P2TR Demo**: `./p2tr/index.mjs`
- **P2MR Demo**: `./p2mr/index.mjs`
- **RPC Client**: `./scripts/rpc-client.mjs`
- **Bitcoin Config**: `./config/bitcoin.conf`
- **Docker Compose**: `./docker-compose.yml`

## Key Concepts

### P2TR (BIP-341)
- **SegWit v1** (tb1p... addresses)
- **Key-path spend**: Schnorr signature only (64 bytes)
- **Script-path spend**: Tap-script with control block
- **Privacy**: No other scripts revealed on-chain
- **Status**: Active on mainnet

### P2MR (BIP-360)
- **SegWit v2** (tb1z... addresses, experimental)
- **No key-path spend**: Only script-path available
- **Quantum-resistant**: Internal key never exposed
- **Control block**: Smaller than P2TR (no key, just proof)
- **Status**: Draft, not yet activated

## Network Settings

- **Network**: Regtest (local)
- **RPC Host**: localhost
- **RPC Port**: 18332
- **RPC Username**: bitcoin
- **RPC Password**: bitcoin
- **Wallet**: default

## References

- [BIP-341: Taproot](https://github.com/bitcoin/bips/blob/master/bip-0341.mediawiki)
- [BIP-360: Pay-to-Merkle-Root (Draft)](https://github.com/bitcoin/bips/blob/master/bip-0360.mediawiki)
- [BIP-342: Tapscript](https://github.com/bitcoin/bips/blob/master/bip-0342.mediawiki)
