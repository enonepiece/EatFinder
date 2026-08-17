/**
 * googleService.js - Google Places API (New) 整合服務
 */

import { GeoService } from './geo.js';
import { Config } from './config.js';

export const GoogleService = {
  cache: new Map(), // 5 分鐘記憶體快取，避免短時間內重複呼叫 API

  getApiKey() {
    return Config.getGoogleApiKey();
  },

  setApiKey(key) {
    Config.setGoogleApiKey(key);
    this.cache.clear(); // 切換 Key 時清空快取
  },

  hasApiKey() {
    return Config.hasGoogleApiKey();
  },

  /**
   * 使用 Google Places API (New) searchNearby 搜尋半徑內的餐飲店家
   * 針對「全部」類別：發起兩個並行請求（各 20 筆，不同類型群組）合併去重，最多 40 筆
   */
  async fetchNearbyPlaces(lat, lng, radiusKm = 5, category = 'all') {
    const cacheKey = `${lat.toFixed(2)}_${lng.toFixed(2)}_${radiusKm}_${category}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 5 * 60 * 1000)) {
      console.log('⚡ 使用 Google Places 快取資料');
      return cached.data;
    }

    const radiusMeters = Math.min(radiusKm * 1000, 50000);

    // ==============================================================
    // 類型群組定義
    // 群組 A：主流餐廳、速食、咖啡
    // 群組 B：特色料理、飲品、小吃、夜市、甜點
    // 兩個群組並行發送，各 20 筆上限，合併後去重
    // ==============================================================
    const TYPE_GROUPS = {
      all: [
        // 群組 A
        ['restaurant', 'fast_food_restaurant', 'cafe', 'meal_takeaway', 'meal_delivery',
         'bakery', 'bar', 'food_court'],
        // 群組 B
        ['chinese_restaurant', 'japanese_restaurant', 'korean_restaurant',
         'american_restaurant', 'pizza_restaurant', 'ramen_restaurant',
         'ice_cream_shop', 'brunch_restaurant', 'sandwich_shop', 'seafood_restaurant',
         'steak_house', 'vegetarian_restaurant', 'thai_restaurant', 'vietnamese_restaurant']
      ],
      restaurant: [
        ['restaurant', 'chinese_restaurant', 'japanese_restaurant', 'korean_restaurant',
         'american_restaurant', 'pizza_restaurant', 'ramen_restaurant',
         'seafood_restaurant', 'steak_house', 'vegetarian_restaurant',
         'thai_restaurant', 'vietnamese_restaurant', 'brunch_restaurant',
         'sandwich_shop', 'food_court']
      ],
      cafe: [
        ['cafe', 'coffee_shop', 'brunch_restaurant', 'bakery']
      ],
      fast_food: [
        ['fast_food_restaurant', 'meal_takeaway', 'meal_delivery', 'sandwich_shop']
      ],
      bakery: [
        ['bakery', 'cafe', 'ice_cream_shop']
      ],
      drink: [
        ['cafe', 'coffee_shop', 'bar', 'ice_cream_shop']
      ]
    };

    const typeGroups = TYPE_GROUPS[category] || TYPE_GROUPS.all;

    // 發起並行請求
    const requests = typeGroups.map(types => this._fetchWithTypes(lat, lng, radiusMeters, types));
    const results = await Promise.allSettled(requests);

    // 合併結果並去重（以 place id 為 key）
    const mergedMap = new Map();
    let hasSuccess = false;

    for (const result of results) {
      if (result.status === 'fulfilled') {
        hasSuccess = true;
        const places = result.value?.places || [];
        for (const p of places) {
          if (!mergedMap.has(p.id)) mergedMap.set(p.id, p);
        }
      } else {
        console.warn('部分請求失敗:', result.reason);
      }
    }

    if (!hasSuccess) {
      // 全部失敗，拋出最後一個錯誤
      const lastErr = results.find(r => r.status === 'rejected');
      throw new Error(lastErr?.reason?.message || 'Google Places API 請求失敗');
    }

    const normalized = this.normalizePlaces(Array.from(mergedMap.values()), lat, lng);
    console.log(`📍 合併後共 ${normalized.length} 間店家（${typeGroups.length} 個請求群組）`);

    this.cache.set(cacheKey, { data: normalized, timestamp: Date.now() });
    return normalized;
  },

  /**
   * 單次請求（優先 Cloudflare Proxy → 直連 Fallback）
   */
  async _fetchWithTypes(lat, lng, radiusMeters, includedTypes) {
    const requestBody = {
      includedTypes,
      maxResultCount: 20,
      languageCode: 'zh-TW',
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters
        }
      }
    };

    // 1. Cloudflare Proxy
    try {
      const proxyRes = await fetch('/api/places', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      if (proxyRes.ok) {
        return await proxyRes.json();
      }
      const errData = await proxyRes.json().catch(() => ({}));
      throw new Error(errData?.error?.message || `Proxy 錯誤 (${proxyRes.status})`);
    } catch (proxyErr) {
      console.warn('Proxy 失敗，嘗試直連:', proxyErr.message);

      // 2. 直連 Fallback（本機開發用）
      const apiKey = await Config.resolveApiKey();
      if (!apiKey) throw new Error(proxyErr.message || '未設定 API Key');

      const response = await fetch('https://places.googleapis.com/v1/places:searchNearby', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-Language-Code': 'zh-TW',
          'X-Goog-FieldMask': 'places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours,places.regularOpeningHours,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.priceLevel,places.primaryType'
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Google Places API 錯誤 (${response.status})`);
      }
      return await response.json();
    }
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

      // 價位：新版 Places API 回傳字串，舊版回傳整數，統一轉為數字
      const PRICE_MAP = {
        'PRICE_LEVEL_FREE': 0,
        'PRICE_LEVEL_INEXPENSIVE': 1,
        'PRICE_LEVEL_MODERATE': 2,
        'PRICE_LEVEL_EXPENSIVE': 3,
        'PRICE_LEVEL_VERY_EXPENSIVE': 4
      };
      const rawPrice = p.priceLevel;
      let priceLevelNum = null;
      if (typeof rawPrice === 'number') {
        priceLevelNum = rawPrice;
      } else if (typeof rawPrice === 'string' && PRICE_MAP[rawPrice] !== undefined) {
        priceLevelNum = PRICE_MAP[rawPrice];
      }
      const priceLevelDisplay = priceLevelNum !== null && priceLevelNum > 0
        ? '💲'.repeat(priceLevelNum)
        : null;

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
        priceLevel: priceLevelDisplay,
        priceLevelNum: priceLevelNum,
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

