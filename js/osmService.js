/**
 * osmService.js - OpenStreetMap Overpass API 查詢服務
 */

import { GeoService } from './geo.js';
import { OpeningHoursParser } from './openingHoursParser.js';

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter'
];

export const OsmService = {
  /**
   * 搜尋指定經緯度半徑內的餐飲店家
   * @param {number} lat 緯度
   * @param {number} lng 經度
   * @param {number} radiusKm 半徑 (公里，預設 10)
   * @param {string} [category] 分類篩選 ('all', 'restaurant', 'cafe', 'fast_food', 'snack', 'drink', 'bakery')
   * @returns {Promise<Array<Object>>}
   */
  async fetchNearbyPlaces(lat, lng, radiusKm = 10, category = 'all') {
    const radiusMeters = Math.min(Math.max(radiusKm, 0.5), 15) * 1000; // 最多 15km 防止過度查詢

    let categoryFilter = `
      nwr["amenity"="restaurant"](around:${radiusMeters},${lat},${lng});
      nwr["amenity"="cafe"](around:${radiusMeters},${lat},${lng});
      nwr["amenity"="fast_food"](around:${radiusMeters},${lat},${lng});
      nwr["amenity"="food_court"](around:${radiusMeters},${lat},${lng});
      nwr["amenity"="ice_cream"](around:${radiusMeters},${lat},${lng});
      nwr["shop"="bakery"](around:${radiusMeters},${lat},${lng});
      nwr["shop"="beverages"](around:${radiusMeters},${lat},${lng});
      nwr["amenity"="bar"](around:${radiusMeters},${lat},${lng});
      nwr["amenity"="pub"](around:${radiusMeters},${lat},${lng});
    `;

    if (category === 'restaurant') {
      categoryFilter = `nwr["amenity"="restaurant"](around:${radiusMeters},${lat},${lng});`;
    } else if (category === 'cafe') {
      categoryFilter = `nwr["amenity"="cafe"](around:${radiusMeters},${lat},${lng});`;
    } else if (category === 'fast_food') {
      categoryFilter = `nwr["amenity"="fast_food"](around:${radiusMeters},${lat},${lng});`;
    } else if (category === 'bakery') {
      categoryFilter = `nwr["shop"="bakery"](around:${radiusMeters},${lat},${lng});nwr["amenity"="ice_cream"](around:${radiusMeters},${lat},${lng});`;
    } else if (category === 'drink') {
      categoryFilter = `nwr["shop"="beverages"](around:${radiusMeters},${lat},${lng});nwr["amenity"="cafe"](around:${radiusMeters},${lat},${lng});`;
    }

    const query = `
      [out:json][timeout:25];
      (
        ${categoryFilter}
      );
      out center 150;
    `;

    let lastError = null;
    for (const endpoint of OVERPASS_ENDPOINTS) {
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded'
          },
          body: `data=${encodeURIComponent(query)}`
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status} from ${endpoint}`);
        }

        const data = await response.json();
        return this.normalizePlaces(data.elements || [], lat, lng);
      } catch (err) {
        console.warn(`Overpass endpoint failed (${endpoint}):`, err);
        lastError = err;
      }
    }

    throw new Error(`無法連線至 Overpass 地圖伺服器: ${lastError?.message || '未知錯誤'}`);
  },

  /**
   * 正規化 OSM 回傳的資料為統一的資料結構
   */
  normalizePlaces(elements, userLat, userLng) {
    const places = [];
    const seenNames = new Set();

    for (const el of elements) {
      const tags = el.tags || {};
      // 優先選取繁體中文名稱
      const name = tags['name:zh-TW'] || tags['name:zh-Hant'] || tags['name:zh'] || tags.name || tags['name:en'] || tags.brand;
      if (!name) continue; // 略過無名店家

      // 避免重複名稱且位置極度接近
      const elLat = el.lat || el.center?.lat;
      const elLng = el.lon || el.center?.lon;
      if (!elLat || !elLng) continue;

      const dedupeKey = `${name.toLowerCase()}_${elLat.toFixed(3)}_${elLng.toFixed(3)}`;
      if (seenNames.has(dedupeKey)) continue;
      seenNames.add(dedupeKey);

      // 計算距離
      const distanceKm = GeoService.calculateDistance(userLat, userLng, elLat, elLng);

      // 解析營業時間
      const rawOpeningHours = tags.opening_hours || '';
      const parsedHours = OpeningHoursParser.parse(rawOpeningHours);

      // 地址組合
      const addrStreet = tags['addr:street'] || '';
      const addrHousenumber = tags['addr:housenumber'] || '';
      const addrCity = tags['addr:city'] || tags['addr:district'] || tags['addr:county'] || '';
      const addrFull = tags['addr:full'] || (addrCity + addrStreet + (addrHousenumber ? addrHousenumber + '號' : '')) || tags.address || '地址詳見地圖標註';

      // 美食分類判斷
      const category = this.determineCategory(tags);

      // Google Maps 搜尋與導航連結
      const googleMapsUrl = GeoService.generateGoogleMapsUrl(name, addrFull !== '地址詳見地圖標註' ? addrFull : '', elLat, elLng);
      const directionsUrl = GeoService.generateDirectionsUrl(elLat, elLng, name);

      places.push({
        id: `osm_${el.type}_${el.id}`,
        name: name,
        category: category.label,
        categoryIcon: category.icon,
        lat: elLat,
        lng: elLng,
        distanceKm: distanceKm,
        distanceText: GeoService.formatDistance(distanceKm),
        address: addrFull,
        phone: tags.phone || tags['contact:phone'] || tags['contact:mobile'] || null,
        website: tags.website || tags['contact:website'] || null,
        cuisine: tags.cuisine ? this.translateCuisine(tags.cuisine) : null,
        // 營業時間詳細
        rawOpeningHours: rawOpeningHours,
        isOpen: parsedHours.isOpen,
        statusText: parsedHours.statusText,
        todayHoursText: parsedHours.todayHoursText,
        closeMinutes: parsedHours.closeMinutes,
        // 連結
        googleMapsUrl: googleMapsUrl,
        directionsUrl: directionsUrl,
        source: 'OSM'
      });
    }

    // 依距離由近到遠排序
    places.sort((a, b) => a.distanceKm - b.distanceKm);

    return places;
  },

  /**
   * 根據 tags 分類
   */
  determineCategory(tags) {
    if (tags.amenity === 'cafe') return { label: '咖啡廳', icon: '☕' };
    if (tags.amenity === 'fast_food') return { label: '速食', icon: '🍔' };
    if (tags.amenity === 'ice_cream') return { label: '冰品甜點', icon: '🍦' };
    if (tags.shop === 'bakery') return { label: '烘焙點心', icon: '🥐' };
    if (tags.shop === 'beverages') return { label: '手搖飲料', icon: '🧋' };
    if (tags.amenity === 'bar' || tags.amenity === 'pub') return { label: '餐酒館/酒吧', icon: '🍸' };
    if (tags.amenity === 'food_court') return { label: '美食街', icon: '🍲' };

    const cuisine = tags.cuisine || '';
    if (/noodle|ramen/i.test(cuisine)) return { label: '麵食/拉麵', icon: '🍜' };
    if (/hotpot/i.test(cuisine)) return { label: '火鍋', icon: '🍲' };
    if (/japanese|sushi/i.test(cuisine)) return { label: '日式料理', icon: '🍣' };
    if (/taiwanese/i.test(cuisine)) return { label: '在地小吃', icon: '🥢' };
    if (/pizza|italian/i.test(cuisine)) return { label: '義式/披薩', icon: '🍕' };
    if (/vegetarian|vegan/i.test(cuisine)) return { label: '蔬食素食', icon: '🥗' };

    return { label: '餐廳美食', icon: '🍽️' };
  },

  /**
   * 翻譯菜系
   */
  translateCuisine(cuisine) {
    const map = {
      'taiwanese': '台灣料理',
      'chinese': '中式料理',
      'japanese': '日式料理',
      'ramen': '拉麵',
      'noodle': '麵食',
      'hotpot': '火鍋',
      'sushi': '壽司',
      'korean': '韓式料理',
      'italian': '義式料理',
      'pizza': '披薩',
      'burger': '漢堡',
      'steak': '牛排',
      'seafood': '海鮮',
      'vegetarian': '素食/蔬食',
      'coffee_shop': '咖啡',
      'tea': '茶飲',
      'bbq': '燒肉/烤肉',
      'thai': '泰式料理',
      'vietnamese': '越式料理'
    };
    return cuisine.split(';').map(c => map[c.trim().toLowerCase()] || c.trim()).join(' · ');
  }
};
