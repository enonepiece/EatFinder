/**
 * mapService.js - Leaflet 互動地圖服務
 */

export const MapService = {
  map: null,
  userMarker: null,
  radiusCircle: null,
  placeMarkersGroup: null,
  onLocationSelectCallback: null,

  /**
   * 初始化 Leaflet 地圖
   * @param {string} containerId 
   * @param {number} defaultLat 
   * @param {number} defaultLng 
   * @param {Function} onLocationSelected 
   */
  init(containerId = 'map', defaultLat = 25.0330, defaultLng = 121.5654, onLocationSelected = null) {
    if (this.map) {
      this.map.remove();
      this.map = null;
    }

    this.onLocationSelectCallback = onLocationSelected;

    // 建立地圖
    this.map = L.map(containerId, {
      center: [defaultLat, defaultLng],
      zoom: 13,
      zoomControl: false
    });

    // 加入縮放控制在右下角
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    // 套用高質感 Dark/CartoDB 向量地圖圖層
    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19
    }).addTo(this.map);

    // Marker 群組
    this.placeMarkersGroup = L.layerGroup().addTo(this.map);

    // 點擊地圖自訂位置
    this.map.on('click', (e) => {
      if (this.onLocationSelectCallback) {
        this.onLocationSelectCallback(e.latlng.lat, e.latlng.lng);
      }
    });

    return this.map;
  },

  /**
   * 更新使用者目前 GPS 定位點與搜尋半徑圓圈
   * @param {number} lat 
   * @param {number} lng 
   * @param {number} radiusKm 
   */
  updateUserLocation(lat, lng, radiusKm = 10) {
    if (!this.map) return;

    const latlng = [lat, lng];

    // 自訂使用者定位波紋 Icon
    const userIcon = L.divIcon({
      className: 'user-location-marker-container',
      html: `
        <div class="user-location-marker">
          <div class="pulse-ring"></div>
          <div class="center-dot"></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12]
    });

    if (this.userMarker) {
      this.userMarker.setLatLng(latlng);
    } else {
      this.userMarker = L.marker(latlng, { icon: userIcon, zIndexOffset: 1000 }).addTo(this.map);
      this.userMarker.bindPopup('<b>📍 您目前的位置</b><br><small>點擊地圖任一處可更換搜尋中心點</small>');
    }

    // 半徑圓圈
    const radiusMeters = radiusKm * 1000;
    if (this.radiusCircle) {
      this.radiusCircle.setLatLng(latlng);
      this.radiusCircle.setRadius(radiusMeters);
    } else {
      this.radiusCircle = L.circle(latlng, {
        radius: radiusMeters,
        color: '#f97316',
        weight: 1.5,
        opacity: 0.8,
        fillColor: '#f97316',
        fillOpacity: 0.08,
        dashArray: '6, 6'
      }).addTo(this.map);
    }

    // 自動視角縮放符合半徑
    this.map.fitBounds(this.radiusCircle.getBounds(), { padding: [30, 30] });
  },

  /**
   * 標記店家清單
   * @param {Array<Object>} places 
   * @param {Function} onMarkerClick 
   */
  renderPlaces(places, onMarkerClick = null) {
    if (!this.placeMarkersGroup) return;
    this.placeMarkersGroup.clearLayers();

    places.forEach((place, index) => {
      if (!place.lat || !place.lng) return;

      const isCurrentlyOpen = place.isOpen === true;
      const markerColorClass = isCurrentlyOpen ? 'marker-open' : (place.isOpen === false ? 'marker-closed' : 'marker-unknown');

      const customIcon = L.divIcon({
        className: 'place-custom-marker',
        html: `
          <div class="place-marker-bubble ${markerColorClass}">
            <span class="place-marker-emoji">${place.categoryIcon || '🍽️'}</span>
          </div>
        `,
        iconSize: [34, 34],
        iconAnchor: [17, 34],
        popupAnchor: [0, -32]
      });

      const marker = L.marker([place.lat, place.lng], { icon: customIcon });

      // 精美 Popup 內容
      const popupHtml = `
        <div class="map-popup-card">
          <div class="popup-header">
            <span class="popup-category">${place.categoryIcon || ''} ${place.category || '餐飲'}</span>
            <span class="popup-status ${isCurrentlyOpen ? 'open' : (place.isOpen === false ? 'closed' : 'unknown')}">
              ${isCurrentlyOpen ? '● 營業中' : (place.isOpen === false ? '● 已打烊' : '● 時段未定')}
            </span>
          </div>
          <h4 class="popup-title">${place.name}</h4>
          <div class="popup-info">
            <div class="info-row">
              <span class="icon">🕒</span>
              <span><strong>今日時段：</strong>${place.todayHoursText || '未提供'}</span>
            </div>
            <div class="info-row">
              <span class="icon">📍</span>
              <span><strong>距離：</strong>${place.distanceText}</span>
            </div>
            <div class="info-row">
              <span class="icon">🏠</span>
              <span class="address-text">${place.address}</span>
            </div>
          </div>
          <div class="popup-actions">
            <a href="${place.googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="popup-btn btn-google">
              <span>在 Google Maps 查看</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>
            <a href="${place.directionsUrl}" target="_blank" rel="noopener noreferrer" class="popup-btn btn-nav">
              導航前往
            </a>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml, { maxWidth: 300, className: 'custom-leaflet-popup' });

      if (onMarkerClick) {
        marker.on('click', () => onMarkerClick(place, marker));
      }

      this.placeMarkersGroup.addLayer(marker);
    });
  },

  /**
   * 平移並聚焦至特定座標與彈出 Popup
   */
  focusPlace(lat, lng) {
    if (!this.map) return;
    this.map.setView([lat, lng], 16, { animate: true, duration: 0.8 });
  }
};
