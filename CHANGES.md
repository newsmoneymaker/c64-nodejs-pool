# Changes

## 1.0.0

* First release: C64 Chain (Monero based) pool derived from qwc-nodejs-pool, veil-nodejs-pool and epic-nodejs-pool. Stratum for `rx/c64`,
  share checking with the RandomX helper `hasher/rxhash` built with the node's own RandomX library, `get_block_template` / `submit_block`, Monero style addresses (prefix 4146, 97 characters),
  wallet payouts with `transfer`.
* **Reward vesting** (`blockUnlocker.vesting`): C64 pays a block reward to the pool wallet in 4 outputs that unlock after 288 / 8640 / 17280 / 25920 blocks. The unlocker credits the
  first part of each account's share and the other three when they unlock; `stats_address` shows the locked sum as `vesting`, the miner page shows it as "Locked (vesting)".
* The variable difficulty of a worker is remembered across reconnects (`poolServer.diffMemoryMinutes`, default 15).
* Tested against real mainnet blocks (`test/test-real-blocks.js`) and a simulated node and wallet (`test-c64-pool.js`, `test-c64-payments.js`, `test-c64-vesting.js`, `test-c64-vardiff.js`).
* Not yet checked on a block found by the pool itself: the wallet's answer for the vested coinbase (`get_transfer_by_txid` amount without the dev fund output) and a real payout
  with `subtract_fee_from_outputs`.
