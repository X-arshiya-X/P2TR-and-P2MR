# P2TR and P2MR - Bitcoin Transaction Formats

Bitcoin transaction format examples demonstrating **P2TR (Pay to Taproot)** and **P2MR (Pay to Merkle Root)** using bitcoinjs-lib.

## 📁 Project Structure

```
├── p2tr/                       # Pay-to-Taproot (BIP-341) examples
│   ├── index.mjs              # P2TR key-path and script-path demonstration
│   └── lib.mjs                # P2TR wallet utilities and Bitcoin client
│
├── p2mr/                       # Pay-to-Merkle-Root (BIP-360) examples
│   ├── index.mjs              # P2MR script-path demonstration
│   └── lib.mjs                # P2MR wallet utilities and helper functions
│
├── scripts/                    # Utility scripts
│   ├── rpc-client.mjs         # Bitcoin Core RPC client
│   ├── unified-client.mjs     # Works with testnet and regtest
│   ├── setup-regtest.mjs      # Initialize private blockchain
│   └── example-regtest.mjs    # Regtest transaction example
│
├── docs/                       # Documentation
│   ├── REGTEST-SETUP.md       # Detailed regtest setup guide
│   └── DOCKER-QUICKSTART.md   # Quick start with Docker
│
├── docker-compose.yml          # Bitcoin Core regtest container
├── bitcoin.conf                # Bitcoin Core configuration
├── package.json                # Dependencies and scripts
└── README.md                   # This file
```

## 🚀 Quick Start

### Running the Demos

All demos use **mempool.space testnet4 API** and support **dry-run mode** (no testnet coins needed):

```bash
# Run P2TR demo (Key-Path & Script-Path Spend)
npm run p2tr <mnemonic.json>

# Run P2MR demo (Merkle Root & Script-Path)
npm run p2mr <mnemonic.json>
```

### Example with Test Mnemonic

```bash
# Create test mnemonic JSON
echo '["abandon","ability","able","about","above","absent","absorb","abstract","abuse","access","accident","account"]' > mnemonic.json

# Run demos
npm run p2tr mnemonic.json
npm run p2mr mnemonic.json
```

### Option 1: Regtest (Private Blockchain - For Live Testing)
```

See [docs/DOCKER-QUICKSTART.md](docs/DOCKER-QUICKSTART.md) for details.

### Option 2: Testnet4 API (No Setup Required)

```bash
# Create test mnemonic
echo '["abandon","ability","able","about","above","absent","absorb","abstract","abuse","access","accident","account"]' > mnemonic.json

# Run demos (uses mempool.space testnet4 API)
npm run p2tr mnemonic.json
npm run p2mr mnemonic.json
```

**Note:** Runs in dry-run mode without actual testnet coins. To broadcast live transactions, the addresses need testnet coins.

## 📚 Available Scripts

### Main Demos

- `npm run p2tr <mnemonic.json>` - Pay-to-Taproot demo (Key-Path & Script-Path Spend)
- `npm run p2mr <mnemonic.json>` - Pay-to-Merkle-Root demo (Merkle Tree & Script-Path)

### Regtest Utilities

- `npm run setup-regtest` - Initialize Bitcoin regtest environment
- `npm run example-regtest <mnemonic-file>` - Run transaction example on regtest

## 🔧 Requirements

- Node.js 16+
- Docker & Docker Compose (for regtest)
- npm dependencies (installed automatically)

## Dependencies

- **bitcoinjs-lib** - Bitcoin transaction building
- **bip39** - BIP39 mnemonic generation
- **bip32** - BIP32 hierarchical key derivation
- **ecpair** - EC key pair generation
- **tiny-secp256k1** - Elliptic curve cryptography

## 📖 Documentation

- [DOCKER-QUICKSTART.md](docs/DOCKER-QUICKSTART.md) - Fast setup with Docker
- [REGTEST-SETUP.md](docs/REGTEST-SETUP.md) - Detailed regtest configuration
- Comments in source files explain transaction building

## 🏗️ How It Works

### Bitcoin Transaction Flow

1. **Wallet Creation** - Derive keys from BIP39 mnemonic using BIP32
2. **UTXO Selection** - Find spendable outputs for the address
3. **PSBT Construction** - Create Partially Signed Bitcoin Transaction
4. **Signing** - Sign with private key using ECDSA
5. **Broadcasting** - Send raw transaction to network

### Transaction Types (Focus: Modern Taproot)

- **P2TR (BIP-341)** - Pay-to-Taproot
  - Key-path spend: Most private, efficient single-signature path
  - Script-path spend: Reveals one script condition, hides others in Merkle tree
  - Supports BIP-342 TapScript for advanced spending conditions

- **P2MR (BIP-360)** - Pay-to-Merkle-Root (Draft)
  - Script-path only: No key-path spend available
  - Smaller control blocks (32 bytes saved per input)
  - Quantum-resistant for long-term key exposure
  - Currently draft status, educational reference

## 🧪 Testing

All examples work with:
- **Bitcoin Testnet** (public, faucet required)
- **Regtest** (private, unlimited coins)

Private regtest is recommended for development and testing.

## 💡 Environment Variables

For custom Bitcoin Core RPC settings:
- `RPC_HOST` - Bitcoin Core host (default: localhost)
- `RPC_PORT` - Bitcoin Core port (default: 18332 for regtest)
- `RPC_USER` - RPC username (default: bitcoin)
- `RPC_PASS` - RPC password (default: bitcoin)

## 🔐 Security Notes

- Test mnemonics are for development only
- Never use production keys with regtest examples
- Regtest is not suitable for production
- Use proper key management in production

## 📝 License

ISC

## 🤝 Contributing

Contributions welcome! Please ensure:
- Code follows existing style
- Comments explain complex logic
- Examples are fully functional
