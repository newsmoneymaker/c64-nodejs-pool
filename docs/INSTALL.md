# Installing a C64 Chain pool

Paths below are examples: the pool in `/opt/c64-nodejs-pool`, the node and wallet in `/opt/c64`, all run by the user `c64pool`
(the systemd templates in `deployment/systemd/` use these paths).

## 1. C64 Chain node and wallet

The C64 Chain source is published on the project site (<https://c64chain.com/downloads>, `c64chain-mainnet-main.zip`); the project's GitHub repositories are gone,
so keep a copy of the archive you built from. Build from source:

```
unzip c64chain-mainnet-main.zip && cd c64chain-mainnet-main
# Debian/Ubuntu: build-essential cmake pkg-config git python3 libboost-all-dev libssl-dev libzmq3-dev libpgm-dev libunbound-dev libsodium-dev libhidapi-dev
#   libusb-1.0-0-dev libunwind-dev liblzma-dev libreadline-dev libexpat1-dev libprotobuf-dev protobuf-compiler libudev-dev libncurses5-dev libncursesw5-dev liblmdb-dev libminiupnpc-dev libuv1-dev
mkdir build && cd build && cmake -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTS=OFF -DUSE_DEVICE_TREZOR=OFF ..
make -j4 daemon simplewallet wallet_rpc_server        # binaries in build/bin: c64chaind-mainnet, c64wallet-mainnet, c64chain-wallet-rpc-mainnet
```

Run the node (`deployment/systemd/c64-node.service`): `c64chaind-mainnet --data-dir /opt/c64/data --non-interactive --rpc-bind-ip 127.0.0.1 --rpc-bind-port 19641 --p2p-bind-port 19640 --no-zmq`.
It finds its peers by itself (built-in seed nodes); a synchronisation from the genesis block takes about an hour (no snapshot is published). While it synchronises,
`get_last_block_header` answers with zeros: watch `get_info` (`curl -s 127.0.0.1:19641/json_rpc -d '{"jsonrpc":"2.0","id":"0","method":"get_info"}'`, `height` against `target_height`).
Open the P2P port 19640 in your firewall if you want incoming peers.

Create the pool wallet (the 25 words are printed once: **write them down and keep them offline**, do not let the output land in a log):

```
c64wallet-mainnet --generate-new-wallet /opt/c64/wallet/pool --password-file /opt/c64/wallet/password --daemon-address 127.0.0.1:19641
```

Then run the wallet RPC (`deployment/systemd/c64-wallet-rpc.service`): `c64chain-wallet-rpc-mainnet --wallet-file /opt/c64/wallet/pool --password-file /opt/c64/wallet/password
--rpc-bind-ip 127.0.0.1 --rpc-bind-port 19643 --disable-rpc-login --daemon-address 127.0.0.1:19641 --trusted-daemon`. It listens on the local machine only and pays
without a password: keep only the coins that are about to be paid out in this wallet. The wallet's main address (`Wo...`) is the pool address (`poolServer.poolAddress`):
every block template pays its coinbase there.

## 2. RandomX helper

The helper must use the same RandomX as the node: use the RandomX library the node build made (`librandomx.a` in its `build/external/` tree, the header `randomx.h` in the matching directory of the node's `external/` tree).

```
mkdir -p /opt/randomx/include /opt/randomx/lib
cp /path/to/randomx.h /opt/randomx/include && cp /path/to/librandomx.a /opt/randomx/lib
cd /opt/c64-nodejs-pool/hasher && make RANDOMX=/opt/randomx
```

The helper needs about 2.3 GB of RAM (RandomX dataset, fast mode; `"hasher": {"light": true}` uses 256 MB and is much slower). Check it against the chain:
`node test/test-real-blocks.js`.

## 3. Redis

Use a dedicated instance with a password and AOF (`deployment/redis-pool.conf.example`, unit `c64-pool-redis`, port 6383).

## 4. The pool

```
cd /opt/c64-nodejs-pool && npm install --production
cp config_examples/c64.json config.json      # then edit it
```

Edit `config.json`: `poolHost`, `poolServer.poolAddress`, the ports and the certificate for TLS (`poolServer.sslCert/sslKey`), `redis`, `api.password`,
`blockUnlocker.poolFee` and `donations`, `payments`. **Keep `payments.dryRun: true` until the rehearsal below.**

```
cp deployment/systemd/*.service /etc/systemd/system/ && systemctl daemon-reload
systemctl enable --now c64-pool-redis c64-node c64-wallet-rpc
systemctl enable --now c64-pool c64-pool-api c64-pool-unlocker c64-pool-payments c64-pool-charts
```

The pool runs as separate modules (`init.js -module=pool|api|unlocker|payments|chartsDataCollector`), each in its own unit. The pool module keeps one hasher process
(and its RandomX dataset), so run it as one process. Until payouts are proven, restrict the stratum ports with `poolServer.allowIPs`.

## 5. Website

Copy `website_example/` to the web root, set `poolHost`, the contact and links in `config.js`, and proxy `/api` to the pool API on 127.0.0.1:8121
(`deployment/apache-vhost.conf.example` exposes only the read-only methods).

## 6. Rehearse the payments

1. `payments.dryRun: true`: the log of `c64-pool-payments` shows what would be paid.
2. Fund the pool wallet with a few coins (or wait for the first block), credit a small balance in Redis to your own test addresses
   (`<coin>:workers:<address>`, field `balance`), set `payments.onlyAccounts` to them, `dryRun: false`, and watch the payout confirm.
3. Remove the test accounts from Redis and set `onlyAccounts` to `[]`.

Good to know: C64 block rewards are vested (the wallet can spend a quarter after 288 blocks, the rest after 30, 60 and 90 days): keep `blockUnlocker.vesting` enabled, it makes the unlocker credit the miners only what the wallet can spend; `deployment/pause-payments.sh` stops new payouts
at once; a wallet cannot abandon a transaction, so a payout that stays unconfirmed for `pendingTimeoutHours` is only reported in the log and must be checked by hand.
