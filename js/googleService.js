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
   *
   * Google Places API (New) 的 includedTypes 只支援 Table A 具體類型，
   * 不支援 "food" 這類父類別。
   * 策略：「全部」時列出所有官方支援的餐飲類型（最多 50 個），一次請求；
   * 特定類別則精確篩選。
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
    // Google Places API New - Table A 官方支援的所有餐飲類型
    // 參考：https://developers.google.com/maps/documentation/places/web-service/place-types
    // ==============================================================
    const ALL_FOOD_TYPES = [
      // 通用餐飲
      'restaurant', 'fast_food_restaurant', 'cafe', 'coffee_shop',
      'meal_takeaway', 'meal_delivery', 'food_court', 'bar', 'bakery',
      // 各國料理（官方支援）
      'american_restaurant', 'chinese_restaurant', 'french_restaurant',
      'greek_restaurant', 'hamburger_restaurant', 'indian_restaurant',
      'indonesian_restaurant', 'italian_restaurant', 'japanese_restaurant',
      'korean_restaurant', 'mediterranean_restaurant', 'mexican_restaurant',
      'middle_eastern_restaurant', 'pizza_restaurant', 'ramen_restaurant',
      'seafood_restaurant', 'spanish_restaurant', 'steak_house', 'sushi_restaurant',
      'thai_restaurant', 'turkish_restaurant', 'vegetarian_restaurant',
      'vietnamese_restaurant',
      // 特色類型（官方支援）
      'brunch_restaurant', 'ice_cream_shop', 'sandwich_shop'
    ];

    const CATEGORY_TYPES = {
      all:        ALL_FOOD_TYPES,
      restaurant: ['restaurant', 'chinese_restaurant', 'japanese_restaurant', 'korean_restaurant',
                   'american_restaurant', 'pizza_restaurant', 'ramen_restaurant', 'sushi_restaurant',
                   'seafood_restaurant', 'steak_house', 'thai_restaurant', 'vietnamese_restaurant',
                   'mediterranean_restaurant', 'mexican_restaurant', 'indian_restaurant', 'indonesian_restaurant',
                   'french_restaurant', 'italian_restaurant', 'greek_restaurant', 'spanish_restaurant',
                   'turkish_restaurant', 'brunch_restaurant', 'vegetarian_restaurant',
                   'food_court', 'hamburger_restaurant'],
      cafe:       ['cafe', 'coffee_shop', 'brunch_restaurant', 'bakery'],
      fast_food:  ['fast_food_restaurant', 'meal_takeaway', 'meal_delivery', 'sandwich_shop', 'hamburger_restaurant'],
      bakery:     ['bakery', 'cafe', 'ice_cream_shop'],
      drink:      ['cafe', 'coffee_shop', 'bar', 'ice_cream_shop']
    };

    const includedTypes = CATEGORY_TYPES[category] || ALL_FOOD_TYPES;

    const requestBody = {
      includedTypes,
      maxResultCount: 20,
      languageCode: 'zh-TW',
      rankPreference: 'DISTANCE',
      locationRestriction: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters
        }
      }
    };

    const data = await this._fetchWithTypes(lat, lng, radiusMeters, includedTypes);
    const normalized = this.normalizePlaces(data.places || [], lat, lng);
    console.log(`📍 取得 ${normalized.length} 間店家（類別：${category}，類型數：${includedTypes.length}）`);

    this.cache.set(cacheKey, { data: normalized, timestamp: Date.now() });
    return normalized;
  },
  /**
   * 單次請求實作（優先 Cloudflare Proxy → 直連 Fallback）
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

