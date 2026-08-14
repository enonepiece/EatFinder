/**
 * mapService.js - Google Maps 官方地圖服務模組
 */

// 高質感深色地圖樣式 (Dark Theme Style)
const DARK_MAP_STYLE = [
  { elementType: "geometry", stylers: [{ color: "#1d2c4d" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#8ec3b9" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a3646" }] },
  {
    featureType: "administrative.country",
    elementType: "geometry.stroke",
    stylers: [{ color: "#4b6878" }],
  },
  {
    featureType: "administrative.province",
    elementType: "geometry.stroke",
    stylers: [{ color: "#4b6878" }],
  },
  {
    featureType: "landscape.man_made",
    elementType: "geometry.stroke",
    stylers: [{ color: "#334e68" }],
  },
  {
    featureType: "landscape.natural",
    elementType: "geometry",
    stylers: [{ color: "#021019" }],
  },
  {
    featureType: "poi",
    elementType: "geometry",
    stylers: [{ color: "#283d6a" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.fill",
    stylers: [{ color: "#6f9ba5" }],
  },
  {
    featureType: "poi",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#1d2c4d" }],
  },
  {
    featureType: "poi.park",
    elementType: "geometry.fill",
    stylers: [{ color: "#023e58" }],
  },
  {
    featureType: "poi.park",
    elementType: "labels.text.fill",
    stylers: [{ color: "#3C7680" }],
  },
  {
    featureType: "road",
    elementType: "geometry",
    stylers: [{ color: "#304a7d" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.fill",
    stylers: [{ color: "#98a5be" }],
  },
  {
    featureType: "road",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#1d2c4d" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry",
    stylers: [{ color: "#2c6675" }],
  },
  {
    featureType: "road.highway",
    elementType: "geometry.stroke",
    stylers: [{ color: "#255663" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.fill",
    stylers: [{ color: "#b0d5ce" }],
  },
  {
    featureType: "road.highway",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#023e58" }],
  },
  {
    featureType: "transit",
    elementType: "labels.text.fill",
    stylers: [{ color: "#98a5be" }],
  },
  {
    featureType: "transit",
    elementType: "labels.text.stroke",
    stylers: [{ color: "#1d2c4d" }],
  },
  {
    featureType: "transit.line",
    elementType: "geometry.fill",
    stylers: [{ color: "#283d6a" }],
  },
  {
    featureType: "transit.station",
    elementType: "geometry",
    stylers: [{ color: "#3a4762" }],
  },
  {
    featureType: "water",
    elementType: "geometry",
    stylers: [{ color: "#0e1626" }],
  },
  {
    featureType: "water",
    elementType: "labels.text.fill",
    stylers: [{ color: "#4e6d70" }],
  },
];

export const MapService = {
  map: null,
  userMarker: null,
  radiusCircle: null,
  placeMarkers: [],
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

    const mapOptions = {
      center: center,
      zoom: 14,
      styles: DARK_MAP_STYLE,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false,
      zoomControl: true
    };

    if (window.google?.maps?.ControlPosition?.RIGHT_BOTTOM) {
      mapOptions.zoomControlOptions = {
        position: window.google.maps.ControlPosition.RIGHT_BOTTOM
      };
    }

    this.map = new google.maps.Map(container, mapOptions);

    this.currentInfoWindow = new google.maps.InfoWindow();

    // 點擊地圖更換中心位置
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
   * 更新使用者目前 GPS 定位點與搜尋半徑圓圈
   */
  updateUserLocation(lat, lng, radiusKm = 5) {
    if (!this.map) return;

    const center = { lat, lng };

    const circleSymbol = window.google?.maps?.SymbolPath?.CIRCLE ?? 0;

    // 使用者位置 Marker
    if (this.userMarker) {
      this.userMarker.setPosition(center);
    } else {
      this.userMarker = new google.maps.Marker({
        position: center,
        map: this.map,
        title: '📍 您的目前位置',
        zIndex: 9999,
        icon: {
          path: circleSymbol,
          scale: 8,
          fillColor: '#3b82f6',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3,
        }
      });
    }

    // 半徑圓圈 (公尺)
    const radiusMeters = radiusKm * 1000;
    if (this.radiusCircle) {
      this.radiusCircle.setCenter(center);
      this.radiusCircle.setRadius(radiusMeters);
    } else {
      this.radiusCircle = new google.maps.Circle({
        strokeColor: '#f97316',
        strokeOpacity: 0.85,
        strokeWeight: 2,
        fillColor: '#f97316',
        fillOpacity: 0.08,
        map: this.map,
        center: center,
        radius: radiusMeters,
      });
    }

    // 自動縮放視野符合半徑
    this.map.fitBounds(this.radiusCircle.getBounds());
  },

  /**
   * 標記店家清單
   */
  renderPlaces(places, onMarkerClick = null) {
    if (!this.map) return;

    // 清除舊的 Markers
    this.placeMarkers.forEach(m => m.setMap(null));
    this.placeMarkers = [];

    places.forEach((place) => {
      if (!place.lat || !place.lng) return;

      const isCurrentlyOpen = place.isOpen === true;
      const markerColor = isCurrentlyOpen ? '#10b981' : (place.isOpen === false ? '#ef4444' : '#f59e0b');

      const marker = new google.maps.Marker({
        position: { lat: place.lat, lng: place.lng },
        map: this.map,
        title: place.name,
        icon: {
          path: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z',
          fillColor: markerColor,
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 1.5,
          scale: 1.4,
          anchor: new google.maps.Point(12, 22),
        }
      });

      // InfoWindow 內容
      const contentString = `
        <div style="color: #0f172a; font-family: 'Noto Sans TC', sans-serif; padding: 4px 6px; max-width: 260px;">
          <div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 3px;">
            ${place.category || '餐飲美食'} · <span style="color: ${markerColor};">${isCurrentlyOpen ? '● 營業中' : (place.isOpen === false ? '● 已打烊' : '● 時段待確認')}</span>
          </div>
          <h4 style="font-size: 15px; font-weight: 800; margin: 0 0 6px 0; color: #0f172a; line-height: 1.3;">${place.name}</h4>
          <div style="font-size: 12px; color: #475569; margin-bottom: 4px;">
            🕒 <strong>今日：</strong>${place.todayHoursText || '未提供'}
          </div>
          <div style="font-size: 12px; color: #475569; margin-bottom: 4px;">
            📍 <strong>距離：</strong>${place.distanceText}
          </div>
          <div style="font-size: 11px; color: #64748b; margin-bottom: 8px; word-break: break-all;">
            🏠 ${place.address}
          </div>
          <div style="display: flex; gap: 6px;">
            <a href="${place.googleMapsUrl}" target="_blank" rel="noopener noreferrer" style="flex: 1; text-align: center; background: #2563eb; color: white; text-decoration: none; padding: 5px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">
              Google Maps
            </a>
            <a href="${place.directionsUrl}" target="_blank" rel="noopener noreferrer" style="flex: 1; text-align: center; background: #0f172a; color: white; text-decoration: none; padding: 5px 8px; border-radius: 6px; font-size: 11px; font-weight: 700;">
              導航前往
            </a>
          </div>
        </div>
      `;

      marker.addListener('click', () => {
        if (this.currentInfoWindow) {
          this.currentInfoWindow.setContent(contentString);
          this.currentInfoWindow.open(this.map, marker);
        }
        if (onMarkerClick) {
          onMarkerClick(place, marker);
        }
      });

      this.placeMarkers.push(marker);
    });
  },

  /**
   * 平移並聚焦至特定座標
   */
  focusPlace(lat, lng) {
    if (!this.map) return;
    this.map.panTo({ lat, lng });
    this.map.setZoom(16);
  }
};
