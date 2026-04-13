const { streamDeck, SingletonAction } = require("@elgato/streamdeck");
const https = require("https");

const UPDATE_MS = 5 * 60 * 1000; // 5 min

function fetch(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "sd-btc-candle/1.0" } }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        if (res.statusCode >= 400) return reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        resolve(body);
      });
    }).on("error", reject);
  });
}

async function getOhlc() {
  // CoinGecko free API: 7 days of OHLC data (returns ~56 candles, 3h each)
  const url = "https://api.coingecko.com/api/v3/coins/bitcoin/ohlc?vs_currency=gbp&days=7";
  const raw = JSON.parse(await fetch(url));
  // Each entry: [timestamp, open, high, low, close]
  return raw;
}

async function getCurrentPrice() {
  const url = "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=gbp";
  const raw = JSON.parse(await fetch(url));
  return raw.bitcoin.gbp;
}

// Group 3h candles into daily candles
function toDailyCandles(ohlc) {
  const days = {};
  for (const [ts, o, h, l, c] of ohlc) {
    const day = new Date(ts).toISOString().slice(0, 10);
    if (!days[day]) {
      days[day] = { open: o, high: h, low: l, close: c };
    } else {
      days[day].high = Math.max(days[day].high, h);
      days[day].low = Math.min(days[day].low, l);
      days[day].close = c;
    }
  }
  return Object.values(days).slice(-7);
}

function formatPrice(p) {
  return (p / 1000).toFixed(1) + "k";
}

function buildSvg(candles, price) {
  const W = 144;
  const H = 144;
  const padTop = 26;
  const padBot = 8;
  const padLR = 8;

  if (!candles || candles.length === 0) {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
      <rect width="${W}" height="${H}" fill="#000" rx="12"/>
      <text x="${W / 2}" y="${H / 2}" text-anchor="middle" dominant-baseline="central"
            font-family="Arial,sans-serif" font-size="14" fill="#888">Loading...</text>
    </svg>`;
  }

  const allHigh = Math.max(...candles.map((c) => c.high));
  const allLow = Math.min(...candles.map((c) => c.low));
  const range = allHigh - allLow || 1;

  const chartH = H - padTop - padBot;
  const chartW = W - padLR * 2;
  const candleW = chartW / candles.length;
  const bodyW = candleW * 0.6;
  const wickW = 2;

  const yScale = (v) => padTop + chartH - ((v - allLow) / range) * chartH;

  // Price change colour
  const priceColor = candles.length >= 2 && candles[candles.length - 1].close >= candles[0].open ? "#2ed573" : "#ff4757";

  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#000" rx="12"/>`;

  // Price text at top - full width
  svg += `<text x="${W / 2}" y="16" text-anchor="middle" dominant-baseline="central"
    font-family="Arial,sans-serif" font-size="22" font-weight="bold" fill="${priceColor}">${formatPrice(price)}</text>`;

  // Candles
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const cx = padLR + candleW * i + candleW / 2;
    const isGreen = c.close >= c.open;
    const color = isGreen ? "#2ed573" : "#ff4757";

    // Wick (high to low)
    const wickTop = yScale(c.high);
    const wickBot = yScale(c.low);
    svg += `<rect x="${cx - wickW / 2}" y="${wickTop}" width="${wickW}" height="${Math.max(wickBot - wickTop, 1)}" fill="${color}"/>`;

    // Body (open to close)
    const bodyTop = yScale(Math.max(c.open, c.close));
    const bodyBot = yScale(Math.min(c.open, c.close));
    svg += `<rect x="${cx - bodyW / 2}" y="${bodyTop}" width="${bodyW}" height="${Math.max(bodyBot - bodyTop, 2)}" fill="${color}" rx="1"/>`;
  }

  svg += `</svg>`;
  return svg;
}

function svgToBase64(svg) {
  return "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
}

const intervals = new Map();

async function updateKey(action) {
  try {
    const [ohlc, price] = await Promise.all([getOhlc(), getCurrentPrice()]);
    const candles = toDailyCandles(ohlc);
    const svg = buildSvg(candles, price);
    action.setImage(svgToBase64(svg));
  } catch (e) {
    // Show error state
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144">
      <rect width="144" height="144" fill="#000" rx="12"/>
      <text x="72" y="65" text-anchor="middle" font-family="Arial,sans-serif" font-size="12" fill="#ff4757">BTC/GBP</text>
      <text x="72" y="82" text-anchor="middle" font-family="Arial,sans-serif" font-size="11" fill="#888">Retry...</text>
    </svg>`;
    action.setImage(svgToBase64(svg));
  }
}

class BtcCandleAction extends SingletonAction {
  constructor() {
    super();
    this.manifestId = "com.jkkec.btc-candle.chart";
  }

  onWillAppear(ev) {
    updateKey(ev.action);
    const iv = setInterval(() => updateKey(ev.action), UPDATE_MS);
    intervals.set(ev.action.id, iv);
  }

  onWillDisappear(ev) {
    const iv = intervals.get(ev.action.id);
    if (iv) clearInterval(iv);
    intervals.delete(ev.action.id);
  }

  onKeyDown(ev) {
    updateKey(ev.action);
  }
}

streamDeck.actions.registerAction(new BtcCandleAction());
streamDeck.connect();
