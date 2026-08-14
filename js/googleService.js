/**
 * googleService.js - Google Places API (New) 整合服務
 */

import { GeoService } from './geo.js';

export const GoogleService = {
  getApiKey() {
    return localStorage.getItem('eatfinder_google_api_key') || '';
  },

  setApiKey(key) {
    if (key) {
      localStorage.setItem('eatfinder_google_api_key', key.trim());
    } else {
      localStorage.removeItem('eatfinder_google_api_key');
    }
  },

  hasApiKey() {
    return Boolean(this.getApiKey());
  },

  /**
   * 使用 Google Places API (New) searchNearby 搜尋半徑內的餐廳
   * @param {number} lat 
   * @param {number} lng 
   * @param {number} radiusKm 
   * @param {string} category 
   */
  async fetchNearbyPlaces(lat, lng, radiusKm = 10, category = 'all') {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error('未設定 Google Places API Key');
    }

    const radiusMeters = Math.min(radiusKm * 1000, 10000); // Places API 最大半徑支援 50000m
    const url = 'https://places.googleapis.com/v1/places:searchNearby';

    let includedTypes = ['restaurant', 'cafe', 'fast_food_restaurant', 'bakery', 'meal_takeaway'];
    if (category === 'restaurant') includedTypes = ['restaurant'];
    if (category === 'cafe') includedTypes = ['cafe', 'coffee_shop'];
    if (category === 'fast_food') includedTypes = ['fast_food_restaurant', 'meal_takeaway'];
    if (category === 'bakery') includedTypes = ['bakery'];

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
        'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours,places.regularOpeningHours,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.priceLevel,places.primaryType'
      },
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errJson = await response.json().catch(() => ({}));
      throw new Error(errJson?.error?.message || `Google Places API 錯誤 (${response.status})`);
    }

    const data = await response.json();
    return this.normalizePlaces(data.places || [], lat, lng);
  },

  normalizePlaces(places, userLat, userLng) {
    const dayOfWeek = (new Date().getDay() + 6) % 7; // Google weekdayDescriptions 通常週一為 0 或有指定

    return places.map(p => {
      const elLat = p.location?.latitude;
      const elLng = p.location?.longitude;
      const distanceKm = (elLat && elLng) ? GeoService.calculateDistance(userLat, userLng, elLat, elLng) : 0;
      const name = p.displayName?.text || '未知餐廳';
      const address = p.formattedAddress || '未提供地址';

      // 營業時間
      const openingHours = p.currentOpeningHours || p.regularOpeningHours;
      const isOpen = openingHours?.openNow ?? null;
      let todayHoursText = '未提供時段';
      if (openingHours?.weekdayDescriptions && openingHours.weekdayDescriptions.length > 0) {
        // 取得當天的描述
        const dayIdx = new Date().getDay(); // 0 是週日
        const desc = openingHours.weekdayDescriptions[dayIdx === 0 ? 6 : dayIdx - 1] || openingHours.weekdayDescriptions[0];
        todayHoursText = desc.split(': ').slice(1).join(': ') || desc;
      }

      let statusText = '營業時間未提供';
      if (isOpen === true) {
        statusText = '營業中';
      } else if (isOpen === false) {
        statusText = '已打烊 / 休息中';
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
