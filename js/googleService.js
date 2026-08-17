/**
 * googleService.js - Google Places API (New) 整合服務
 * 支援多通道並行搜尋（searchNearby 結構化類型 + searchText 中文語意小吃搜尋）
 */

import { GeoService } from './geo.js';
import { Config } from './config.js';

export const GoogleService = {
  cache: new Map(),

  getApiKey() {
    return Config.getGoogleApiKey();
  },

  setApiKey(key) {
    Config.setGoogleApiKey(key);
    this.cache.clear();
  },

  hasApiKey() {
    return Config.hasGoogleApiKey();
  },

  /**
   * 使用 Google Places API (New) 搜尋半徑內的餐飲店家
   * 結合結構化類型 (searchNearby) 與中文小吃語意 (searchText)，確保在地小吃、便當、麵攤全面涵蓋
   */
  async fetchNearbyPlaces(lat, lng, radiusKm = 3, category = 'all') {
    const cacheKey = `${lat.toFixed(3)}_${lng.toFixed(3)}_${radiusKm}_${category}`;
    const cached = this.cache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 5 * 60 * 1000)) {
      console.log('⚡ 使用 Google Places 快取資料');
      return cached.data;
    }

    const radiusMeters = Math.min(radiusKm * 1000, 50000);

    // 建立多通道搜尋任務清單
    const searchTasks = [];

    if (category === 'all') {
      // 通道 1：主流正餐與各國料理 (searchNearby)
      searchTasks.push(this._fetchNearby(lat, lng, radiusMeters, [
        'restaurant', 'chinese_restaurant', 'japanese_restaurant', 'korean_restaurant',
        'ramen_restaurant', 'sushi_restaurant', 'fast_food_restaurant', 'meal_takeaway'
      ]));

      // 通道 2：在地小吃、便當、麵店、夜市美食 (searchText - 補足 Google 類型未細分的台灣在地小吃)
      searchTasks.push(this._fetchTextSearch(lat, lng, radiusMeters, '小吃 麵店 便當 滷味 早餐 餐廳 美食'));

      // 通道 3：早午餐、咖啡、甜點、烘焙 (searchNearby)
      searchTasks.push(this._fetchNearby(lat, lng, radiusMeters, [
        'cafe', 'coffee_shop', 'bakery', 'brunch_restaurant',
        'sandwich_shop', 'ice_cream_shop', 'food_court'
      ]));

    } else if (category === 'restaurant') {
      searchTasks.push(this._fetchNearby(lat, lng, radiusMeters, [
        'restaurant', 'chinese_restaurant', 'japanese_restaurant', 'korean_restaurant',
        'american_restaurant', 'pizza_restaurant', 'ramen_restaurant', 'sushi_restaurant',
        'seafood_restaurant', 'steak_house', 'thai_restaurant', 'vietnamese_restaurant',
        'italian_restaurant', 'brunch_restaurant', 'vegetarian_restaurant'
      ]));
      searchTasks.push(this._fetchTextSearch(lat, lng, radiusMeters, '小吃 麵店 便當 餐廳 美食'));

    } else if (category === 'cafe') {
      searchTasks.push(this._fetchNearby(lat, lng, radiusMeters, ['cafe', 'coffee_shop', 'brunch_restaurant', 'bakery']));
      searchTasks.push(this._fetchTextSearch(lat, lng, radiusMeters, '咖啡廳 早午餐 下午茶 甜點'));

    } else if (category === 'fast_food') {
      searchTasks.push(this._fetchNearby(lat, lng, radiusMeters, ['fast_food_restaurant', 'meal_takeaway', 'meal_delivery', 'sandwich_shop', 'hamburger_restaurant']));
      searchTasks.push(this._fetchTextSearch(lat, lng, radiusMeters, '速食 漢堡 炸雞 披薩 外帶'));

    } else if (category === 'bakery') {
      searchTasks.push(this._fetchNearby(lat, lng, radiusMeters, ['bakery', 'cafe', 'ice_cream_shop']));
      searchTasks.push(this._fetchTextSearch(lat, lng, radiusMeters, '麵包店 烘焙 甜點 蛋糕'));

    } else if (category === 'drink') {
      searchTasks.push(this._fetchNearby(lat, lng, radiusMeters, ['cafe', 'coffee_shop', 'bar', 'ice_cream_shop']));
      searchTasks.push(this._fetchTextSearch(lat, lng, radiusMeters, '手搖飲料 豆花 果汁 冰品 飲料店'));
    }

    // 並行執行所有搜尋任務
    const results = await Promise.allSettled(searchTasks);

    const mergedMap = new Map();
    let hasSuccess = false;

    for (const res of results) {
      if (res.status === 'fulfilled' && Array.isArray(res.value?.places)) {
        hasSuccess = true;
        for (const p of res.value.places) {
          if (!mergedMap.has(p.id)) {
            mergedMap.set(p.id, p);
          }
        }
      } else if (res.status === 'rejected') {
        console.warn('部分搜尋通道失敗:', res.reason?.message);
      }
    }

    if (!hasSuccess) {
      const firstError = results.find(r => r.status === 'rejected');
      throw new Error(firstError?.reason?.message || 'Google Places 搜尋失敗');
    }

    // 格式化並過濾半徑（避免 searchText 飄太遠）
    const allPlaces = Array.from(mergedMap.values());
    const normalized = this.normalizePlaces(allPlaces, lat, lng)
      .filter(p => p.distanceKm <= (radiusKm + 0.3)); // 允許微小緩衝

    console.log(`📍 合併多通道搜尋結果，共取得 ${normalized.length} 間在地店家（類別：${category}）`);

    this.cache.set(cacheKey, { data: normalized, timestamp: Date.now() });
    return normalized;
  },

  /**
   * 通道 1: searchNearby 搜尋
   */
  async _fetchNearby(lat, lng, radiusMeters, includedTypes) {
    const requestBody = {
      endpoint: 'searchNearby',
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
    return this._postPlacesApi(requestBody);
  },

  /**
   * 通道 2: searchText 語意搜尋（涵蓋在地小吃、便當、麵攤）
   */
  async _fetchTextSearch(lat, lng, radiusMeters, query) {
    const requestBody = {
      endpoint: 'searchText',
      textQuery: query,
      pageSize: 20,
      languageCode: 'zh-TW',
      locationBias: {
        circle: {
          center: { latitude: lat, longitude: lng },
          radius: radiusMeters
        }
      }
    };
    return this._postPlacesApi(requestBody);
  },

  /**
   * 統一呼叫 Cloudflare Proxy (帶本機直連 fallback)
   */
  async _postPlacesApi(requestBody) {
    const endpoint = requestBody.endpoint || 'searchNearby';

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

      // 2. 本機直連 Fallback
      const apiKey = await Config.resolveApiKey();
      if (!apiKey) throw new Error(proxyErr.message || '未設定 API Key');

      const url = `https://places.googleapis.com/v1/places:${endpoint}`;
      const payload = { ...requestBody };
      delete payload.endpoint;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Goog-Api-Key': apiKey,
          'X-Goog-Language-Code': 'zh-TW',
          'X-Goog-FieldMask': [
            'places.id', 'places.displayName', 'places.formattedAddress',
            'places.location', 'places.rating', 'places.userRatingCount',
            'places.currentOpeningHours', 'places.regularOpeningHours',
            'places.googleMapsUri', 'places.websiteUri', 'places.nationalPhoneNumber',
            'places.priceLevel', 'places.primaryType'
          ].join(',')
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const errJson = await response.json().catch(() => ({}));
        throw new Error(errJson?.error?.message || `Google Places API 錯誤 (${response.status})`);
      }
      return await response.json();
    }
  },

  /**
   * 統一正規化店家資料
   */
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
        const dayIdx = new Date().getDay();
        const desc = openingHours.weekdayDescriptions[dayIdx === 0 ? 6 : dayIdx - 1] || openingHours.weekdayDescriptions[0];
        const timePart = desc.split(': ').slice(1).join(': ') || desc;
        todayHoursText = timePart;

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

      // 價位
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
        category: this.formatCategory(p.primaryType, name),
        categoryIcon: this.getCategoryIcon(p.primaryType, name),
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

  formatCategory(type, name = '') {
    if (name.includes('小吃') || name.includes('麵攤') || name.includes('滷肉飯') || name.includes('肉圓')) return '在地小吃';
    if (name.includes('便當') || name.includes('自助餐')) return '便當快餐';
    if (name.includes('飲料') || name.includes('茶') || name.includes('波霸') || name.includes('豆花')) return '手搖飲品';
    if (name.includes('早午餐') || name.includes('早餐') || name.includes('美而美')) return '早午餐';
    if (name.includes('拉麵')) return '拉麵料理';
    if (name.includes('火鍋') || name.includes('鍋物')) return '火鍋料理';
    if (name.includes('咖啡')) return '咖啡甜點';

    const map = {
      'restaurant': '精選美食',
      'chinese_restaurant': '中式小吃/料理',
      'japanese_restaurant': '日式料理',
      'korean_restaurant': '韓式料理',
      'ramen_restaurant': '拉麵',
      'sushi_restaurant': '壽司料理',
      'fast_food_restaurant': '速食外帶',
      'cafe': '咖啡廳',
      'coffee_shop': '咖啡店',
      'bakery': '烘焙坊',
      'bar': '餐酒館',
      'meal_takeaway': '外帶小吃',
      'food_court': '美食廣場',
      'brunch_restaurant': '早午餐',
      'sandwich_shop': '三明治小吃',
      'ice_cream_shop': '甜品冰店'
    };
    return map[type] || '餐飲小吃';
  },

  getCategoryIcon(type, name = '') {
    if (name.includes('麵') || type === 'ramen_restaurant') return '🍜';
    if (name.includes('便當') || name.includes('飯')) return '🍱';
    if (name.includes('飲料') || name.includes('茶')) return '🧋';
    if (name.includes('咖啡') || type === 'cafe' || type === 'coffee_shop') return '☕';
    if (name.includes('火鍋')) return '🍲';
    if (name.includes('壽司') || type === 'sushi_restaurant') return '🍣';
    if (name.includes('漢堡') || type === 'fast_food_restaurant') return '🍔';
    if (name.includes('麵包') || type === 'bakery') return '🥐';
    if (name.includes('冰') || type === 'ice_cream_shop') return '🍧';
    return '🍽️';
  }
};
