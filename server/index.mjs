import http from "node:http";
import {readFile,stat} from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import crypto from "node:crypto";
import {normalizeCollection,expired,isDynamic} from "../src/data.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = Number(process.env.PORT || 4173);
const TOKEN = process.env.INGEST_TOKEN || "";
const ALLOWED_ORIGIN = (process.env.ALLOWED_ORIGIN || "").replace(/\/$/,"");
const MAX_BODY = 1_500_000;
const store = new Map();
const clients = new Set();
let revision = 0;
const types = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",".json":"application/json; charset=utf-8",".geojson":"application/geo+json; charset=utf-8",".svg":"image/svg+xml"};
function cors(req,res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGIN && origin === ALLOWED_ORIGIN) {
    res.setHeader("Access-Control-Allow-Origin",origin);
    res.setHeader("Vary","Origin");
    res.setHeader("Access-Control-Allow-Methods","GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers","Authorization, Content-Type");
  }
}
function json(res,status,body) {
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"});
  res.end(JSON.stringify(body));
}
function authorized(header) {
  if (TOKEN.length < 24 || !header?.startsWith("Bearer ")) return false;
  const supplied = Buffer.from(header.slice(7)), expected = Buffer.from(TOKEN);
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied,expected);
}
function snapshot() {
  for (const [key,feature] of store) if (expired(feature)) store.delete(key);
  return {type:"FeatureCollection",features:[...store.values()]};
}
function broadcast(event,data) {
  const msg = "id: "+ revision +"\nevent: "+event+"\ndata: "+JSON.stringify(data)+"\n\n";
  for (const client of clients) {try {client.write(msg);} catch {clients.delete(client);}}
}
async function requestBody(req) {
  let size=0; const parts=[];
  for await (const chunk of req) {
    size+=chunk.length;
    if(size>MAX_BODY) {const error=new Error("Payload exceeds 1.5MB");error.status=413;throw error;}
    parts.push(chunk);
  }
  return JSON.parse(Buffer.concat(parts).toString("utf8"));
}
async function serveStatic(req,res,pathname) {
  let decoded;
  try {decoded=decodeURIComponent(pathname);} catch {return json(res,400,{error:"Invalid URL"});}
  if (decoded.includes("\0") || decoded.split("/").some(s=>s.startsWith("." ) && s !== "." && s !== ".."))
    return json(res,403,{error:"Forbidden"});
  const destination = path.resolve(ROOT,"."+(decoded === "/"?"/index.html":decoded));
  if (!destination.startsWith(ROOT+path.sep)) return json(res,403,{error:"Forbidden"});
  try {
    const meta=await stat(destination);
    if (!meta.isFile()) return json(res,404,{error:"Not found"});
    const body=await readFile(destination);
    res.writeHead(200,{"Content-Type":types[path.extname(destination)] || "application/octet-stream","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
    res.end(body);
  } catch {json(res,404,{error:"Not found"});}
}
const server=http.createServer(async (req,res)=>{
  cors(req,res);
  if(req.method==="OPTIONS") {res.writeHead(ALLOWED_ORIGIN?204:403);return res.end();}
  let pathname;
  try {pathname=new URL(req.url,"http://localhost").pathname;} catch {return json(res,400,{error:"Malformed request"});}
  if(req.method==="GET" && pathname==="/api/health")
    return json(res,200,{ok:true,service:"giaothong-webgis",mode:"ingest-only",features:snapshot().features.length,connections:clients.size});
  if(req.method==="GET" && pathname==="/api/feed")
    return json(res,200,snapshot());
  if(req.method==="GET" && pathname==="/api/events") {
    res.writeHead(200,{"Content-Type":"text/event-stream; charset=utf-8","Cache-Control":"no-cache, no-transform","Connection":"keep-alive","X-Accel-Buffering":"no"});
    res.write("retry: 4000\n\n");
    res.write("event: snapshot\ndata: "+JSON.stringify(snapshot())+"\n\n");
    clients.add(res);
    const heartbeat=setInterval(()=>{try{res.write(": heartbeat\n\n");}catch{clients.delete(res);}},25000);
    req.on("close",()=>{clients.delete(res);clearInterval(heartbeat);});
    return;
  }
  if(req.method==="POST" && pathname==="/api/ingest") {
    if(!authorized(req.headers.authorization)) return json(res,401,{error:"Token missing, short or invalid"});
    const mime=(req.headers["content-type"] || "").split(";")[0].trim();
    if(mime!=="application/json" && mime!=="application/geo+json") return json(res,415,{error:"JSON required"});
    try {
      const data=normalizeCollection(await requestBody(req),"Nguồn API",250);
      const now=Date.now();
      for (const f of data.features) {
        const p=f.properties;
        // No event should stay "live" indefinitely without timestamp/TTL.
        if(isDynamic(p.layer) && !p.expires_at) {
          const ttl=p.layer==="signal"?60000:p.layer==="traffic"?300000:p.layer==="closure"||p.layer==="roadworks"?7200000:1200000;
          p.expires_at=new Date(now+ttl).toISOString();
        }
        store.set(String(f.id),f);
      }
      revision++;
      broadcast("upsert",data);
      return json(res,202,{accepted:data.features.length,revision,total:snapshot().features.length});
    } catch(error) {return json(res,error.status || 400,{error:error.message || "Malformed payload"});}
  }
  if(pathname.startsWith("/api/")) return json(res,404,{error:"Endpoint not found"});
  if(req.method!=="GET" && req.method!=="HEAD") return json(res,405,{error:"Method not allowed"});
  return serveStatic(req,res,pathname);
});
server.listen(PORT,()=>console.log("Giao thông WebGIS http://localhost:"+PORT+" (ingest "+(TOKEN.length>=24?"enabled":"disabled")+")"));
const stop=()=>server.close(()=>process.exit(0));
process.on("SIGINT",stop);
process.on("SIGTERM",stop);
