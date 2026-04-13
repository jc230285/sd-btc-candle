const esbuild = require("esbuild");
esbuild.buildSync({
  entryPoints: ["src/plugin.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  outfile: "com.jkkec.btc-candle.sdPlugin/bin/plugin.js",
  format: "cjs",
  external: ["@elgato/streamdeck"],
});
console.log("Built.");
