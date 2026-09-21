/* C64 Chain pool website settings */

// Coin name shown next to the pool name (must equal the "symbol" of the pool config)
var parentCoin = "C64";

// Pool API: proxied by the web server from /api to the pool's API on 127.0.0.1
var api = "/api";

// Pool host name shown on the "Getting started" page
var poolHost = "c64.pool-pay.com";

// A notice shown above every page (empty = none)
var poolNotice = {en: "", ru: ""};

// Contact / community links (leave empty to hide)
var email = "";
var telegram = "";
var discord = "";
var github = "";
var minerDownload = "/downloads/";      // poolpayminer (optional menu item; leave empty to hide)

// No exchange data source for C64 Chain here, market widgets are hidden
var marketCurrencies = [];

// Block explorer links ({id} = block hash or height / transaction id)
var blockchainExplorer = "https://c64chain.com/block/{id}";
// the explorer opens a block by its hash; "height" is the default
var blockExplorerId = "hash";
var transactionExplorer = "https://c64chain.com/tx/{id}";

// Theme and default language ("en" or "ru")
var themeCss = "themes/default.css";
var defaultLang = "en";
