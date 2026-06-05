export function buildLeafletMapHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    * { box-sizing: border-box; }
    html, body { margin:0; padding:0; height:100%; width:100%; overflow:hidden; background:#dbeafe; }
    #map { position:absolute; top:0; left:0; right:0; bottom:0; }
    .driver-dot {
      width:14px; height:14px; border-radius:50%;
      background:#1565C0; border:3px solid #fff;
      box-shadow:0 0 0 2px rgba(21,101,192,.45);
    }
    #map-status {
      position:absolute; top:8px; left:8px; z-index:1000;
      background:rgba(255,255,255,.92); padding:6px 10px; border-radius:6px;
      font:12px/1.3 -apple-system,BlinkMacSystemFont,sans-serif; color:#334155;
      pointer-events:none;
    }
  </style>
</head>
<body>
  <div id="map-status">Loading map…</div>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = null;
    var driverMarker = null;
    var pickupMarker = null;
    var dropoffMarker = null;
    var routeLayer = null;
    var zoneLayers = [];
    var mapReady = false;

    function setStatus(msg) {
      var el = document.getElementById('map-status');
      if (el) el.textContent = msg || '';
    }

    function initMap() {
      if (map || typeof L === 'undefined') {
        if (typeof L === 'undefined') setStatus('Map library failed to load');
        return;
      }
      map = L.map('map', { zoomControl:true, attributionControl:true }).setView([-41.0, 174.0], 5);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '&copy; OpenStreetMap'
      }).addTo(map);
      map.whenReady(function() {
        mapReady = true;
        setStatus('');
        map.invalidateSize();
        notifyReady();
      });
      setTimeout(function(){ if(map) map.invalidateSize(); }, 300);
      setTimeout(function(){ if(map) map.invalidateSize(); }, 800);
    }

    function notifyReady() {
      if (window.ReactNativeWebView) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type:'ready' }));
      }
    }

    function clearRoute() {
      if (routeLayer && map) { map.removeLayer(routeLayer); routeLayer = null; }
    }

    function clearMarkers() {
      if (!map) return;
      if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
      if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; }
    }

    function clearZones() {
      if (!map) return;
      zoneLayers.forEach(function(l){ map.removeLayer(l); });
      zoneLayers = [];
    }

    function setDriver(lat, lng) {
      if (!map || !lat || !lng) return;
      if (!driverMarker) {
        driverMarker = L.marker([lat, lng], {
          icon: L.divIcon({ className:'', html:'<div class="driver-dot"></div>', iconSize:[20,20], iconAnchor:[10,10] })
        }).addTo(map);
      } else {
        driverMarker.setLatLng([lat, lng]);
      }
    }

    function drawRoute(pLat, pLng, dLat, dLng) {
      clearRoute();
      if (!map || !pLat || !pLng || !dLat || !dLng) return;
      fetch('https://router.project-osrm.org/route/v1/driving/' + pLng + ',' + pLat + ';' + dLng + ',' + dLat + '?overview=full&geometries=geojson')
        .then(function(r){ return r.json(); })
        .then(function(data) {
          var coords = (data.routes && data.routes[0] && data.routes[0].geometry && data.routes[0].geometry.coordinates) || [];
          if (!coords.length) {
            routeLayer = L.polyline([[pLat,pLng],[dLat,dLng]], { color:'#00695C', weight:5, opacity:0.85 }).addTo(map);
          } else {
            var latlngs = coords.map(function(c){ return [c[1], c[0]]; });
            routeLayer = L.polyline(latlngs, { color:'#00695C', weight:5, opacity:0.85 }).addTo(map);
          }
          map.fitBounds(L.latLngBounds([[pLat,pLng],[dLat,dLng]]), { padding:[40,40], maxZoom:15 });
        })
        .catch(function() {
          routeLayer = L.polyline([[pLat,pLng],[dLat,dLng]], { color:'#00695C', weight:5, opacity:0.85 }).addTo(map);
          map.fitBounds(L.latLngBounds([[pLat,pLng],[dLat,dLng]]), { padding:[40,40], maxZoom:15 });
        });
    }

    function updateMap(payload) {
      if (!payload) return;
      initMap();
      if (!map) return;
      map.invalidateSize();
      if (payload.centerLat && payload.centerLng && payload.centerZoom) {
        map.setView([payload.centerLat, payload.centerLng], payload.centerZoom);
      }
      if (payload.driverLat && payload.driverLng) setDriver(payload.driverLat, payload.driverLng);
      clearMarkers();
      if (payload.pickupLat && payload.pickupLng) {
        pickupMarker = L.marker([payload.pickupLat, payload.pickupLng]).addTo(map).bindPopup('Pickup');
      }
      if (payload.dropoffLat && payload.dropoffLng) {
        dropoffMarker = L.marker([payload.dropoffLat, payload.dropoffLng]).addTo(map).bindPopup('Drop-off');
      }
      clearRoute();
      if (payload.showRoute && payload.pickupLat && payload.pickupLng && payload.dropoffLat && payload.dropoffLng) {
        drawRoute(payload.pickupLat, payload.pickupLng, payload.dropoffLat, payload.dropoffLng);
      } else if (payload.fitDriver && payload.driverLat && payload.driverLng) {
        map.setView([payload.driverLat, payload.driverLng], payload.fitZoom || 14);
      } else if (payload.pickupLat && payload.pickupLng && !payload.dropoffLat) {
        map.setView([payload.pickupLat, payload.pickupLng], 14);
      }
      if (payload.zones && Array.isArray(payload.zones)) {
        clearZones();
        payload.zones.forEach(function(z) {
          if (!z.boundary || !z.boundary.length) return;
          var latlngs = z.boundary.map(function(p){ return [p[0], p[1]]; });
          var layer = L.polygon(latlngs, {
            color: z.active === false ? '#94a3b8' : '#00695C',
            weight: 2,
            fillColor: z.active === false ? '#cbd5e1' : '#00695C',
            fillOpacity: z.active === false ? 0.08 : 0.15
          }).addTo(map);
          if (z.name) layer.bindPopup(z.name);
          zoneLayers.push(layer);
        });
      }
    }

    window.updateMap = updateMap;

    function onRNMessage(raw) {
      try {
        var payload = typeof raw === 'string' ? JSON.parse(raw) : raw;
        if (payload && payload.type === 'ready') return;
        updateMap(payload);
      } catch (err) {}
    }

    document.addEventListener('message', function(e) { onRNMessage(e.data); });
    window.addEventListener('message', function(e) { onRNMessage(e.data); });

    initMap();
    notifyReady();
  </script>
</body>
</html>`;
}

export type LeafletMapPayload = {
  driverLat?: number;
  driverLng?: number;
  pickupLat?: number;
  pickupLng?: number;
  dropoffLat?: number;
  dropoffLng?: number;
  showRoute?: boolean;
  fitDriver?: boolean;
  fitZoom?: number;
  centerLat?: number;
  centerLng?: number;
  centerZoom?: number;
  zones?: Array<{ name: string; active?: boolean; boundary: number[][] }>;
};
