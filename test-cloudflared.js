const { bin, tunnel } = require('cloudflared');

async function test() {
  console.log("Binary path:", bin);
  const t = tunnel({ "--url": "localhost:3000" });
  console.log("Tunnel:", t);
  const url = await t.url;
  console.log("URL:", url);
  t.stop();
}
test().catch(console.error);