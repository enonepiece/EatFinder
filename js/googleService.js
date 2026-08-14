/**
 * googleService.js - Google Places API (New) 整合服務
 */

import { GeoService } from './geo.js';

export const GoogleService = {
  cache: new Map(), // 5 分鐘記憶體快取，避免短時間內重複呼叫 API

  getApiKey() {
    return localStorage.getItem('eatfinder_google_api_key') || '';
  },

  setApiKey(key) {
    if (key) {
      localStorage.setItem('eatfinder_google_api_key', key.trim());
    } else {
      localStorage.removeItem('eatfinder_google_api_key');
    }
    this.cache.clear(); // 切換 Key 時清空快取
  },

  hasApiKey() {
    return Boolean(this.getApiKey());
  },

  /**
   * 使用 Google Places API (New) searchNearby 搜尋半徑內的餐廳
   */
  async fetchNearbyPlaces(lat, lng, radiusKm = 5, category = 'all') {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('未設定 Google Places API Key');
    }

    // 快取機制 (座標精準到小數點後 2 位約 1km，半徑與類別相同時直接命中快取)
    const cacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}_${radiusKm}_${category}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 5 * 60 * 1000)) {
      console.log('⚡ 使用 Google Places 快取資料 (節省 API 配額)');
      return cached.data;
    }

    const radiusMeters = Math.min(radiusKm * 1000, 10000);
    const url = 'https://places.googleapis.com/v1/places:searchNearby';

    let includedTypes = ['restaurant', 'cafe', 'fast_food_restaurant', 'bakery', 'meal_takeaway'];
    if (category === 'restaurant') includedTypes = ['restaurant'];
    if (category === 'cafe') includedTypes = ['cafe', 'coffee_shop'];
    if (category === 'fast_food') includedTypes = ['fast_food_restaurant', 'meal_takeaway'];
    if (category === 'bakery') includedTypes = ['bakery'];
    if (category === 'drink') includedTypes = ['cafe', 'coffee_shop'];

    const requestBody = {
      includedTypes: includedTypes,
      maxResultCount: 20,
      locationRestriction: {
        circle: {
          center: {
            latitude: lat,
            longitude: lng
          },
          radius: radiusMeters
        }
      }
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        // 精簡 FieldMask 只抓必要欄位，降低成本與流量
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours,places.regularOpeningHours,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.priceLevel,places.primaryType'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `Google Places API 錯誤 (${response.status})`);
    }

    const data = await response.json();
    const normalized = this.normalizePlaces(data.places || [], lat, lng);

    // 存入快取
    this.cache.set(cacheKey, {
      data: normalized,
      timestamp: Date.now()
    });

    return normalized;
  },

  normalizePlaces(places, userLat, userLng) {
    return places.map(p => {
      const elLat = p.location?.latitude;
      const elLng = p.location?.longitude;
      const distanceKm = (elLat && elLng) ? GeoService.calculateDistance(userLat, userLng, elLat, elLng) : 0;
      const name = p.displayName?.text || '未知餐廳';
      const address = p.formattedAddress || '未提供地址';

      // 營業時間
      const openingHours = p.currentOpeningHours || p.regularOpeningHours;
      const isOpen = openingHours?.openNow ?? null;
      let todayHoursText = '依現場公告為準';
      let closeMinutes = -1;

      if (openingHours?.weekdayDescriptions && openingHours.weekdayDescriptions.length > 0) {
        const dayIdx = new Date().getDay(); // 0 是週日
        const desc = openingHours.weekdayDescriptions[dayIdx === 0 ? 6 : dayIdx - 1] || openingHours.weekdayDescriptions[0];
        const timePart = desc.split(': ').slice(1).join(': ') || desc;
        todayHoursText = timePart;

        // 嘗試粗估打烊時間分鐘數
        const match = timePart.match(/(\d{1,2}):(\d{2})\s*(?:PM|AM)?$/i);
        if (match) {
          let h = parseInt(match[1], 10);
          const m = parseInt(match[2], 10);
          if (/PM/i.test(timePart) && h < 12) h += 12;
          closeMinutes = h * 60 + m;
        } else if (isOpen) {
          closeMinutes = 1440;
        }
      }

      let statusText = '營業時間未定';
      if (isOpen === true) {
        statusText = '營業中';
      } else if (isOpen === false) {
        statusText = '本日已打烊';
      }

      const googleMapsUrl = p.googleMapsUri || GeoService.generateGoogleMapsUrl(name, address, elLat, elLng);
      const directionsUrl = (elLat && elLng) ? GeoService.generateDirectionsUrl(elLat, elLng, name) : googleMapsUrl;

      return {
        id: `google_${p.id}`,
        name: name,
        category: this.formatCategory(p.primaryType),
        categoryIcon: '🍽️',
        lat: elLat,
        lng: elLng,
        distanceKm: distanceKm,
        distanceText: GeoService.formatDistance(distanceKm),
        address: address,
        phone: p.nationalPhoneNumber || null,
        website: p.websiteUri || null,
        rating: p.rating || null,
        userRatingCount: p.userRatingCount || null,
        priceLevel: p.priceLevel ? '💲'.repeat(p.priceLevel) : null,
        isOpen: isOpen,
        statusText: statusText,
        todayHoursText: todayHoursText,
        closeMinutes: closeMinutes,
        googleMapsUrl: googleMapsUrl,
        directionsUrl: directionsUrl,
        source: 'Google'
      };
    }).sort((a, b) => a.distanceKm - b.distanceKm);
  },

  formatCategory(type) {
    const map = {
      'restaurant': '餐廳',
      'cafe': '咖啡廳',
      'coffee_shop': '咖啡店',
      'fast_food_restaurant': '速食餐廳',
      'bakery': '烘焙坊',
      'bar': '酒吧',
      'meal_takeaway': '外帶美食'
    };
    return map[type] || '餐飲美食';
  }
};

