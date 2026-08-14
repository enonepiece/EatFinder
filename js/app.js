/**
 * app.js - 主應用程式控制模組
 */

import { GeoService } from './geo.js';
import { OsmService } from './osmService.js';
import { GoogleService } from './googleService.js';
import { MapService } from './mapService.js';
import { UI } from './ui.js';

class EatFinderApp {
  constructor() {
    this.currentLat = 25.0330; // 預設台北 101 座標
    this.currentLng = 121.5654;
    this.currentRadiusKm = 5; // 預設 5 公里
    this.allPlaces = [];
    this.filteredPlaces = [];
    this.favoritePlaces = new Map();
    this.isShowingFavoritesOnly = false;
    this.isLoading = false;
  }

  async init() {
    UI.init();
    this.loadFavorites();
    this.updateApiBadge();

    // 初始化地圖，並註冊點選地圖重新自訂定位中心
    MapService.init('map', this.currentLat, this.currentLng, (lat, lng) => {
      this.setLocation(lat, lng, '自訂地圖中心位置');
    });

    this.bindEvents();

    // 啟動時自動嘗試 GPS 定位
    await this.handleLocateMe();
  }

  bindEvents() {
    const { elements } = UI;

    // GPS 重新定位按鈕
    elements.btnLocateMe?.addEventListener('click', () => this.handleLocateMe());

    // 搜尋半徑變更
    elements.searchRadiusSelect?.addEventListener('change', (e) => {
      this.currentRadiusKm = parseFloat(e.target.value) || 10;
      MapService.updateUserLocation(this.currentLat, this.currentLng, this.currentRadiusKm);
      this.fetchPlaces();
    });

    // 類別變更
    elements.categoryFilter?.addEventListener('change', () => {
      this.fetchPlaces();
    });

    // 僅顯示營業中切換
    elements.openOnlyToggle?.addEventListener('change', () => {
      this.applyFilterAndRender();
    });

    // 排序變更
    elements.sortBySelect?.addEventListener('change', () => {
      this.applyFilterAndRender();
    });

    // 關鍵字搜尋
    elements.searchKeywords?.addEventListener('input', () => {
      this.applyFilterAndRender();
    });

    // 隨機選一家
    elements.btnRandomPick?.addEventListener('click', () => {
      this.handleRandomPick();
    });
    elements.btnSpinAgain?.addEventListener('click', () => {
      this.handleRandomPick();
    });
    elements.randomModalClose?.addEventListener('click', () => {
      UI.closeModal(elements.randomModal);
    });

    // 收藏夾切換
    elements.btnFavoritesToggle?.addEventListener('click', () => {
      this.isShowingFavoritesOnly = !this.isShowingFavoritesOnly;
      elements.btnFavoritesToggle.classList.toggle('active', this.isShowingFavoritesOnly);
      if (this.isShowingFavoritesOnly) {
        UI.showToast('已切換至我的收藏店家', 'info');
      }
      this.applyFilterAndRender();
    });

    // 設定按鈕與 Google API Key Modal
    elements.btnSettings?.addEventListener('click', () => {
      elements.googleApiKeyInput.value = GoogleService.getApiKey();
      elements.settingsModal.classList.add('modal-open');
    });
    elements.settingsModalClose?.addEventListener('click', () => {
      UI.closeModal(elements.settingsModal);
    });
    elements.btnSaveSettings?.addEventListener('click', () => {
      const key = elements.googleApiKeyInput.value.trim();
      GoogleService.setApiKey(key);
      this.updateApiBadge();
      UI.closeModal(elements.settingsModal);
      UI.showToast(key ? 'Google Places API Key 已儲存，已切換至 Google Places 模式' : '已恢復免金鑰 OpenStreetMap 模式', 'success');
      this.fetchPlaces();
    });

    // 點擊 Modal 外層關閉
    window.addEventListener('click', (e) => {
      if (e.target === elements.randomModal) UI.closeModal(elements.randomModal);
      if (e.target === elements.settingsModal) UI.closeModal(elements.settingsModal);
    });
  }

  updateApiBadge() {
    if (UI.elements.apiSourceBadge) {
      const hasGoogle = GoogleService.hasApiKey();
      UI.elements.apiSourceBadge.textContent = hasGoogle ? 'Google Places API' : 'OpenStreetMap (免金鑰)';
      UI.elements.apiSourceBadge.className = `badge-api-source ${hasGoogle ? 'api-google' : 'api-osm'}`;
    }
  }

  /**
   * 觸發原生 GPS 定位
   */
  async handleLocateMe() {
    UI.showToast('正在偵測您的目前 GPS 位置...', 'info');
    try {
      const pos = await GeoService.getCurrentPosition();
      this.currentLat = pos.lat;
      this.currentLng = pos.lng;

      const addr = await GeoService.reverseGeocode(pos.lat, pos.lng);
      this.setLocation(pos.lat, pos.lng, addr);
      UI.showToast('📍 GPS 定位成功！開始搜尋 10 公里內餐飲店家', 'success');
    } catch (err) {
      console.warn('GPS 定位失敗，使用預設中心點:', err);
      UI.showToast(err.message || 'GPS 定位失敗，使用預設座標', 'error', 4500);
      this.setLocation(this.currentLat, this.currentLng, '台北市信義區 (預設位置)');
    }
  }

  /**
   * 設定中心位置並更新地圖與重新載入店家
   */
  async setLocation(lat, lng, label = '') {
    this.currentLat = lat;
    this.currentLng = lng;

    if (UI.elements.currentLocationText) {
      UI.elements.currentLocationText.textContent = label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      UI.elements.currentLocationText.title = label || '';
    }

    MapService.updateUserLocation(lat, lng, this.currentRadiusKm);
    await this.fetchPlaces();
  }

