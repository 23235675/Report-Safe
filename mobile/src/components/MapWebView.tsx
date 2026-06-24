import React, { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { C } from '../theme';

/** A single pin on the map. Colour carries meaning (status / shelter / you). */
export interface MapMarker {
  id: string;
  lat: number;
  lng: number;
  /** Fill colour of the pin (use theme tokens). */
  color: string;
  /** Title shown in the popup on tap. */
  title: string;
  /** Optional second popup line. */
  subtitle?: string;
}

interface Props {
  /** Map centre — usually the device location. */
  center: { lat: number; lng: number };
  markers: MapMarker[];
  /** Fired with the marker id when a pin is tapped. */
  onMarkerPress?: (id: string) => void;
  /** Initial zoom (Leaflet levels). */
  zoom?: number;
  height?: number;
}

/**
 * Free, key-less map: Leaflet + OpenStreetMap tiles inside a WebView. No Google
 * Maps API key, no billing — the same Leaflet stack the web app uses, so the map
 * looks consistent across surfaces. Needs network for tiles (a map inherently
 * does); the offline path stays the list views.
 *
 * ponytail: markers are baked into the initial HTML and the WebView is remounted
 * (via `key`) when they change — no postMessage diffing. Add live diffing only
 * if marker churn becomes a measurable perf problem.
 */
export default function MapWebView({ center, markers, onMarkerPress, zoom = 14, height = 260 }: Props): React.JSX.Element {
  const html = useMemo(() => buildHtml(center, markers, zoom), [center.lat, center.lng, markers, zoom]);
  // Remount when the rendered HTML changes so new markers take effect.
  const key = useMemo(() => String(html.length) + markers.map((m) => m.id).join(','), [html, markers]);

  return (
    <View style={[S.wrap, { height }]}>
      <WebView
        key={key}
        originWhitelist={['*']}
        source={{ html }}
        style={S.web}
        scrollEnabled={false}
        onMessage={(e) => onMarkerPress?.(e.nativeEvent.data)}
      />
    </View>
  );
}

function buildHtml(center: { lat: number; lng: number }, markers: MapMarker[], zoom: number): string {
  const data = JSON.stringify(markers);
  return `<!DOCTYPE html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<style>html,body,#map{height:100%;margin:0;padding:0;background:${C.bgRaised}}
.pin{width:18px;height:18px;border-radius:50%;border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)}
.me{width:14px;height:14px;border-radius:50%;background:${C.govBlue};border:3px solid #fff;box-shadow:0 0 0 4px rgba(15,118,110,.25)}</style>
</head><body><div id="map"></div><script>
var map = L.map('map',{zoomControl:true,attributionControl:false}).setView([${center.lat},${center.lng}], ${zoom});
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19}).addTo(map);
L.marker([${center.lat},${center.lng}],{icon:L.divIcon({className:'',html:'<div class="me"></div>',iconSize:[14,14],iconAnchor:[7,7]})}).addTo(map).bindPopup('You are here');
var pts = ${data};
var bounds = [[${center.lat},${center.lng}]];
pts.forEach(function(p){
  var m = L.marker([p.lat,p.lng],{icon:L.divIcon({className:'',html:'<div class="pin" style="background:'+p.color+'"></div>',iconSize:[18,18],iconAnchor:[9,9]})}).addTo(map);
  m.bindPopup('<b>'+p.title+'</b>'+(p.subtitle?'<br>'+p.subtitle:''));
  m.on('click', function(){ if(window.ReactNativeWebView) window.ReactNativeWebView.postMessage(p.id); });
  bounds.push([p.lat,p.lng]);
});
if(pts.length) try{ map.fitBounds(bounds,{padding:[40,40],maxZoom:16}); }catch(e){}
</script></body></html>`;
}

const S = StyleSheet.create({
  wrap: { borderRadius: 8, overflow: 'hidden', backgroundColor: C.bgRaised },
  web:  { flex: 1, backgroundColor: C.bgRaised },
});
