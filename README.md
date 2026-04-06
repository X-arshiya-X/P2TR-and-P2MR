# P2TR and P2MR - Bitcoin Transaction Formats

Bitcoin transaction format examples demonstrating **P2TR (Pay to Taproot, BIP-341)** and **P2MR (Pay to Merkle Root, BIP-360)** using bitcoinjs-lib.

> **✅ Quick Demo**: See [DEMO-GUIDE.md](DEMO-GUIDE.md) for step-by-step instructions to run the demos with a real Bitcoin regtest blockchain.

**Note:** Most code in this repository was generated with AI assistance and subsequently validated and modified by the authors to ensure correctness and functionality.

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

### Complete Demo Walkthrough

**For the full step-by-step demo with regtest blockchain, see [DEMO-GUIDE.md](DEMO-GUIDE.md)** — covers:
- Starting Bitcoin Core in Docker
- Generating a BIP-39 mnemonic
- Deriving addresses from your seed phrase
- Funding accounts and running both demos
- Understanding transactions on-chain

### Running Demos Directly

Quick demo without setup (dry-run mode, works with mempool.space testnet API):

```bash
# Create test mnemonic JSON
echo '["abandon","ability","able","about","above","absent","absorb","abstract","abuse","access","accident","account"]' > mnemonic.json

# Run P2TR demo (Key-Path & Script-Path Spend)
npm run p2tr mnemonic.json

# Run P2MR demo (SegWit v2 with Merkle Root)
npm run p2mr mnemonic.json
```



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

- **[DEMO-GUIDE.md](DEMO-GUIDE.md)** ⭐ — Complete step-by-step guide (START HERE)
  - Regtest blockchain setup
  - Address derivation from mnemonic
  - Funding and transaction execution
  - Both P2TR and P2MR demos
- [docs/DOCKER-QUICKSTART.md](docs/DOCKER-QUICKSTART.md) - Fast Docker setup reference
- [docs/REGTEST-SETUP.md](docs/REGTEST-SETUP.md) - Detailed regtest configuration
- **[BIP_360.pdf](BIP_360.pdf)** 📊 — Research slides on BIP-360 and P2MR
  - Why BIP-360 (P2MR) was introduced
  - Comparison with P2TR (BIP-341)
  - Quantum resistance benefits
- Comments in source files explain transaction building and BIP specifications

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

- **P2MR (BIP-360)** - Pay-to-Merkle-Root (Draft) — [See BIP_360.pdf](BIP_360.pdf) for detailed research
  - **SegWit v2** (tb1z... addresses) — different from P2TR's SegWit v1
  - **Why BIP-360 was introduced:**
    - Quantum-resistant: Script-path only (no key-path, internal key never exposed on-chain)
    - Better privacy: Hides quantum-vulnerable key material vs P2TR control block leak
    - Space efficient: 32 bytes saved per input control block vs P2TR
    - Addresses P2TR limitations: While P2TR is excellent, it exposes internal key in control block during script-path spend
  - Currently draft status, not yet activated on mainnet
  - Educational reference for quantum-resistant Bitcoin protocols
  - ⚠️ For detailed comparison and motivation, see [BIP_360.pdf](BIP_360.pdf)

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

## 👥 Authors

Sadra Setarehdan, Rafik Hamzi, Arshiya Mahmoodinezhad

**Code Generation:** Most implementation code was generated using AI assistance, with extensive validation, testing, and modifications by the authors to ensure correctness, security, and educational value.