  /**
   * 從 API 抓取半徑內的店家
   */
  async fetchPlaces() {
    if (this.isLoading) return;
    this.isLoading = true;

    UI.showLoadingSkeleton(6);

    const category = UI.elements.categoryFilter?.value || 'all';

    try {
      let places = [];
      if (GoogleService.hasApiKey()) {
        try {
          places = await GoogleService.fetchNearbyPlaces(this.currentLat, this.currentLng, this.currentRadiusKm, category);
        } catch (gErr) {
          console.warn('Google API 失敗，自動切換 Overpass API:', gErr);
          UI.showToast(`Google API 失敗: ${gErr.message}，已自動切換回 OSM 模式`, 'error');
          places = await OsmService.fetchNearbyPlaces(this.currentLat, this.currentLng, this.currentRadiusKm, category);
        }
      } else {
        places = await OsmService.fetchNearbyPlaces(this.currentLat, this.currentLng, this.currentRadiusKm, category);
      }

      this.allPlaces = places;
      this.applyFilterAndRender();
    } catch (error) {
      console.error('抓取店家失敗:', error);
      UI.showToast(`搜尋店家失敗: ${error.message}`, 'error', 5000);
      this.allPlaces = [];
      this.applyFilterAndRender();
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * 篩選、排序與渲染
   */
  applyFilterAndRender() {
    let list = this.isShowingFavoritesOnly ? Array.from(this.favoritePlaces.values()) : [...this.allPlaces];

    const openOnly = UI.elements.openOnlyToggle?.checked;
    const searchKeyword = (UI.elements.searchKeywords?.value || '').trim().toLowerCase();
    const sortBy = UI.elements.sortBySelect?.value || 'distance';

    // 1. 營業中篩選
    if (openOnly) {
      list = list.filter(p => p.isOpen === true || p.isOpen === null); // 保留明確營業中或未標示者，過濾確定已打烊/公休者
    }

    // 2. 關鍵字過濾
    if (searchKeyword) {
      list = list.filter(p => 
        p.name.toLowerCase().includes(searchKeyword) ||
        p.address.toLowerCase().includes(searchKeyword) ||
        (p.cuisine && p.cuisine.toLowerCase().includes(searchKeyword)) ||
        (p.category && p.category.toLowerCase().includes(searchKeyword))
      );
    }

    // 3. 排序
    if (sortBy === 'distance') {
      list.sort((a, b) => a.distanceKm - b.distanceKm); // 近至遠
    } else if (sortBy === 'closing_late') {
      // 最晚打烊優先 (closeMinutes 較大者排前面，24小時或跨夜優先)
      list.sort((a, b) => (b.closeMinutes || 0) - (a.closeMinutes || 0));
    } else if (sortBy === 'closing_soon') {
      // 即將打烊優先 (有營業且 closeMinutes 較小者排前面)
      list.sort((a, b) => {
        const aMin = (a.closeMinutes > 0) ? a.closeMinutes : 9999;
        const bMin = (b.closeMinutes > 0) ? b.closeMinutes : 9999;
        return aMin - bMin;
      });
    } else if (sortBy === 'rating') {
      list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
    } else if (sortBy === 'name') {
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
    }

    this.filteredPlaces = list;

    // 渲染卡片
    const favSet = new Set(this.favoritePlaces.keys());
    UI.renderPlaces(
      this.filteredPlaces,
      (id, lat, lng) => {
        MapService.focusPlace(lat, lng);
      },
      (place) => {
        this.toggleFavorite(place);
      },
      favSet
    );

    // 渲染地圖 Markers
    MapService.renderPlaces(this.filteredPlaces, (place) => {
      // 點擊地圖 marker 時，將側邊欄該卡片捲動至可見區域
      const card = document.querySelector(`.place-card[data-id="${place.id}"]`);
      if (card) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        card.classList.add('highlight-selected');
        setTimeout(() => card.classList.remove('highlight-selected'), 1500);
      }
    });
  }

  /**
   * 隨機挑選「今天吃什麼？」
   */
  handleRandomPick() {
    // 優先挑選營業中的店家
    let candidatePlaces = this.filteredPlaces.filter(p => p.isOpen === true);
    if (candidatePlaces.length === 0) {
      candidatePlaces = this.filteredPlaces;
    }

    if (candidatePlaces.length === 0) {
      UI.showRandomPick(null);
      return;
    }

    const randomIndex = Math.floor(Math.random() * candidatePlaces.length);
    const chosenPlace = candidatePlaces[randomIndex];
    UI.showRandomPick(chosenPlace);
  }

  /**
   * 收藏清單管理
   */
  loadFavorites() {
    try {
      const saved = localStorage.getItem('eatfinder_favorites');
      if (saved) {
        const arr = JSON.parse(saved);
        arr.forEach(p => this.favoritePlaces.set(p.id, p));
      }
    } catch (e) {
      console.warn('載入收藏失敗:', e);
    }
  }

  toggleFavorite(place) {
    if (this.favoritePlaces.has(place.id)) {
      this.favoritePlaces.delete(place.id);
      UI.showToast(`已從收藏清單移除「${place.name}」`, 'info');
    } else {
      this.favoritePlaces.set(place.id, place);
      UI.showToast(`已加入收藏「${place.name}」❤️`, 'success');
    }

    try {
      localStorage.setItem('eatfinder_favorites', JSON.stringify(Array.from(this.favoritePlaces.values())));
    } catch (e) {
      console.warn('儲存收藏失敗:', e);
    }

    this.applyFilterAndRender();
  }
}

// 應用程式初始化
window.addEventListener('DOMContentLoaded', () => {
  const app = new EatFinderApp();
  app.init();
});
