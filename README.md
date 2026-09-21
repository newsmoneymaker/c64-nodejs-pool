# c64-nodejs-pool

Mining pool software for **C64 Chain (C64)** written in Node.js: a stratum server for C64's RandomX variant (`rx/c64`) with share checking, block accounting
through the pool wallet (including the coin's reward vesting), and batch payouts. It is a fork of
[cryptonote-nodejs-pool](https://github.com/dvandal/cryptonote-nodejs-pool) by Dvandal (GNU GPL v2) and of its adaptations
[epic-nodejs-pool](https://github.com/newsmoneymaker/epic-nodejs-pool), [veil-nodejs-pool](https://github.com/newsmoneymaker/veil-nodejs-pool) and
[qwc-nodejs-pool](https://github.com/newsmoneymaker/qwc-nodejs-pool), written for the Monero-style daemon and wallet RPC of C64 Chain (a Monero fork).
Live example: <https://c64.pool-pay.com>.

## What it does

* **Stratum server** (plain TCP and TLS ports, XMRig protocol with the `algo` extension): the pool asks the node for a block template
  (`get_block_template`), gives every miner the hashing blob and a share target that follows the miner's hashrate (vardiff, remembered across reconnects),
  and checks every share itself with a small C++ helper (`hasher/rxhash`): RandomX of the hashing blob with the seed hash as key, using the RandomX library
  of the C64 node itself. A share that meets the network difficulty is submitted to the node with `submit_block`.
  The pool announces the algorithm `rx/c64` in every job: the miner has to know it ([poolpayminer](https://github.com/newsmoneymaker/poolpayminer) does).
* **Accounts** are C64 Chain addresses (`Wo...`, 97 characters, Keccak checksum verified; subaddresses are fine, integrated addresses are not),
  optionally `+worker`, with a reward mode prefix `prop:` (shared, default) or `solo:`.
* **Rewards:** PROP with time weighting (slush) or SOLO.
* **Vesting:** C64 Chain pays a block reward to the pool wallet in four equal outputs that unlock after 288 / 8640 / 17280 / 25920 blocks (about 24 h, 30, 60 and
  90 days; 2% of the reward goes to the coin's dev fund). The pool never pays out coins it cannot spend yet: after `depth` blocks the unlocker credits the first quarter of
  every account's share, stores the other three quarters in redis and credits them when their unlock height is reached. The locked amount is shown on the miner's page.
* **Block unlocker:** a block is settled after `depth` blocks (300, the first output unlocks after 288). The reward is what the pool wallet received in the block's
  coinbase transaction (wallet `get_transfer_by_txid` on the block's `miner_tx_hash`, without the dev fund output); a block that is no longer on the chain is marked
  orphaned and nothing is credited.
* **Payment processor:** everyone who is due is paid in **one wallet `transfer` per round** (the network fee is shared by the paid miners or paid by
  the pool). The balance is debited before sending; a batch whose outcome is unknown (crash, timeout) is found again among the wallet's transfers by its
  destinations and never sent twice; refused or failed batches go back to the balances. Dry-run mode, a whitelist for rehearsals and an emergency brake
  (`deployment/pause-payments.sh`).
* **Website and API:** a ready website (`website_example/`) with the dashboard and its four graphs, blocks, payments, top miners, worker statistics, a
  "Getting started" page with a config generator, and the public read-only JSON API.
* **Protection against connection floods:** limits per IP, a login deadline, an optional IP allow list, banning of miners with many invalid shares.
* **Tests** (`test/`): the hashing method is checked against real C64 Chain mainnet blocks (`test/test-real-blocks.js`: the hash equals the `pow_hash`
  reported by `c64chaind-mainnet`), and a simulated node and wallet let a real miner find shares and blocks against the pool code; the vesting
  schedule of the unlocker has its own test.

## Developer donation (please read)

The pool takes a **developer donation** from the reward of every block it finds, before the miners' shares are computed. It is configured in
`config.json` (see `config_examples/c64.json`):

```json
"blockUnlocker": {
  "poolFee": 1,
  "donations": { "Wo4oqTgMjwfhku3vJHu5DaXLpEB35pB94JMyWy4GsY1vVfs3m3kmXpbNhkGyYAgnawTL4NuryZmr6XA9PMhDJ4TS2adToMBXd": 0.5 }
}
```

* `poolFee` is the fee of the pool operator (percent). `donations` is a table `C64 address -> percent` (up to 10% per entry) for the developers of
  this software; **the default is 0.5% to the address of the project's own pool**. The donation is paid like any other balance.
* It is included in the "Pool Fee" figure that the pool's website and API show to the miners (as in the original software).
* You are free to change the percentage, the address or to empty the table (`"donations": {}`): it is your pool and the license is the GPL.
  Please tell your miners the truth about the fees of your pool.
* This has nothing to do with the miner poolpayminer (a separate project with its own fee).

## Installation

See [docs/INSTALL.md](docs/INSTALL.md): the C64 Chain node and wallet (build from source), the RandomX helper, Redis, the pool services (systemd
templates in `deployment/`), the website and the first payout rehearsal.

Requirements: Linux, Node.js 18 or newer, Redis, a C64 Chain node (`c64chaind-mainnet` v1.1.1 or newer) synchronised with the network and `c64chain-wallet-rpc-mainnet`
with the pool wallet, a C++ compiler and the node's RandomX library for the helper, a web server for the website and a TLS certificate for the TLS stratum ports.

## Miners

[poolpayminer](https://github.com/newsmoneymaker/poolpayminer) (Windows and Linux, free, has its own fee) knows the algorithm `rx/c64`.
Example: `poolpayminer -a rx/c64 --tls -o c64.pool-pay.com:6667 -u WoYourAddress+rigname -p x -k`.

## Tests

```
npm install
node test/test-account.js                 # address handling, needs nothing else
make -C hasher RANDOMX=/path/to/rx-prefix
node test/test-real-blocks.js             # the hash of real mainnet blocks, needs only the helper
# The others use test/config.test.json and a THROWAWAY Redis on port 16379 (they flush it, never point them at a real database):
redis-server --port 16379 --requirepass CHANGE_ME_REDIS_PASSWORD --save "" --appendonly no &
node test/test-c64-pool.js                # simulated node + pool + a miner that really mines
node test/test-c64-payments.js            # unlocker and payments against a simulated node and wallet
node test/test-c64-vesting.js             # the vesting schedule of the unlocker
node test/test-c64-vardiff.js             # variable difficulty and its memory across reconnects
```

## Money warning

The payment processor moves real coins. Rehearse first: `"dryRun": true`, then a whitelist (`onlyAccounts`) with a few small payouts of your own,
then enable it. A transaction that has been sent to the network can not be cancelled. Keep the wallet backup (the 25 word seed) and the wallet password private.

## License and credits

GNU GPL v2 (see [LICENSE](LICENSE)). Based on cryptonote-nodejs-pool, Copyright (c) Dvandal and contributors. C64 Chain and RandomX are separate programs and are
not included.
