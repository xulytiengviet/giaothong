import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {spawn} from "node:child_process";
import {normalizeCollection,normalizeFeature,expired,staleness} from "../src/data.js";

test("sample GeoJSON has valid schema and explicitly simulated sources",async()=>{
  const raw=JSON.parse(await readFile(new URL("../data/demo.geojson",import.meta.url),"utf8"));
  const fc=normalizeCollection(raw,"Sample");
  assert.equal(fc.features.length,6);
  assert.ok(fc.features.every(f=>f.properties.is_demo===true));
  assert.ok(fc.features.some(f=>f.properties.layer==="signal"&&f.properties.state==="unknown"));
});
test("reject invalid CRS/order-independent bounds and unknown layer",()=>{
  assert.throws(()=>normalizeFeature({type:"Feature",geometry:{type:"Point",coordinates:[120,100]},properties:{layer:"sign"}}),/tọa độ/);
  assert.throws(()=>normalizeFeature({type:"Feature",geometry:{type:"Point",coordinates:[106.7,10.7]},properties:{layer:"unknown"}}),/layer/);
  assert.throws(()=>normalizeCollection({type:"FeatureCollection",features:Array(251).fill({type:"Feature",geometry:{type:"Point",coordinates:[106,10]},properties:{layer:"signal"}})},"test",250),/Vượt/);
});
test("expiring alerts and signal staleness",()=>{
  const base={type:"Feature",geometry:{type:"Point",coordinates:[106.7,10.7]},properties:{layer:"signal",updated_at:"2026-09-24T00:00:00.000Z",expires_at:"2026-09-24T00:01:00.000Z"}};
  const f=normalizeFeature(base);
  assert.equal(expired(f,Date.parse("2026-09-24T00:02:00Z")),true);
  assert.equal(staleness(f,Date.parse("2026-09-24T01:00:00Z")),"stale");
  assert.equal(f.properties.state,"unknown");
});
test("Node gateway health, auth, ingest, feed, SSE, static assets",async t=>{
  const port=44000+Math.floor(Math.random()*999);
  const token="test-strong-credential-do-not-use-12345678";
  const child=spawn(process.execPath,["server/index.mjs"],{cwd:new URL("..",import.meta.url).pathname,env:{...process.env,PORT:String(port),INGEST_TOKEN:token,ALLOWED_ORIGIN:"https://xulytiengviet.github.io"},stdio:["ignore","pipe","pipe"]});
  let logs="";child.stdout.on("data",b=>logs+=b.toString());child.stderr.on("data",b=>logs+=b.toString());
  t.after(()=>child.kill("SIGTERM"));
  const base="http://127.0.0.1:"+port;
  let response;
  for(let i=0;i<50;i++){
    try{response=await fetch(base+"/api/health");if(response.ok)break;}catch{}
    await new Promise(r=>setTimeout(r,70));
  }
  assert.ok(response?.ok,"server did not start: "+logs);
  const h=await response.json();assert.equal(h.ok,true);
  assert.equal((await fetch(base+"/index.html")).status,200);
  assert.equal((await fetch(base+"/src/main.js")).status,200);
  assert.equal((await fetch(base+"/.env.example")).status,403);
  assert.equal((await fetch(base+"/api/ingest",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})).status,401);
  const data={type:"FeatureCollection",features:[{type:"Feature",id:"live-1",geometry:{type:"Point",coordinates:[106.7,10.7]},properties:{name:"Test ingest",layer:"warning",source:"Test suite",updated_at:new Date().toISOString()}}]};
  const push=await fetch(base+"/api/ingest",{method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json","Origin":"https://xulytiengviet.github.io"},body:JSON.stringify(data)});
  assert.equal(push.status,202,await push.text().catch(()=>""));
  assert.equal(push.headers.get("access-control-allow-origin"),"https://xulytiengviet.github.io");
  const feed=await(await fetch(base+"/api/feed")).json();
  assert.equal(feed.features.length,1);
  assert.ok(feed.features[0].properties.expires_at,"Dynamic warning needs default expiration");
  const streamAbort=new AbortController();
  const stream=await fetch(base+"/api/events",{signal:streamAbort.signal});
  assert.equal(stream.status,200);
  const reader=stream.body.getReader();
  const first=await Promise.race([reader.read(),new Promise((_,rej)=>setTimeout(()=>rej(new Error("SSE timeout")),2000))]);
  assert.ok(new TextDecoder().decode(first.value).includes("snapshot"));
  streamAbort.abort();reader.cancel().catch(()=>{});
});
