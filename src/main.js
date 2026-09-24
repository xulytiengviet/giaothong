import * as maplibregl from "https://unpkg.com/maplibre-gl@6.11.1/dist/maplibre-gl.mjs";
import {CONFIG,LAYERS,layerMeta} from "./config.js";
import {normalizeCollection,emptyCollection,expired,staleness,displayDistance} from "./data.js";

const $ = id => document.getElementById(id);
const sources = {demo:new Map(),osm:new Map(),import:new Map(),live:new Map()};
const active = new Set(LAYERS.map(layer=>layer.id));
const layerIds = [];
let map, demoVisible=true, chooser=null, origin=null, destination=null, originMarker, destinationMarker;
let eventSource=null, routeController=null, toastTimer=null, connectedApi="";
const emptyText="Không có dữ liệu trong khung nhìn. Chọn lớp, nhập GeoJSON hoặc nạp OSM.";
const modes = {start:"Điểm đầu",end:"Điểm đến"};
const timestamp = () => new Date().toLocaleString("vi-VN",{hour12:false});
function notice(message) {
  $("toast").textContent=message;
  $("toast").classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>$("toast").classList.remove("show"),4500);
}
function status(message) {$("map-status").textContent=message;}
function setBadge(state,text) {
  $("live-badge").className="badge "+(state==="connected"?"badge-on":state==="error"?"badge-err":"badge-idle");
  $("live-badge").textContent=text;
}
function storeFeatures(namespace,payload,replace=false) {
  const normalized=normalizeCollection(payload,namespace==="osm"?"OpenStreetMap":namespace==="live"?"API đã kết nối":namespace==="demo"?"Dữ liệu giả lập":"GeoJSON người dùng");
  if (replace) sources[namespace].clear();
  for (const f of normalized.features) sources[namespace].set(String(f.id),f);
  paint();
  return normalized.features.length;
}
function visibleFeatures() {
  const now=Date.now(), output=[];
  for (const [namespace,features] of Object.entries(sources)) {
    if(namespace==="demo" && !demoVisible) continue;
    for(const feature of features.values()) {
      if(!expired(feature,now) && active.has(feature.properties.layer)) output.push(feature);
    }
  }
  return output;
}
function paint() {
  const collection={type:"FeatureCollection",features:visibleFeatures()};
  if(map?.getSource("traffic-data")) {
    map.getSource("traffic-data").setData(collection);
    for (const l of LAYERS) for(const shape of ["points","lines","areas"]) {
      const id=l.id+"-"+shape;
      if(map.getLayer(id)) map.setLayoutProperty(id,"visibility",active.has(l.id)?"visible":"none");
    }
  }
  const count = layer => collection.features.filter(f=>f.properties.layer===layer).length;
  $("count-total").textContent=collection.features.length;
  $("count-warnings").textContent=count("warning")+count("flood")+count("closure");
  $("count-signals").textContent=count("signal");
  $("count-signs").textContent=count("sign");
  document.querySelectorAll("[data-count]").forEach(el=>el.textContent=count(el.dataset.count));
  const real=[...sources.live.values()].some(f=>!f.properties.is_demo&&!expired(f));
  const osmCount=[...sources.osm.values()].filter(f=>!expired(f)).length;
  const chip=$("mode-chip");
  chip.className="chip "+(real?"live":"demo");
  chip.textContent=real?"CÓ DỮ LIỆU API":osmCount?"OSM + DỮ LIỆU KHÁC":demoVisible?"DỮ LIỆU MẪU":"CHƯA CÓ FEED";
}
function createLayers() {
  map.addSource("traffic-data",{type:"geojson",data:emptyCollection(),generateId:false});
  for(const l of LAYERS) {
    map.addLayer({id:l.id+"-areas",type:"fill",source:"traffic-data",filter:["all",["==",["get","layer"],l.id],["==",["geometry-type"],"Polygon"]],paint:{"fill-color":l.color,"fill-opacity":.22,"fill-outline-color":l.color}});
    map.addLayer({id:l.id+"-lines",type:"line",source:"traffic-data",filter:["all",["==",["get","layer"],l.id],["==",["geometry-type"],"LineString"]],paint:{"line-color":l.color,"line-width":5,"line-opacity":.85}});
    map.addLayer({id:l.id+"-points",type:"circle",source:"traffic-data",filter:["all",["==",["get","layer"],l.id],["==",["geometry-type"],"Point"]],paint:{"circle-color":l.color,"circle-radius":["interpolate",["linear"],["zoom"],8,4,13,8,17,11],"circle-stroke-color":"#0b1728","circle-stroke-width":2,"circle-opacity":.95}});
    layerIds.push(l.id+"-areas",l.id+"-lines",l.id+"-points");
  }
  map.addSource("route-data",{type:"geojson",data:emptyCollection()});
  map.addLayer({id:"route-outline",type:"line",source:"route-data",paint:{"line-color":"#092132","line-width":10,"line-opacity":.85},"layout":{"line-cap":"round","line-join":"round"}});
  map.addLayer({id:"route-line",type:"line",source:"route-data",paint:{"line-color":"#2ef1b7","line-width":5},"layout":{"line-cap":"round","line-join":"round"}});
  const inspect=e=>{
    if(chooser) return;
    const hits=map.queryRenderedFeatures(e.point,{layers:layerIds});
    map.getCanvas().style.cursor=hits.length?"pointer":"";
  };
  map.on("mousemove",inspect);
  map.on("click",e=>{
    if(chooser) {
      const p=[Number(e.lngLat.lng.toFixed(6)),Number(e.lngLat.lat.toFixed(6))];
      setWaypoint(chooser,p);
      chooser=null;
      $("map-hint").textContent="Nhấn lên đối tượng để xem nguồn và thời điểm cập nhật.";
      map.getCanvas().style.cursor="";
      return;
    }
    const hits=map.queryRenderedFeatures(e.point,{layers:layerIds});
    if(hits.length) showFeature(hits[0],e.lngLat);
  });
}
function itemText(label,value) {
  const dt=document.createElement("dt");dt.textContent=label;
  const dd=document.createElement("dd");dd.textContent=String(value??"—");
  return [dt,dd];
}
function showFeature(feature,lnglat) {
  const p=feature.properties||{}, layer=layerMeta(p.layer);
  const rows=[
    ["Lớp",layer.name],["Nguồn",p.source || "Không xác định"],
    ["Mô tả",p.description || "—"],["Mức độ",p.severity || "—"],
    ["Trạng thái tín hiệu",p.layer==="signal"?(p.state==="unknown"?"KHÔNG CÓ DỮ LIỆU TRỰC TIẾP":p.state||"unknown"):"—"],
    ["Thời gian ghi nhận",p.updated_at?new Date(p.updated_at).toLocaleString("vi-VN"):"Không rõ"],
    ["Hết hiệu lực",p.expires_at?new Date(p.expires_at).toLocaleString("vi-VN"):"Không rõ"],
    ["Tình trạng",p.is_demo?"GIẢ LẬP — KHÔNG SỬ DỤNG ĐIỀU HƯỚNG":staleness(feature)==="stale"?"Dữ liệu động có thể đã cũ":"Chưa được kiểm định hiện trường"],
    ["Độ tin cậy",p.confidence??"Không xác định"],
    ["Mã biển / tốc độ",p.sign_code || p.speed_limit || "—"]
  ];
  const container=$("feature-details");
  container.className="detail-grid";
  container.replaceChildren();
  for(const [label,value] of rows) container.append(...itemText(label,value));
  const popup=document.createElement("div");
  const title=document.createElement("div");title.className="popup-title";title.textContent=(p.is_demo?"[MẪU] ":"")+ (p.name||layer.name);
  popup.append(title);
  for(const [label,value] of rows.slice(0,5)) {
    const row=document.createElement("div");row.className="popup-row";row.textContent=label+": "+String(value);popup.append(row);
  }
  const point=feature.geometry.type==="Point"?feature.geometry.coordinates:[lnglat.lng,lnglat.lat];
  new maplibregl.Popup({maxWidth:"320px",offset:12}).setLngLat(point).setDOMContent(popup).addTo(map);
}
function setWaypoint(which,p) {
  if(which==="start") {origin=p;originMarker?.remove();originMarker=new maplibregl.Marker({color:"#20e3ac"}).setLngLat(p).addTo(map);}
  else {destination=p;destinationMarker?.remove();destinationMarker=new maplibregl.Marker({color:"#ec876d"}).setLngLat(p).addTo(map);}
  $(which==="start"?"start-label":"end-label").textContent=p[1].toFixed(5)+", "+p[0].toFixed(5);
  $("route").disabled=!(origin&&destination);
}
function selectPoint(which) {
  chooser=which;map.getCanvas().style.cursor="crosshair";
  $("map-hint").textContent="Nhấn trên bản đồ để đặt "+modes[which]+".";
  notice("Chọn "+modes[which].toLowerCase()+" bằng cách nhấn trên bản đồ.");
  if(window.matchMedia("(max-width:880px)").matches) map.scrollZoom.enable();
}
function wipeRoute() {
  routeController?.abort();origin=null;destination=null;originMarker?.remove();destinationMarker?.remove();
  $("start-label").textContent="Chưa chọn";$("end-label").textContent="Chưa chọn";
  $("route").disabled=true;$("route-result").textContent="Chọn hai vị trí để thử tính tuyến đường.";
  if(map?.getSource("route-data")) map.getSource("route-data").setData(emptyCollection());
}
const turns={left:"Rẽ trái",right:"Rẽ phải",straight:"Đi thẳng","slight left":"Chếch trái","slight right":"Chếch phải","sharp left":"Rẽ gắt trái","sharp right":"Rẽ gắt phải",uturn:"Quay đầu"};
function instruction(step) {
  const m=step.maneuver||{};
  if(m.type==="depart") return "Xuất phát";
  if(m.type==="arrive") return "Đến nơi";
  if(m.type==="roundabout") return "Qua vòng xuyến";
  return (turns[m.modifier]||"Tiếp tục")+(step.name?" vào "+step.name:"");
}
async function route() {
  if(!origin||!destination) return;
  routeController?.abort();routeController=new AbortController();
  const timeout=setTimeout(()=>routeController.abort(),20000);
  const base=CONFIG.osrmBase.replace(/\/$/,"");
  const point=p=>p[0]+","+p[1];
  const url=base+"/route/v1/driving/"+point(origin)+";"+point(destination)+"?overview=full&geometries=geojson&steps=true&alternatives=false";
  $("route").disabled=true;$("route-result").textContent="Đang tính tuyến đường thử nghiệm…";
  try {
    const response=await fetch(url,{signal:routeController.signal});
    if(!response.ok) throw new Error("HTTP "+response.status);
    const data=await response.json();
    if(data.code!=="Ok" || !data.routes?.[0]?.geometry) throw new Error(data.message||"Không tìm được tuyến");
    const r=data.routes[0];
    map.getSource("route-data").setData({type:"FeatureCollection",features:[{type:"Feature",geometry:r.geometry,properties:{}}]});
    const bounds=new maplibregl.LngLatBounds();r.geometry.coordinates.forEach(c=>bounds.extend(c));
    map.fitBounds(bounds,{padding:80,maxZoom:15,duration:850});
    const box=$("route-result");box.replaceChildren();
    const info=document.createElement("div");
    const strong=document.createElement("strong");strong.textContent=displayDistance(r.distance);
    info.append(strong,document.createTextNode("  ·  "+Math.max(1,Math.round(r.duration/60))+" phút (ước tính)"));
    const small=document.createElement("div");
    small.textContent="Nguồn OSRM demo; chưa xét ùn tắc, cảnh báo hay pha đèn trực tiếp.";
    const list=document.createElement("ol");list.className="steps";
    const steps=(r.legs||[]).flatMap(leg=>leg.steps||[]).slice(0,8);
    for(const step of steps){const li=document.createElement("li");li.textContent=instruction(step)+" · "+displayDistance(step.distance);list.append(li);}
    box.append(info,small,list);
  } catch(error) {
    $("route-result").textContent=error.name==="AbortError"?"Yêu cầu hết thời gian hoặc đã hủy.":"Lỗi định tuyến: "+error.message;
    notice("Không thể lấy tuyến OSRM; kiểm tra mạng hoặc cấu hình dịch vụ.");
  } finally {clearTimeout(timeout);$("route").disabled=!(origin&&destination);}
}
async function loadDemo() {
  try {
    const response=await fetch(new URL("../data/demo.geojson",import.meta.url));
    if(!response.ok) throw new Error("HTTP "+response.status);
    storeFeatures("demo",await response.json(),true);
    status("● MapLibre · Nền bản đồ đã sẵn sàng");
  } catch(error) {status("● Bản đồ sẵn sàng · không đọc được dữ liệu mẫu");notice(error.message);}
}
async function loadOSM() {
  if(map.getZoom()<CONFIG.overpassMinZoom) return notice("Cần phóng to bản đồ đến zoom "+CONFIG.overpassMinZoom+" trước khi nạp OSM.");
  const b=map.getBounds(),sizeLon=b.getEast()-b.getWest(),sizeLat=b.getNorth()-b.getSouth();
  if(sizeLon>.4 || sizeLat>.4) return notice("Vùng quá rộng; phóng to để tránh tạo tải cho máy chủ Overpass.");
  const bbox=[b.getSouth(),b.getWest(),b.getNorth(),b.getEast()].map(n=>n.toFixed(6)).join(",");
  const query="[out:json][timeout:22];(node[\"highway\"=\"traffic_signals\"]("+bbox+");node[\"traffic_sign\"]("+bbox+"););out body "+CONFIG.maxOsmFeatures+";";
  $("load-osm").disabled=true;status("● Đang truy vấn OSM theo khung nhìn…");
  try {
    const response=await fetch(CONFIG.overpassUrl,{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded;charset=UTF-8"},body:new URLSearchParams({data:query}),signal:AbortSignal.timeout(30000)});
    if(!response.ok) throw new Error("Overpass HTTP "+response.status);
    const data=await response.json();
    const now=new Date().toISOString();
    const features=(data.elements||[]).filter(e=>e.type==="node"&&e.tags&&Number.isFinite(e.lon)&&Number.isFinite(e.lat)).map(e=>{
      const signal=e.tags.highway==="traffic_signals";
      return {type:"Feature",id:"osm-"+e.id,geometry:{type:"Point",coordinates:[e.lon,e.lat]},properties:{
        layer:signal?"signal":"sign",name:signal?"Đèn tín hiệu (vị trí OSM)":"Biển báo "+(e.tags.traffic_sign||"(chưa rõ mã)"),
        sign_code:signal?undefined:e.tags.traffic_sign,state:signal?"unknown":undefined,
        source:"OpenStreetMap / Overpass",source_id:e.id,updated_at:now,fetched_at:now,
        description:"Dữ liệu cộng đồng, thời điểm ghi nhận ở đây là thời điểm truy vấn; chưa xác minh thực địa."+(signal?" Không có dữ liệu pha đèn trực tiếp.":"")
      }};
    });
    const added=storeFeatures("osm",{type:"FeatureCollection",features},false);
    status("● Đã nạp "+added+" điểm vị trí OSM · không phải realtime");
    notice("Nạp "+added+" vị trí OSM. Mã biển báo có thể thiếu; tín hiệu KHÔNG có pha trực tiếp.");
  } catch(error) {status("● OSM chưa sẵn sàng");notice("Không nạp được OSM: "+error.message);}
  finally {$("load-osm").disabled=false;}
}
function connect() {
  disconnect(false);
  let url;
  try {
    const raw=$("api-url").value.trim();
    url=new URL(raw);
    if(!["https:","http:"].includes(url.protocol)||url.username||url.password) throw new Error("URL API không hợp lệ.");
    if(url.protocol==="http:"&&!["localhost","127.0.0.1"].includes(url.hostname)&&location.protocol==="https:") throw new Error("HTTPS không thể kết nối đến API HTTP.");
  } catch(e) {return notice(e.message||"Cần nhập URL API hợp lệ.");}
  connectedApi=url.origin+url.pathname.replace(/\/$/,"");
  try {localStorage.setItem("trafficApiBase",connectedApi);}catch{}
  setBadge("idle","Đang kết nối");$("feed-time").textContent="Chờ dữ liệu sự kiện…";
  eventSource=new EventSource(connectedApi+"/api/events");
  eventSource.onopen=()=>{setBadge("connected","Đã kết nối");$("disconnect-live").disabled=false;$("feed-time").textContent="SSE đã kết nối. Đang chờ sự kiện từ nguồn có phép.";};
  eventSource.onerror=()=>{setBadge("error","Thử kết nối lại");$("feed-time").textContent="Không có kết nối SSE; trình duyệt sẽ thử kết nối lại.";};
  eventSource.addEventListener("snapshot",event=>{
    try {const payload=JSON.parse(event.data),n=storeFeatures("live",payload,true);
      if(n && payload.features.some(f=>!f.properties?.is_demo)) {$("show-demo").checked=false;demoVisible=false;paint();}
      $("feed-time").textContent="Ảnh chụp nguồn API: "+n+" đối tượng · "+timestamp();
    }catch(error){notice("Feed không hợp lệ: "+error.message);}
  });
  eventSource.addEventListener("upsert",event=>{
    try {const payload=JSON.parse(event.data),n=storeFeatures("live",payload,false);
      if(n && payload.features.some(f=>!f.properties?.is_demo)) {$("show-demo").checked=false;demoVisible=false;paint();}
      $("feed-time").textContent="Sự kiện API mới: "+n+" đối tượng · "+timestamp();
    }catch(error){notice("Sự kiện không hợp lệ: "+error.message);}
  });
}
function disconnect(clear=true) {
  eventSource?.close();eventSource=null;connectedApi="";
  $("disconnect-live").disabled=true;setBadge("idle","Chưa kết nối");
  if(clear){sources.live.clear();paint();$("feed-time").textContent="Đã ngắt nguồn API.";}
}
async function importGeojson(file) {
  if(!file)return;
  if(file.size>8_000_000) return notice("File vượt 8 MB. Hãy chia GeoJSON trước khi nhập.");
  try {const data=JSON.parse(await file.text()),n=storeFeatures("import",data,false);notice("Đã nhập "+n+" đối tượng. Dữ liệu người dùng chưa được xác minh.");}
  catch(error){notice("Không thể nhập GeoJSON: "+error.message);}
}
function exportGeojson() {
  const payload={type:"FeatureCollection",features:visibleFeatures()};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/geo+json"});
  const url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="giaothong-visible-"+new Date().toISOString().slice(0,10)+".geojson";a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function locate() {
  if(!navigator.geolocation)return notice("Trình duyệt không hỗ trợ định vị.");
  navigator.geolocation.getCurrentPosition(
    p=>{const coords=[p.coords.longitude,p.coords.latitude];map.flyTo({center:coords,zoom:15});notice("Đã định vị. Sai số dự kiến: "+Math.round(p.coords.accuracy)+" m.");},
    error=>notice("Không lấy được vị trí: "+error.message),
    {enableHighAccuracy:true,timeout:15000,maximumAge:30000}
  );
}
function gotoCoordinates() {
  const chunks=$("coord-search").value.trim().split(/[;,\s]+/).map(Number);
  if(chunks.length!==2||chunks.some(n=>!Number.isFinite(n)))return notice("Nhập hai tọa độ, ví dụ: 10.7769, 106.7009");
  let [lat,lon]=chunks;if(Math.abs(lat)>90 && Math.abs(lon)<=90)[lat,lon]=[lon,lat];
  if(Math.abs(lat)>90||Math.abs(lon)>180)return notice("Tọa độ ngoài miền giá trị WGS84.");
  map.flyTo({center:[lon,lat],zoom:15});notice("Đã di chuyển đến "+lat+", "+lon);
}
function setupControls() {
  $("layer-list").replaceChildren();
  for(const l of LAYERS) {
    const row=document.createElement("label");row.className="layer-item";
    const icon=document.createElement("span");icon.className="layer-symbol";icon.textContent=l.icon;icon.style.color=l.color;
    const label=document.createElement("span");label.className="layer-name";label.textContent=l.name;
    const count=document.createElement("small");count.className="layer-count";count.dataset.count=l.id;count.textContent="0";
    const input=document.createElement("input");input.type="checkbox";input.checked=true;
    input.addEventListener("change",()=>{input.checked?active.add(l.id):active.delete(l.id);paint();});
    row.append(icon,label,count,input);$("layer-list").append(row);
  }
  $("toggle-all").addEventListener("click",()=>{
    const hide=active.size>0;active.clear();if(!hide)LAYERS.forEach(l=>active.add(l.id));
    document.querySelectorAll("#layer-list input").forEach(input=>input.checked=!hide);
    $("toggle-all").textContent=hide?"Hiện tất cả":"Ẩn tất cả";paint();
  });
  $("show-demo").addEventListener("change",e=>{demoVisible=e.target.checked;paint();});
  $("load-osm").addEventListener("click",loadOSM);
  $("import-file").addEventListener("change",e=>{importGeojson(e.target.files?.[0]);e.target.value="";});
  $("export-file").addEventListener("click",exportGeojson);
  $("connect-live").addEventListener("click",connect);
  $("disconnect-live").addEventListener("click",()=>disconnect(true));
  $("pick-start").addEventListener("click",()=>selectPoint("start"));
  $("pick-end").addEventListener("click",()=>selectPoint("end"));
  $("route").addEventListener("click",route);
  $("clear-route").addEventListener("click",wipeRoute);
  $("locate").addEventListener("click",locate);
  $("coord-go").addEventListener("click",gotoCoordinates);
  $("coord-search").addEventListener("keydown",e=>{if(e.key==="Enter")gotoCoordinates();});
  try{$("api-url").value=localStorage.getItem("trafficApiBase")||(location.hostname==="localhost"||location.hostname==="127.0.0.1"?location.origin:"");}catch{}
  $("clock").textContent=timestamp();
  setInterval(()=>{$("clock").textContent=timestamp();paint();},60000);
}
setupControls();
map=new maplibregl.Map({container:"map",style:CONFIG.mapStyle,center:CONFIG.mapCenter,zoom:CONFIG.mapZoom,attributionControl:true});
map.addControl(new maplibregl.NavigationControl({showCompass:true}),"bottom-right");
map.addControl(new maplibregl.ScaleControl({unit:"metric"}),"bottom-left");
map.on("load",()=>{createLayers();loadDemo();});
map.on("error",e=>{console.warn("Map error",e.error);if(!map.loaded())status("● Nền bản đồ gặp lỗi; kiểm tra kết nối Internet.");});
