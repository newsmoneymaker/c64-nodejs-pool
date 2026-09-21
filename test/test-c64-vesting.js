// Vesting of the block reward (C64 Chain): the coinbase pays the pool wallet in 4 parts that unlock at different heights; the unlocker
// credits the first part at once and the others when their height is reached. Needs the throwaway redis of test/config.test.json (flushed!).
// Run: node test/test-c64-vesting.js
const {spawn} = require('child_process');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const redis = require(path.join(__dirname, '../node_modules/redis'));
const {makeAddress} = require('./testaddr.js');
const base = JSON.parse(fs.readFileSync(path.join(__dirname, 'config.test.json'), 'utf8'));

const PORT = 25558;
const A1 = makeAddress(31), A2 = makeAddress(32), DEV = makeAddress(33);
let failed = 0;
const check = (name, ok, extra) => { console.log((ok ? 'PASS  ' : 'FAIL  ') + name + (extra !== undefined ? '  ' + extra : '')); if (!ok) failed++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---- mock node + wallet
const M = {tip: 1000, coinbase: {}};
http.createServer((req, res) => {
	let b = ''; req.on('data', d => b += d);
	req.on('end', () => {
		const m = JSON.parse(b), p = m.params || {};
		const reply = r => { res.writeHead(200); res.end(JSON.stringify({jsonrpc: '2.0', id: m.id, result: r})); };
		const fail = (code, message) => { res.writeHead(200); res.end(JSON.stringify({jsonrpc: '2.0', id: m.id, error: {code, message}})); };
		if (m.method === 'get_last_block_header') return reply({block_header: {height: M.tip, hash: 'h' + M.tip}, status: 'OK'});
		if (m.method === 'get_block_header_by_height') return reply({block_header: {height: p.height, hash: 'h' + p.height, orphan_status: false, miner_tx_hash: 'cb' + p.height}, status: 'OK'});
		if (m.method === 'get_transfer_by_txid') return M.coinbase[p.txid] === undefined ? fail(-8, 'Transaction not found.') : reply({transfer: {txid: p.txid, type: 'block', amount: M.coinbase[p.txid], confirmations: 100}});
		fail(-32601, 'Method not found');
	});
}).listen(PORT, '127.0.0.1');

const R = redis.createClient(base.redis.port, base.redis.host, {auth_pass: base.redis.auth, db: base.redis.db || 0});
const rc = (cmd, ...a) => new Promise((res, rej) => R[cmd](...a, (e, v) => e ? rej(e) : res(v)));
const key = (...a) => ['C64Chain'].concat(a).join(':');
const bal = async acc => parseInt((await rc('hget', key('workers', acc), 'balance')) || 0);
const vest = async acc => parseInt((await rc('hget', key('workers', acc), 'vesting')) || 0);

let unlocker;
function startUnlocker (vestingOn) {
	const cfg = JSON.parse(JSON.stringify(base));
	cfg.node = {host: '127.0.0.1', port: PORT};
	cfg.wallet = {host: '127.0.0.1', port: PORT};
	cfg.poolServer.slushMining = {enabled: false};
	cfg.blockUnlocker = {enabled: true, interval: 1, depth: 3, poolFee: 1, donations: {[DEV]: 0.5}, vesting: {enabled: vestingOn, unlockBlocks: [2, 5, 8, 12], margin: 1}};
	const file = path.join(os.tmpdir(), 'c64-test-vesting.json');
	fs.writeFileSync(file, JSON.stringify(cfg));
	unlocker = spawn('node', [path.join(__dirname, '..', 'init.js'), '-config=' + file, '-module=unlocker'], {cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'pipe']});
	unlocker.log = ''; unlocker.stdout.on('data', d => unlocker.log += d); unlocker.stderr.on('data', d => unlocker.log += d);
}
process.on('exit', () => { try { unlocker.kill(); } catch (e) {} });

