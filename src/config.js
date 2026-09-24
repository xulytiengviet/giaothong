// Cấu hình GitHub Pages / triển khai riêng. Không đặt khóa API bí mật trong file này.
export const CONFIG = Object.freeze({
  mapStyle: "https://tiles.openfreemap.org/styles/liberty",
  mapCenter: [106.701, 10.776],
  mapZoom: 12,
  // OSRM công cộng CHỈ dành cho bản thử nghiệm; self-host trong sản xuất.
  osrmBase: "https://router.project-osrm.org",
  overpassUrl: "https://overpass-api.de/api/interpreter",
  maxOsmFeatures: 250,
  overpassMinZoom: 11
});
export const LAYERS = Object.freeze([
  {id:"traffic",name:"Lưu lượng & ùn tắc",icon:"≋",color:"#f07883"},
  {id:"warning",name:"Cảnh báo giao thông",icon:"⚠",color:"#ffad53"},
  {id:"sign",name:"Biển báo đường bộ",icon:"⬡",color:"#5996f8"},
  {id:"signal",name:"Đèn tín hiệu",icon:"◉",color:"#aa8aff"},
  {id:"camera",name:"Camera giao thông",icon:"▣",color:"#5dded5"},
  {id:"restriction",name:"Hạn chế lưu thông",icon:"⊘",color:"#e87da9"},
  {id:"closure",name:"Đường cấm/đóng",icon:"⊗",color:"#e75958"},
  {id:"roadworks",name:"Công trường",icon:"⚒",color:"#edc15c"},
  {id:"flood",name:"Ngập nước",icon:"≈",color:"#5bcbf0"},
  {id:"parking",name:"Bãi đỗ xe",icon:"P",color:"#87bd76"},
  {id:"toll",name:"Trạm thu phí",icon:"₫",color:"#c8a574"},
  {id:"weather",name:"Thời tiết đường bộ",icon:"☁",color:"#9fa6b9"}
]);
export const VALID_LAYERS = new Set(LAYERS.map(l=>l.id));
export const layerMeta = id => LAYERS.find(l=>l.id===id) || LAYERS[1];
