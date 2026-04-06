# Repository Structure

## Project Organization

```
P2TR-and-P2MR/
├── README.md                      # Main project documentation
├── package.json                   # Node.js dependencies and scripts
├── docker-compose.yml             # Docker configuration for Bitcoin regtest
├── mnemonic.json                  # BIP-39 test mnemonic (standard test vector)
│
├── config/                        # Configuration files
│   ├── bitcoin.conf               # Bitcoin Core regtest configuration
│   └── regtest/
│       └── wallets.json           # Generated wallet addresses (auto-created)
│
├── docs/                          # Documentation
│   ├── DOCKER-QUICKSTART.md      # Quick setup with Docker
│   └── REGTEST-SETUP.md          # Detailed regtest setup guide
│
├── p2tr/                          # Pay-to-Taproot (BIP-341) demo
│   ├── index.mjs                  # Main P2TR demo script
│   └── lib.mjs                    # P2TR wallet utilities and Bitcoin client
│
├── p2mr/                          # Pay-to-Merkle-Root (BIP-360) demo
│   ├── index.mjs                  # Main P2MR demo script
│   └── lib.mjs                    # P2MR wallet utilities
│
└── scripts/                       # Utility scripts
    ├── rpc-client.mjs             # Bitcoin Core RPC client (Docker exec wrapper)
    ├── unified-client.mjs         # Client supporting both testnet4 and regtest
    ├── setup-regtest.mjs          # Initialize regtest blockchain with funds
    ├── example-regtest.mjs        # Example transaction on regtest
    ├── fund-wallets.mjs           # Fund P2TR/P2MR addresses with test coins
    ├── check-balance.mjs          # Query wallet balance
    ├── check-txs.mjs              # Check transaction status
    ├── list-all-utxos.mjs         # List all UTXOs in wallet
    ├── import-wallet.mjs          # Import wallet from descriptor
    └── import-descriptor.mjs      # Import BIP-49/86 extended keys
```

## Key Files

### Entry Points
- **`p2tr/index.mjs`** – Run: `npm run p2tr <mnemonic.json>`
  - Demonstrates P2TR key-path and script-path spending
  - Uses local regtest or testnet4 API
  
- **`p2mr/index.mjs`** – Run: `npm run p2mr <mnemonic.json>`
  - Demonstrates P2MR (Merkle Root) with script trees
  - Shows cost and privacy comparisons with P2TR

### Configuration
- **`config/bitcoin.conf`** – Bitcoin Core settings for regtest
- **`config/regtest/wallets.json`** – Auto-generated test wallet addresses
- **`mnemonic.json`** – BIP-39 test mnemonic (edit to use your own)

### Utilities
- **`scripts/rpc-client.mjs`** – Wraps bitcoin-cli via Docker exec
- **`scripts/setup-regtest.mjs`** – Creates wallet and generates initial blocks
- **`scripts/fund-wallets.mjs`** – Sends test BTC to demo addresses

## Usage

### Quick Start
```bash
# 1. Start Bitcoin regtest
docker-compose up -d

# 2. Initialize blockchain
npm run setup-regtest

# 3. Fund demo wallets
node scripts/fund-wallets.mjs

# 4. Run P2TR demo
npm run p2tr mnemonic.json

# 5. Run P2MR demo
npm run p2mr mnemonic.json
```

### Directory Responsibilities

| Directory | Purpose | Files |
|-----------|---------|-------|
| `config/` | Configuration and generated state | bitcoin.conf, wallets.json |
| `docs/` | Reference documentation | Setup guides, architecture |
| `p2tr/` | P2TR implementation and demo | Wallet library + example |
| `p2mr/` | P2MR implementation and demo | Wallet library + example |
| `scripts/` | Utilities and helpers | RPC client, setup, tooling |

## Important Notes

- **Mnemonic**: `mnemonic.json` stays at root (referenced in `npm run` commands)
- **Configuration**: All config files are in `config/` for easier scanning and backups
- **Scripts**: All utility scripts consolidated in `scripts/` for maintainability
- **Demos**: `p2tr/` and `p2mr/` stay at root to keep `npm run` commands clean

## Adding New Scripts

1. Add your utility script to `scripts/` folder
2. If it's a demo or example, reference it in package.json
3. Update relative paths if it references config files

Example:
```bash
# Old path: ./regtest-config/wallets.json
# New path: ./config/regtest/wallets.json
```
