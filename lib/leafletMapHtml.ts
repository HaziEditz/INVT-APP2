export function buildLeafletMapHtml(): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <style>
    html, body, #map { margin:0; padding:0; height:100%; width:100%; background:#e8eef2; }
    .driver-dot {
      width:14px; height:14px; border-radius:50%;
      background:#1565C0; border:3px solid #fff;
      box-shadow:0 0 0 2px rgba(21,101,192,.45);
    }
  </style>
</head>
<body>
  <div id="map"></div>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    var map = L.map('map', { zoomControl:true, attributionControl:true }).setView([-41.0, 174.0], 5);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }).addTo(map);

    var driverMarker = null;
    var pickupMarker = null;
    var dropoffMarker = null;
    var routeLayer = null;
    var zoneLayers = [];

    function clearRoute() {
      if (routeLayer) { map.removeLayer(routeLayer); routeLayer = null; }
    }

    function clearMarkers() {
      if (pickupMarker) { map.removeLayer(pickupMarker); pickupMarker = null; }
      if (dropoffMarker) { map.removeLayer(dropoffMarker); dropoffMarker = null; }
    }

    function clearZones() {
      zoneLayers.forEach(function(l){ map.removeLayer(l); });
      zoneLayers = [];
    }

    function setDriver(lat, lng) {
      if (!lat || !lng) return;
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
      if (!pLat || !pLng || !dLat || !dLng) return;
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

    document.addEventListener('message', function(e) {
      try { updateMap(JSON.parse(e.data)); } catch(err) {}
    });
    window.addEventListener('message', function(e) {
      try { updateMap(JSON.parse(e.data)); } catch(err) {}
    });

    if (window.ReactNativeWebView) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type:'ready' }));
    }
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
