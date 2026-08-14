/**
 * geo.js - GPS 定位與地理計算模組
 */

export const GeoService = {
  /**
   * 取得使用者目前 GPS 位置
   * @param {Object} options
   * @returns {Promise<{lat: number, lng: number, accuracy: number}>}
   */
  getCurrentPosition(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('您的瀏覽器不支援 GPS 地理定位功能'));
        return;
      }

      const defaultOptions = {
        enableHighAccuracy: true,
        timeout: 12000,
        maximumAge: 60000,
        ...options
      };

      navigator.geolocation.getCurrentPosition(
        (pos) => {
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            accuracy: pos.coords.accuracy
          });
        },
        (err) => {
          let msg = '無法取得定位';
          switch (err.code) {
            case err.PERMISSION_DENIED:
              msg = '您已拒絕位置存取授權。請於瀏覽器網址列旁開啟定位權限，或使用手動定位。';
              break;
            case err.POSITION_UNAVAILABLE:
              msg = '無法獲取目前位置資訊，請檢查裝置的 GPS 或網路狀態。';
              break;
            case err.TIMEOUT:
              msg = '定位請求逾時，請再試一次。';
              break;
          }
          const error = new Error(msg);
          error.code = err.code;
          reject(error);
        },
        defaultOptions
      );
    });
  },

  /**
   * 使用 Haversine 公式計算兩點經緯度間的直線距離 (公里)
   * @param {number} lat1 
   * @param {number} lon1 
   * @param {number} lat2 
   * @param {number} lon2 
   * @returns {number} 距離 (公里)
   */
  calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371; // 地球平均半徑 (公里)
    const dLat = this.deg2rad(lat2 - lat1);
    const dLon = this.deg2rad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.deg2rad(lat1)) * Math.cos(this.deg2rad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  },

  deg2rad(deg) {
    return deg * (Math.PI / 180);
  },

  /**
   * 格式化距離字串
   * @param {number} km 
   * @returns {string} 例如 "650 m" 或 "3.2 km"
   */
  formatDistance(km) {
    if (km < 1) {
      return `${Math.round(km * 1000)} m`;
    }
    return `${km.toFixed(1)} km`;
  },

  /**
   * 產生 Google Maps 搜尋 / 導航連結
   * @param {string} name 店名
   * @param {string} address 地址
   * @param {number} lat 緯度
   * @param {number} lng 經度
   * @returns {string} URL
   */
  generateGoogleMapsUrl(name, address, lat, lng) {
    if (lat && lng && name) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}&query_place_id=&center=${lat},${lng}`;
    } else if (address) {
      return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent((name ? name + ' ' : '') + address)}`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  },

  /**
   * 產生 Google Maps 導航連結
   */
  generateDirectionsUrl(lat, lng, name = '') {
    return `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&destination_place_id=&travelmode=walking`;
  },

  /**
   * 使用 Nominatim 反向地理編碼取得目前地址/地名
   * @param {number} lat 
   * @param {number} lng 
   * @returns {Promise<string>}
   */
  async reverseGeocode(lat, lng) {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&accept-language=zh-TW,zh,en`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) throw new Error('Geocoding network response error');
      const data = await res.json();
      return data.display_name || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    } catch (e) {
      console.warn('Reverse geocoding failed:', e);
      return `座標: ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    }
  },

  /**
   * 地址/地名搜尋正向地理編碼
   * @param {string} query 
   * @returns {Promise<Array<{name: string, lat: number, lng: number}>>}
   */
  async forwardGeocode(query) {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&accept-language=zh-TW,zh,en`;
      const res = await fetch(url, {
        headers: { 'Accept': 'application/json' }
      });
      if (!res.ok) return [];
      const data = await res.json();
      return data.map(item => ({
        name: item.display_name,
        lat: parseFloat(item.lat),
        lng: parseFloat(item.lon)
      }));
    } catch (e) {
      console.error('Forward geocoding error:', e);
      return [];
    }
  }
};