(async () => {
	await rc('flushdb');
	// block 996 (found by A1): reward 1000000000003 atoms (10 C64 and a remainder), A1 has score 3, A2 score 1; block 997 is orphaned
	const REWARD = 1000000000003;
	M.coinbase.cb996 = REWARD;
	await rc('zadd', key('blocks', 'candidates'), 996, ['prop', A1, 'h996', 111, 1e9, 4, 4].join(':'));
	await rc('zadd', key('blocks', 'candidates'), 997, ['prop', A1, 'OTHER', 111, 1e9, 4, 4].join(':'));
	await rc('hset', key('scores', 'prop', 'round996'), A1, 3); await rc('hset', key('scores', 'prop', 'round996'), A2, 1);
	await rc('hset', key('scores', 'prop', 'round997'), A1, 1);

	// what the credits are without vesting (the same formulas as the unlocker)
	const distributable = REWARD, feePercent = 0.01, donationPercent = 0.5;
	const minersPool = Math.floor(distributable - distributable * (feePercent + donationPercent / 100));
	const want = {[DEV]: Math.floor(distributable * donationPercent / 100), [A1]: Math.floor(minersPool * (3 / 4)), [A2]: Math.floor(minersPool * (1 / 4))};
	const quarter = Math.floor(REWARD / 4), parts = [quarter + (REWARD - quarter * 4), quarter, quarter, quarter];
	const split = amount => { const o = []; let rest = amount; for (let i = 3; i >= 1; i--) { o[i] = Math.floor(amount * parts[i] / REWARD); rest -= o[i]; } o[0] = rest; return o; };

	startUnlocker(true);
	await sleep(4000);
	const s1 = split(want[A1]);
	check('first part of A1 is credited at once', (await bal(A1)) === s1[0], (await bal(A1)) + ' expected ' + s1[0]);
	check('the other three parts of A1 wait (vesting field)', (await vest(A1)) === s1[1] + s1[2] + s1[3], (await vest(A1)) + ' expected ' + (s1[1] + s1[2] + s1[3]));
	check('A2 and the developer are cut the same way', (await bal(A2)) === split(want[A2])[0] && (await bal(DEV)) === split(want[DEV])[0]);
	const due = await rc('zrange', key('vesting', 'due'), 0, -1, 'WITHSCORES');
	check('three parts are scheduled at unlock height + margin', JSON.stringify(due) === JSON.stringify(['996:1', '1002', '996:2', '1005', '996:3', '1009']), JSON.stringify(due));
	check('the orphan is not vested', (await rc('zcard', key('blocks', 'candidates'))) === 0 && (await rc('exists', key('vesting', '997', '1'))) === 0);
	check('nothing is released before its height', (await bal(A1)) === s1[0]);

	M.tip = 1003;                                       // part 1 (996 + 5 + 1 = 1002) is due
	await sleep(3000);
	check('part 1 is credited when its height is reached', (await bal(A1)) === s1[0] + s1[1] && (await vest(A1)) === s1[2] + s1[3], (await bal(A1)) + '/' + (await vest(A1)));
	check('two parts still wait', (await rc('zcard', key('vesting', 'due'))) === 2);

	M.tip = 1010;                                       // everything is due
	await sleep(3000);
	check('all parts are credited in the end: A1 gets exactly its share', (await bal(A1)) === want[A1] && (await vest(A1)) === 0, (await bal(A1)) + ' expected ' + want[A1]);
	check('A2 and the developer as well', (await bal(A2)) === want[A2] && (await bal(DEV)) === want[DEV] && (await vest(A2)) === 0);
	check('nothing is left in the vesting lists', (await rc('zcard', key('vesting', 'due'))) === 0 && (await rc('exists', key('vesting', '996', '1'))) === 0);
	await sleep(2500);
	check('a further cycle does not credit anything twice', (await bal(A1)) === want[A1]);
	check('the log tells about the released parts', /Vesting: \d part\(s\) unlocked/.test(unlocker.log));
	unlocker.kill(); await sleep(500);

	// without vesting everything is credited at once (other coins)
	await rc('flushdb');
	M.tip = 1000;
	await rc('zadd', key('blocks', 'candidates'), 996, ['prop', A1, 'h996', 111, 1e9, 4, 4].join(':'));
	await rc('hset', key('scores', 'prop', 'round996'), A1, 3); await rc('hset', key('scores', 'prop', 'round996'), A2, 1);
	startUnlocker(false);
	await sleep(3500);
	check('vesting off: the whole share is credited at once', (await bal(A1)) === want[A1] && (await vest(A1)) === 0 && (await rc('zcard', key('vesting', 'due'))) === 0);
	unlocker.kill();

	console.log(failed ? '\n' + failed + ' CHECK(S) FAILED\n' + unlocker.log.slice(-1200) : '\nALL CHECKS PASSED');
	process.exit(failed ? 1 : 0);
})().catch(e => { console.error('test crashed:', e); process.exit(2); });
