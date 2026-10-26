import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";

const origin = "https://andromedabmstu.ru";
const keyFile = (await readdir("public")).find(name => /^[a-f0-9]{32}\.txt$/.test(name));
assert.ok(keyFile, "Missing public IndexNow key file");
const key = (await readFile(`public/${keyFile}`, "utf8")).trim();
assert.equal(keyFile, key + ".txt");
const keyResponse = await fetch(`${origin}/${keyFile}`);
assert.equal(keyResponse.status, 200, "Deploy the ownership key before submitting URLs");
assert.equal((await keyResponse.text()).trim(), key);
const sitemap = await (await fetch(origin + "/sitemap.xml")).text();
const urlList = process.argv.includes("--home-only") ? [origin + "/"] : [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
assert.ok(urlList.length > 0);
assert.ok(urlList.every(url => new URL(url).origin === origin));
const response = await fetch("https://yandex.com/indexnow", {
  method: "POST",
  headers: { "Content-Type": "application/json; charset=utf-8" },
  body: JSON.stringify({ host: new URL(origin).hostname, key, keyLocation: `${origin}/${keyFile}`, urlList }),
});
console.log(JSON.stringify({ engine: "Yandex IndexNow", status: response.status, urls: urlList, response: await response.text() }));
assert.ok([200, 202].includes(response.status), "IndexNow submission failed");
