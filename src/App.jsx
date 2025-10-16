import React, { useState, useEffect, useCallback } from 'react';
import { MapContainer, TileLayer, Polyline, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons in Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Utility Functions
const calculateDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371000; // Earth radius in meters
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

const calculateBearing = (lat1, lon1, lat2, lon2) => {
  const dLon = toRadians(lon2 - lon1);
  const y = Math.sin(dLon) * Math.cos(toRadians(lat2));
  const x = Math.cos(toRadians(lat1)) * Math.sin(toRadians(lat2)) -
    Math.sin(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.cos(dLon);
  return (toDegrees(Math.atan2(y, x)) + 360) % 360;
};

const toRadians = (degrees) => degrees * Math.PI / 180;
const toDegrees = (radians) => radians * 180 / Math.PI;

// Kalman Filter
const applyKalmanFilter = (points) => {
  if (points.length === 0) return [];
  
  const q = 0.00001; // process noise
  const r = 0.0001;  // measurement noise
  let p = 1.0;
  let k;
  
  let xLat = parseFloat(points[0].latitude);
  let xLng = parseFloat(points[0].longitude);
  
  const smoothed = [];
  
  for (const point of points) {
    const measurementLat = parseFloat(point.latitude);
    const measurementLng = parseFloat(point.longitude);
    
    // Latitude filter
    p = p + q;
    k = p / (p + r);
    xLat = xLat + k * (measurementLat - xLat);
    p = (1 - k) * p;
    
    // Longitude filter
    p = p + q;
    k = p / (p + r);
    xLng = xLng + k * (measurementLng - xLng);
    p = (1 - k) * p;
    
    smoothed.push({
      latitude: xLat.toFixed(7),
      longitude: xLng.toFixed(7),
      createdAt: point.createdAt
    });
  }
  
  return smoothed;
};

// Remove zigzags
const removeZigzags = (points, threshold = 60) => {
  if (points.length < 3) return points;
  
  const result = [points[0]];
  
  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    
    const bearing1 = calculateBearing(
      parseFloat(prev.latitude), parseFloat(prev.longitude),
      parseFloat(curr.latitude), parseFloat(curr.longitude)
    );
    const bearing2 = calculateBearing(
      parseFloat(curr.latitude), parseFloat(curr.longitude),
      parseFloat(next.latitude), parseFloat(next.longitude)
    );
    
    let diff = Math.abs(bearing2 - bearing1);
    if (diff > 180) diff = 360 - diff;
    
    if (diff < threshold) result.push(curr);
  }
  
  result.push(points[points.length - 1]);
  return result;
};

// Thin points
const thinPoints = (points, minDistance = 40) => {
  if (points.length < 2) return points;
  
  const result = [points[0]];
  
  for (let i = 1; i < points.length; i++) {
    const last = result[result.length - 1];
    const current = points[i];
    const dist = calculateDistance(
      parseFloat(last.latitude), parseFloat(last.longitude),
      parseFloat(current.latitude), parseFloat(current.longitude)
    );
    if (dist >= minDistance) result.push(current);
  }
  
  return result;
};

// Map Center Component
const MapCenter = ({ center }) => {
  const map = useMap();
  useEffect(() => {
    if (center) {
      map.setView(center, 15);
    }
  }, [center, map]);
  return null;
};

// Main Component
const MapTracker = () => {
  const [loading, setLoading] = useState(true);
  const [points, setPoints] = useState([]);
  const [filteredPoints, setFilteredPoints] = useState([]);
  const [orsPoints, setOrsPoints] = useState([]);
  const [mapboxPoints, setMapboxPoints] = useState([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [center, setCenter] = useState([13.0827, 80.2707]); // Default: Chennai
  
  const [userId, setUserId] = useState('a874e128-3a24-4ac5-a36a-ada3c1d603ee');
  const [date, setDate] = useState('2025-10-16');

  const fetchMapData = useCallback(async () => {
    try {
      setLoading(true);
      
      const response = await fetch(
        `https://api.getfieldy.com/route/map/debug/full-day-tracking/${userId}/${date}`
      );
      
      if (!response.ok) throw new Error('Failed to fetch data');
      
      const json = await response.json();
      await processPoints(json);
    } catch (error) {
      console.error('Error fetching map data:', error);
      alert('Error loading map data. Check console for details.');
    } finally {
      setLoading(false);
    }
  }, [userId, date]);

  const processPoints = async (body) => {
    const rawData = body?.data;
    if (!Array.isArray(rawData)) return;
    
    // Extract points with accuracy filter
    const extractedPoints = [];
    for (const element of rawData) {
      const coords = element?.location?.coordinates;
      if (Array.isArray(coords) && coords.length === 2) {
        if (!element.accuracy || element.accuracy < 15) {
          extractedPoints.push({
            latitude: coords[1].toString(),
            longitude: coords[0].toString(),
            createdAt: element.location_captured_on_timestamp
          });
        }
      }
    }
    
    setPoints(extractedPoints);
    
    if (extractedPoints.length < 2) return;

    console.log(extractedPoints)
    
    // Apply filtering
    let processed = applyKalmanFilter(extractedPoints);
    processed = removeZigzags(processed);
    processed = thinPoints(processed, 40);
    
    setFilteredPoints(processed);
    
    // Calculate distance
    let distance = 0;
    for (let i = 0; i < processed.length - 1; i++) {
      distance += calculateDistance(
        parseFloat(processed[i].latitude),
        parseFloat(processed[i].longitude),
        parseFloat(processed[i + 1].latitude),
        parseFloat(processed[i + 1].longitude)
      );
    }
    setTotalDistance(distance);
    
    // Set map center
    if (processed.length > 0) {
      setCenter([
        parseFloat(processed[0].latitude),
        parseFloat(processed[0].longitude)
      ]);
    }
    
    // Fetch ORS and Mapbox data
    await fetchORSSnap(extractedPoints);
  };

  const fetchORSSnap = async (pointsToSnap) => {
    try {
      const response = await fetch(
        'https://routemap.getfieldy.com/ors/v2/snap/driving-car',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
          },
          body: JSON.stringify({
            radius: 50,
            locations: pointsToSnap.map(e => [
              parseFloat(e.longitude),
              parseFloat(e.latitude)
            ])
          })
        }
      );
      
      const data = await response.json();
      const locations = data?.locations || [];
      
      const snappedPoints = locations
        .filter(loc => loc !== null)
        .map(loc => ({
          latitude: loc.location[1].toString(),
          longitude: loc.location[0].toString(),
          createdAt: Date.now()
        }));
      
      setOrsPoints(snappedPoints);
      await fetchMapboxRoute(snappedPoints);
    } catch (error) {
      console.error('Error fetching ORS snap:', error);
    }
  };

  const fetchMapboxRoute = async (pointsForRoute) => {
    try {
      let allPoints = [];
      let totalDist = 0;
      
      // Process in chunks of 25
      for (let i = 0; i < pointsForRoute.length; i += 25) {
        const segment = pointsForRoute.slice(i, Math.min(i + 25, pointsForRoute.length));
        
        if (segment.length < 2) break;
        
        const waypoints = segment
          .map(p => `${p.longitude},${p.latitude}`)
          .join(';');
        
        const url = `https://api.mapbox.com/directions/v5/mapbox/walking/${waypoints}?access_token=pk.eyJ1IjoiZ2F2YXNrYXItZmllbGR5IiwiYSI6ImNtOG5oMWVlOTAwaXAya3F0aHkxcno1OGMifQ.u-ghg6kr-0rG0R7m90KCjg`;
        
        const response = await fetch(url);
        const data = await response.json();
        
        if (data.routes && data.routes[0]) {
          const geometry = data.routes[0].geometry;
          totalDist += data.routes[0].distance;
          
          // Decode polyline
          const decoded = decodePolyline(geometry);
          allPoints = allPoints.concat(decoded);
        }
      }
      
      setMapboxPoints(allPoints);
      setTotalDistance(totalDist);
    } catch (error) {
      console.error('Error fetching Mapbox route:', error);
    }
  };

  // Polyline decoder
  const decodePolyline = (encoded) => {
    const points = [];
    let index = 0, len = encoded.length;
    let lat = 0, lng = 0;
    
    while (index < len) {
      let b, shift = 0, result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lat += dlat;
      
      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
      lng += dlng;
      
      points.push([lat / 1e5, lng / 1e5]);
    }
    
    return points;
  };

  useEffect(() => {
    fetchMapData();
  }, [fetchMapData]);

  // Convert points to Leaflet format
  const rawPolyline = points.map(p => [parseFloat(p.latitude), parseFloat(p.longitude)]);
  const filteredPolyline = filteredPoints.map(p => [parseFloat(p.latitude), parseFloat(p.longitude)]);
  const orsPolyline = orsPoints.map(p => [parseFloat(p.latitude), parseFloat(p.longitude)]);

  return (
    <div style={{ width: '100vw', height: '100vh', display: 'flex', flexDirection: 'column' }}>
      <div style={{ 
        padding: '16px', 
        background: '#f5f5f5', 
        borderBottom: '2px solid #ddd',
        display: 'flex',
        gap: '12px',
        alignItems: 'center',
        flexWrap: 'wrap'
      }}>
        <input
          type="text"
          placeholder="User ID"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '200px' }}
        />
        <input
          type="text"
          placeholder="Date (YYYY-MM-DD)"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ padding: '8px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '150px' }}
        />
        <button 
          onClick={fetchMapData}
          disabled={loading}
          style={{ 
            padding: '8px 16px', 
            background: '#4CAF50', 
            color: 'white', 
            border: 'none', 
            borderRadius: '4px',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.6 : 1
          }}
        >
          {loading ? 'Loading...' : 'Load Map'}
        </button>
        <div style={{ marginLeft: 'auto', fontWeight: 'bold' }}>
          Distance: {(totalDistance / 1000).toFixed(2)} km
        </div>
      </div>
      
      <div style={{ flex: 1, position: 'relative' }}>
        {loading ? (
          <div style={{ 
            position: 'absolute', 
            top: '50%', 
            left: '50%', 
            transform: 'translate(-50%, -50%)',
            fontSize: '24px',
            fontWeight: 'bold'
          }}>
            Loading...
          </div>
        ) : (
          <MapContainer 
            center={center} 
            zoom={15} 
            style={{ width: '100%', height: '100%' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <MapCenter center={center} />
            
            {/* Red: Raw points */}
            {rawPolyline.length > 0 && (
              <Polyline positions={rawPolyline} color="red" weight={5} opacity={0.7} />
            )}
            
            {/* Orange: ORS snapped */}
            {orsPolyline.length > 0 && (
              <Polyline positions={orsPolyline} color="orange" weight={5} opacity={0.7} />
            )}
            
            {/* Green: Mapbox route */}
            {mapboxPoints.length > 0 && (
              <Polyline positions={mapboxPoints} color="green" weight={5} opacity={0.7} />
            )}
            
            {/* Markers */}
            {filteredPoints.length > 0 && (
              <>
                <Marker position={[parseFloat(filteredPoints[0].latitude), parseFloat(filteredPoints[0].longitude)]}>
                  <Popup>Start Point</Popup>
                </Marker>
                <Marker position={[parseFloat(filteredPoints[filteredPoints.length - 1].latitude), parseFloat(filteredPoints[filteredPoints.length - 1].longitude)]}>
                  <Popup>End Point</Popup>
                </Marker>
              </>
            )}
          </MapContainer>
        )}
      </div>
      
      <div style={{ 
        padding: '12px', 
        background: '#f5f5f5', 
        borderTop: '2px solid #ddd',
        fontSize: '14px'
      }}>
        <div style={{ display: 'flex', gap: '24px' }}>
          <div><span style={{ color: 'red', fontWeight: 'bold' }}>■</span> Raw Points ({points.length})</div>
          <div><span style={{ color: 'orange', fontWeight: 'bold' }}>■</span> ORS Snapped ({orsPoints.length})</div>
          <div><span style={{ color: 'green', fontWeight: 'bold' }}>■</span> Mapbox Route ({mapboxPoints.length}) </div>
        </div>
      </div>
    </div>
  );
};

export default MapTracker;