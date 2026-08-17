/**
 * mapService.js - Google Maps 官方地圖服務模組
 * 使用 AdvancedMarkerElement（新版 API，取代已棄用的 Marker）
 */

// 高質感深色地圖樣式
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  { featureType: "administrative.country", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
  { featureType: "administrative.province", elementType: "geometry.stroke", stylers: [{ color: "#4b6878" }] },
  { featureType: "landscape.man_made", elementType: "geometry.stroke", stylers: [{ color: "#334e68" }] },
  { featureType: "landscape.natural", elementType: "geometry", stylers: [{ color: "#021019" }] },
  { featureType: "poi", elementType: "geometry", stylers: [{ color: "#283d6a" }] },
  { featureType: "poi", elementType: "labels.text.fill", stylers: [{ color: "#6f9ba5" }] },
  { featureType: "poi", elementType: "labels.text.stroke", stylers: [{ color: "#1d2c4d" }] },
  { featureType: "poi.park", elementType: "geometry.fill", stylers: [{ color: "#023e58" }] },
  { featureType: "poi.park", elementType: "labels.text.fill", stylers: [{ color: "#3C7680" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#304a7d" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#98a5be" }] },
  { featureType: "road", elementType: "labels.text.stroke", stylers: [{ color: "#1d2c4d" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#2c6675" }] },
  { featureType: "road.highway", elementType: "geometry.stroke", stylers: [{ color: "#255663" }] },
  { featureType: "road.highway", elementType: "labels.text.fill", stylers: [{ color: "#b0d5ce" }] },
  { featureType: "road.highway", elementType: "labels.text.stroke", stylers: [{ color: "#023e58" }] },
  { featureType: "transit", elementType: "labels.text.fill", stylers: [{ color: "#98a5be" }] },
  { featureType: "transit", elementType: "labels.text.stroke", stylers: [{ color: "#1d2c4d" }] },
  { featureType: "transit.line", elementType: "geometry.fill", stylers: [{ color: "#283d6a" }] },
  { featureType: "transit.station", elementType: "geometry", stylers: [{ color: "#3a4762" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#0e1626" }] },
  { featureType: "water", elementType: "labels.text.fill", stylers: [{ color: "#4e6d70" }] },
];

export const MapService = {
  map: null,
  userMarker: null,
  radiusCircle: null,
  placeMarkers: [],      // 舊版 Marker (user location 用)
  advancedMarkers: [],   // AdvancedMarkerElement (店家 markers)
  currentInfoWindow: null,
  onLocationSelectCallback: null,

  /**
   * 初始化 Google Map
   */
  init(containerId = 'map', defaultLat = 25.0330, defaultLng = 121.5654, onLocationSelected = null) {
    const container = document.getElementById(containerId);
    if (!container) return;

    this.onLocationSelectCallback = onLocationSelected;
    const center = { lat: defaultLat, lng: defaultLng };

    this.map = new google.maps.Map(container, {
      center,
      zoom: 14,
      styles: DARK_MAP_STYLE,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: true,
      zoomControlOptions: {
        position: google.maps.ControlPosition?.RIGHT_BOTTOM ?? 7
      },
      // mapId 是 AdvancedMarkerElement 必要參數
      // 使用 DEMO_MAP_ID 可本機測試；正式上線建議在 Google Cloud Console 建立專屬 Map ID
      mapId: 'DEMO_MAP_ID'
    });

    this.currentInfoWindow = new google.maps.InfoWindow();

    // 點擊地圖換中心
    this.map.addListener('click', (e) => {
      const lat = e.latLng.lat();
      const lng = e.latLng.lng();
      if (this.onLocationSelectCallback) {
        this.onLocationSelectCallback(lat, lng);
      }
    });

    return this.map;
  },

  /**
   * 更新使用者 GPS 定位點與搜尋半徑圓圈
   * 使用者位置仍使用 legacy Marker（簡單圓點，不需要 AdvancedMarker）
   */
  updateUserLocation(lat, lng, radiusKm = 3) {
    if (!this.map) return;

    const center = { lat, lng };

    // 使用者位置 (SVG 藍點)
    if (this.userMarker) {
      this.userMarker.setPosition(center);
    } else {
      this.userMarker = new google.maps.Marker({
        position: center,
        map: this.map,
        title: '📍 您的目前位置',
        zIndex: 9999,
        icon: {
          path: google.maps.SymbolPath?.CIRCLE ?? 0,
          scale: 9,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        }
      });
    }

    // 搜尋半徑圓圈
    const radiusMeters = radiusKm * 1000;
    if (this.radiusCircle) {
      this.radiusCircle.setCenter(center);
      this.radiusCircle.setRadius(radiusMeters);
    } else {
      this.radiusCircle = new google.maps.Circle({
        strokeColor: '#f97316',
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: '#f97316',
        fillOpacity: 0.07,
        map: this.map,
        center,
        radius: radiusMeters,
      });
    }

    this.map.fitBounds(this.radiusCircle.getBounds());
  },

  /**
   * 標記店家清單（使用 AdvancedMarkerElement）
   */
  async renderPlaces(places, onMarkerClick = null) {
    if (!this.map) return;

    // 清除舊 Markers
    this.advancedMarkers.forEach(m => {
      if (m.map) m.map = null;
    });
    this.advancedMarkers = [];

    // 確認 AdvancedMarkerElement 可用
    const { AdvancedMarkerElement } = await google.maps.importLibrary('marker').catch(() => ({}));

    if (!AdvancedMarkerElement) {
      // Fallback：用舊版 Marker
      this._renderPlacesLegacy(places, onMarkerClick);
      return;
    }

    places.forEach((place) => {
      if (!place.lat || !place.lng) return;

      const isOpen = place.isOpen === true;
      const isClosed = place.isOpen === false;
      const color = isOpen ? '#10b981' : isClosed ? '#ef4444' : '#f59e0b';
      const label = isOpen ? '營業中' : isClosed ? '已打烊' : '?';

      // 建立自訂 HTML Pin
      const pin = document.createElement('div');
      pin.style.cssText = `
        width: 36px; height: 36px;
        background: ${color};
        border: 2.5px solid white;
        border-radius: 50% 50% 50% 0;
        transform: rotate(-45deg);
        box-shadow: 0 3px 10px rgba(0,0,0,0.4);
        display: flex; align-items: center; justify-content: center;
        cursor: pointer;
        transition: transform 0.15s ease;
      `;
      pin.innerHTML = `<span style="transform:rotate(45deg);font-size:1rem;">${place.categoryIcon || '🍽️'}</span>`;

      pin.addEventListener('mouseenter', () => { pin.style.transform = 'rotate(-45deg) scale(1.2)'; });
      pin.addEventListener('mouseleave', () => { pin.style.transform = 'rotate(-45deg) scale(1)'; });

      const marker = new AdvancedMarkerElement({
        position: { lat: place.lat, lng: place.lng },
        map: this.map,
        title: place.name,
        content: pin
      });

      // InfoWindow 點擊
      marker.addListener('click', () => {
        if (this.currentInfoWindow) {
          this.currentInfoWindow.setContent(this._buildInfoWindowContent(place, color));
          this.currentInfoWindow.open(this.map, marker);
        }
        if (onMarkerClick) onMarkerClick(place, marker);
      });

      this.advancedMarkers.push(marker);
    });
  },

  /**
   * 舊版 Marker Fallback（以防 AdvancedMarkerElement 不可用）
   */
  _renderPlacesLegacy(places, onMarkerClick) {
    this.placeMarkers.forEach(m => m.setMap(null));
    this.placeMarkers = [];

    places.forEach((place) => {
      if (!place.lat || !place.lng) return;

      const isOpen = place.isOpen === true;
      const color = isOpen ? '#10b981' : (place.isOpen === false ? '#ef4444' : '#f59e0b');

      const marker = new google.maps.Marker({
        position: { lat: place.lat, lng: place.lng },
        map: this.map,
        title: place.name,
        icon: {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
          fillColor: color,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
          scale: 1.4,
          anchor: new google.maps.Point(12, 22),
        }
      });

      marker.addListener('click', () => {
        if (this.currentInfoWindow) {
          this.currentInfoWindow.setContent(this._buildInfoWindowContent(place, color));
          this.currentInfoWindow.open(this.map, marker);
        }
        if (onMarkerClick) onMarkerClick(place, marker);
      });

      this.placeMarkers.push(marker);
    });
  },

  /**
   * 建立 InfoWindow HTML 內容
   */
  _buildInfoWindowContent(place, markerColor) {
    const isOpen = place.isOpen === true;
    const statusText = isOpen ? '● 營業中' : (place.isOpen === false ? '● 已打烊' : '● 時段待確認');
    return `
      <div style="color:#0f172a;font-family:'Noto Sans TC',sans-serif;padding:6px 8px;max-width:240px;min-width:160px;">
        <div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:3px;">
          ${place.category || '餐飲'} · <span style="color:${markerColor}">${statusText}</span>
        </div>
        <h4 style="font-size:14px;font-weight:800;margin:0 0 5px;color:#0f172a;line-height:1.3;">${place.name}</h4>
        <div style="font-size:11px;color:#475569;margin-bottom:3px;">🕒 ${place.todayHoursText || '依現場公告'}</div>
        <div style="font-size:11px;color:#475569;margin-bottom:6px;">📍 ${place.distanceText}</div>
        <div style="display:flex;gap:5px;">
          <a href="${place.googleMapsUrl}" target="_blank" rel="noopener noreferrer"
            style="flex:1;text-align:center;background:#2563eb;color:white;text-decoration:none;padding:5px;border-radius:6px;font-size:11px;font-weight:700;">
            地圖
          </a>
          <a href="${place.directionsUrl}" target="_blank" rel="noopener noreferrer"
            style="flex:1;text-align:center;background:#0f172a;color:white;text-decoration:none;padding:5px;border-radius:6px;font-size:11px;font-weight:700;">
            導航
          </a>
        </div>
      </div>
    `;
  },

  /**
   * 平移並聚焦至特定座標
   */
  focusPlace(lat, lng) {
    if (!this.map) return;
    this.map.panTo({ lat, lng });
    this.map.setZoom(17);
  }
};
