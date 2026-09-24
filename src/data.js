import {VALID_LAYERS} from "./config.js";

const MAX_FEATURES = 5000;
const POINT_TYPES = new Set(["Point","MultiPoint"]);
const LINE_TYPES = new Set(["LineString","MultiLineString"]);
const AREA_TYPES = new Set(["Polygon","MultiPolygon"]);

const validPair = pair => Array.isArray(pair) && pair.length >= 2
  && Number.isFinite(pair[0]) && Number.isFinite(pair[1])
  && Math.abs(pair[0]) <= 180 && Math.abs(pair[1]) <= 90;
function allCoordsValid(coords) {
  if (!Array.isArray(coords) || !coords.length) return false;
  return typeof coords[0] === "number" ? validPair(coords) : coords.every(allCoordsValid);
}
export function normalizeFeature(feature, defaultSource = "Nhập từ GeoJSON") {
  if (!feature || feature.type !== "Feature" || !feature.geometry || !feature.properties)
    throw new Error("GeoJSON phải gồm Feature, geometry và properties.");
  const {type,coordinates} = feature.geometry;
  if (![...POINT_TYPES,...LINE_TYPES,...AREA_TYPES].includes(type) || !allCoordsValid(coordinates))
    throw new Error("Hình học hoặc tọa độ GeoJSON không hợp lệ (WGS84 [lon, lat]).");
  const layer = feature.properties.layer;
  if (!VALID_LAYERS.has(layer)) throw new Error("Thuộc tính properties.layer không thuộc danh mục lớp.");
  const props = {...feature.properties, layer};
  props.name = String(props.name || "Chưa đặt tên").slice(0,250);
  props.source = String(props.source || defaultSource).slice(0,180);
  props.state = layer === "signal" && ["red","amber","green","flashing","off","unknown"].includes(props.state)
    ? props.state : layer === "signal" ? "unknown" : props.state;
  props.is_demo = props.is_demo === true;
  if (props.updated_at && !Number.isFinite(Date.parse(props.updated_at))) throw new Error("updated_at không phải ngày hợp lệ.");
  if (props.expires_at && !Number.isFinite(Date.parse(props.expires_at))) throw new Error("expires_at không phải ngày hợp lệ.");
  props.updated_at ||= new Date().toISOString();
  const id = String(feature.id ?? props.id ?? (globalThis.crypto?.randomUUID?.() || Date.now() + "-" + Math.random())).slice(0,180);
  return {type:"Feature",id,geometry:{type,coordinates},properties:props};
}
export function normalizeCollection(payload, source, maxFeatures = MAX_FEATURES) {
  const input = payload?.type === "Feature" ? [payload] : payload?.type === "FeatureCollection" ? payload.features : null;
  if (!Array.isArray(input)) throw new Error("Cần đối tượng Feature hoặc FeatureCollection.");
  if (input.length > maxFeatures) throw new Error("Vượt quá " + maxFeatures + " đối tượng/lần.");
  return {type:"FeatureCollection",features:input.map(item=>normalizeFeature(item,source))};
}
export function expired(f, now = Date.now()) {
  const exp = f?.properties?.expires_at;
  return !!exp && Number.isFinite(Date.parse(exp)) && Date.parse(exp) <= now;
}
export function isDynamic(layer) {
  return ["traffic","warning","signal","closure","roadworks","flood","weather"].includes(layer);
}
export function staleness(f, now = Date.now()) {
  if (!isDynamic(f.properties.layer)) return "static";
  const ms = Date.parse(f.properties.updated_at);
  if (!Number.isFinite(ms)) return "unknown";
  return now - ms > 15 * 60 * 1000 ? "stale" : "recent";
}
export function displayDistance(m) {return m < 1000 ? Math.round(m) + " m" : (m / 1000).toFixed(1) + " km";}
export const emptyCollection = () => ({type:"FeatureCollection",features:[]});
