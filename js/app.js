/**
 * app.js - 主應用程式協調器
 */

import { GeoService } from './geo.js';
import { OsmService } from './osmService.js';
import { GoogleService } from './googleService.js';
import { MapService } from './mapService.js';
import { Config } from './config.js';
import { UI } from './ui.js';

class EatFinderApp {
  constructor() {
    this.currentLat = 25.0330;
    this.currentLng = 121.5654;
    this.currentRadiusKm = 3;
    this.allPlaces = [];
    this.filteredPlaces = [];
    this.favoritePlaces = new Map();
    this.isShowingFavoritesOnly = false;
    this.isLoading = false;
    this.mapReady = false;
  }

  async init() {
    UI.init();
    this.loadFavorites();
    this.bindEvents();
    this.bindMobileTabs();

    // 解析 API Key
    await Config.resolveApiKey();

    // 載入 Google Maps SDK 並初始化地圖
    await this.initGoogleMap();

    // 啟動時自動嘗試 GPS 定位
    await this.handleLocateMe();
  }

  async initGoogleMap() {
    try {
      await Config.loadGoogleMapsSDK();
      MapService.init('map', this.currentLat, this.currentLng, (lat, lng) => {
        this.setLocation(lat, lng, '自訂地圖中心位置');
      });
      this.mapReady = true;
      console.log('🗺️ Google Maps SDK 載入完成');
    } catch (err) {
      console.warn('Google Maps 載入失敗:', err);
      this.mapReady = false;
      const mapElem = document.getElementById('map');
      if (mapElem) {
        mapElem.innerHTML = `
          <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 2rem; text-align: center; color: #94a3b8; background: #0f172a;">
            <div style="font-size: 3rem; margin-bottom: 1rem;">🗺️</div>
            <h3 style="color: #f8fafc; margin-bottom: 0.5rem; font-size: 1.1rem;">地圖載入失敗</h3>
            <p style="max-width: 320px; font-size: 0.85rem; line-height: 1.6; color: #94a3b8;">
              請確認 Cloudflare Pages 後台已設定 <code style="color: #f97316; background: rgba(249,115,22,0.15); padding: 2px 6px; border-radius: 4px;">GOOGLE_MAPS_API_KEY</code>，且 Google Cloud Console 已允許網站網址。
            </p>
            <p style="margin-top: 0.5rem; font-size: 0.78rem; color: #64748b;">${err.message || ''}</p>
          </div>
        `;
      }
    }
  }

  bindMobileTabs() {
    const tabList = document.getElementById('tabList');
    const tabMap = document.getElementById('tabMap');
    const panelList = document.getElementById('panelList');
    const panelMap = document.getElementById('panelMap');

    if (!tabList || !tabMap || !panelList || !panelMap) return;

    const isMobile = () => window.innerWidth < 900;

    const switchTab = (activeTab) => {
      if (!isMobile()) return;

      const isListTab = (activeTab === 'list');

      tabList.classList.toggle('active', isListTab);
      tabMap.classList.toggle('active', !isListTab);
      panelList.classList.toggle('tab-hidden', !isListTab);
      panelMap.classList.toggle('tab-hidden', isListTab);
    };

    tabList.addEventListener('click', () => switchTab('list'));
    tabMap.addEventListener('click', () => switchTab('map'));

    // 初始桌面版不加任何 class
    if (isMobile()) {
      // 預設顯示清單
      panelMap.classList.add('tab-hidden');
    }

    // 監聽視窗大小變更（橫豎轉換）
    window.addEventListener('resize', () => {
      if (!isMobile()) {
        panelList.classList.remove('tab-hidden');
        panelMap.classList.remove('tab-hidden');
      } else {
        // 確保手機版有一個 tab 是 active
        const listIsHidden = panelList.classList.contains('tab-hidden');
        const mapIsHidden = panelMap.classList.contains('tab-hidden');
        if (!listIsHidden && !mapIsHidden) {
          // 兩個都沒隱藏（從桌面版切回手機版），預設顯示清單
          panelMap.classList.add('tab-hidden');
        }
      }
    });
  }

  bindEvents() {
    const { elements } = UI;

    // GPS 重新定位
    elements.btnLocateMe?.addEventListener('click', () => this.handleLocateMe());

    // 半徑變更
    elements.searchRadiusSelect?.addEventListener('change', (e) => {
      this.currentRadiusKm = parseFloat(e.target.value) || 3;
      if (this.mapReady) {
        MapService.updateUserLocation(this.currentLat, this.currentLng, this.currentRadiusKm);
      }
      this.fetchPlaces();
    });

    // 類別變更
    elements.categoryFilter?.addEventListener('change', () => this.fetchPlaces());

    // 僅顯示營業中
    elements.openOnlyToggle?.addEventListener('change', () => this.applyFilterAndRender());

    // 排序
    elements.sortBySelect?.addEventListener('change', () => this.applyFilterAndRender());

    // 關鍵字搜尋（防抖 300ms）
    let searchTimer = null;
    elements.searchKeywords?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => this.applyFilterAndRender(), 300);
    });

    // 隨機推薦（清單面板版 + 地圖版）
    elements.btnRandomPick?.addEventListener('click', () => this.handleRandomPick());
    document.getElementById('btnRandomPickMap')?.addEventListener('click', () => this.handleRandomPick());

    elements.btnSpinAgain?.addEventListener('click', () => this.handleRandomPick());
    elements.randomModalClose?.addEventListener('click', () => UI.closeModal(elements.randomModal));

    // 收藏夾切換
    elements.btnFavoritesToggle?.addEventListener('click', () => {
      this.isShowingFavoritesOnly = !this.isShowingFavoritesOnly;
      elements.btnFavoritesToggle.classList.toggle('active', this.isShowingFavoritesOnly);
      UI.showToast(this.isShowingFavoritesOnly ? '已切換至我的收藏' : '已返回全部店家', 'info');
      this.applyFilterAndRender();
    });

    // 點擊 Modal 遮罩關閉
    window.addEventListener('click', (e) => {
      if (e.target === elements.randomModal) UI.closeModal(elements.randomModal);
    });

    // ESC 關閉 Modal
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') UI.closeModal(elements.randomModal);
    });
  }

  /**
   * 觸發 GPS 定位
   */
  async handleLocateMe() {
    UI.showToast('📡 正在偵測您的 GPS 位置...', 'info', 3000);
    try {
      const pos = await GeoService.getCurrentPosition();
      this.currentLat = pos.lat;
      this.currentLng = pos.lng;

      const addr = await GeoService.reverseGeocode(pos.lat, pos.lng);
      this.setLocation(pos.lat, pos.lng, addr);
      UI.showToast('📍 定位成功！正在搜尋周遭店家...', 'success');
    } catch (err) {
      console.warn('GPS 定位失敗:', err);
      UI.showToast(err.message || 'GPS 定位失敗，使用預設座標', 'error', 5000);
      this.setLocation(this.currentLat, this.currentLng, '台北市信義區 (預設)');
    }
  }

  /**
   * 設定位置並更新地圖、重新搜尋
   */
  async setLocation(lat, lng, label = '') {
    this.currentLat = lat;
    this.currentLng = lng;

    const displayText = label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    if (UI.elements.currentLocationText) {
      UI.elements.currentLocationText.textContent = displayText;
    }
    // 手機版位置列
    const mobileLocText = document.getElementById('mobileLocationText');
    if (mobileLocText) mobileLocText.textContent = displayText;

    if (this.mapReady) {
      MapService.updateUserLocation(lat, lng, this.currentRadiusKm);
    }
    await this.fetchPlaces();
  }

  /**
   * 從 API 抓取店家（優先 Cloudflare Proxy → Google，備援 OSM）
   */
  async fetchPlaces() {
    if (this.isLoading) return;
    this.isLoading = true;
    UI.showLoadingSkeleton(5);

    const category = UI.elements.categoryFilter?.value || 'all';

    try {
      let places = [];

      // 優先透過 Cloudflare Proxy 呼叫 Google Places
      try {
        places = await GoogleService.fetchNearbyPlaces(
          this.currentLat, this.currentLng, this.currentRadiusKm, category
        );
        console.log(`✅ Google Places 回傳 ${places.length} 間店家`);
      } catch (gErr) {
        console.warn('Google Places 失敗，切換 OSM:', gErr.message);
        UI.showToast('Google API 暫時無法使用，切換至備用資料源', 'error', 4000);
        places = await OsmService.fetchNearbyPlaces(
          this.currentLat, this.currentLng, this.currentRadiusKm, category
        );
      }

      this.allPlaces = places;
      this.applyFilterAndRender();
    } catch (error) {
      console.error('抓取店家失敗:', error);
      UI.showToast(`搜尋店家失敗：${error.message}`, 'error', 5000);
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
    let list = this.isShowingFavoritesOnly
      ? Array.from(this.favoritePlaces.values())
      : [...this.allPlaces];

    const openOnly = UI.elements.openOnlyToggle?.checked;
    const searchKeyword = (UI.elements.searchKeywords?.value || '').trim().toLowerCase();
    const sortBy = UI.elements.sortBySelect?.value || 'distance';

    // 1. 營業中篩選
    if (openOnly) {
      list = list.filter(p => p.isOpen === true || p.isOpen === null);
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
    switch (sortBy) {
      case 'distance':
        list.sort((a, b) => a.distanceKm - b.distanceKm);
        break;
      case 'closing_late':
        list.sort((a, b) => (b.closeMinutes || 0) - (a.closeMinutes || 0));
        break;
      case 'closing_soon':
        list.sort((a, b) => {
          const aMin = (a.closeMinutes > 0) ? a.closeMinutes : 9999;
          const bMin = (b.closeMinutes > 0) ? b.closeMinutes : 9999;
          return aMin - bMin;
        });
        break;
      case 'rating':
        list.sort((a, b) => (b.rating || 0) - (a.rating || 0));
        break;
      case 'name':
        list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant'));
        break;
    }

    this.filteredPlaces = list;

    // 更新 Tab 上的數量徽章
    const tabBadge = document.getElementById('tabCountBadge');
    if (tabBadge) {
      tabBadge.textContent = list.length;
      tabBadge.classList.toggle('visible', list.length > 0);
    }

    // 渲染卡片
    const favSet = new Set(this.favoritePlaces.keys());
    UI.renderPlaces(
      this.filteredPlaces,
      (id, lat, lng) => MapService.focusPlace(lat, lng),
      (place) => this.toggleFavorite(place),
      favSet
    );

    // 渲染地圖 Markers
    if (this.mapReady) {
      MapService.renderPlaces(this.filteredPlaces, (place) => {
        const card = document.querySelector(`.place-card[data-id="${place.id}"]`);
        if (card) {
          // 手機版：切換至清單 Tab
          const panelList = document.getElementById('panelList');
          const panelMap = document.getElementById('panelMap');
          if (window.innerWidth < 900 && panelList && panelMap) {
            panelList.classList.remove('tab-hidden');
            panelMap.classList.add('tab-hidden');
            document.getElementById('tabList')?.classList.add('active');
            document.getElementById('tabMap')?.classList.remove('active');
          }
          setTimeout(() => {
            card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            card.classList.add('highlight-selected');
            setTimeout(() => card.classList.remove('highlight-selected'), 1500);
          }, 150);
        }
      });
    }
  }

  /**
   * 隨機推薦（嚴格依當前半徑）
   */
  handleRandomPick() {
    const currentRadius = this.currentRadiusKm;
    const inRadiusPlaces = this.filteredPlaces.filter(p => p.distanceKm <= (currentRadius + 0.05));

    if (inRadiusPlaces.length === 0) {
      UI.showRandomPick(null, currentRadius);
      return;
    }

    // 優先從營業中挑選
    let candidates = inRadiusPlaces.filter(p => p.isOpen === true);
    if (candidates.length === 0) candidates = inRadiusPlaces;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    UI.showRandomPick(chosen, currentRadius);
  }

  /**
   * 收藏清單管理
   */
  loadFavorites() {
    try {
      const saved = localStorage.getItem('eatfinder_favorites');
      if (saved) {
        JSON.parse(saved).forEach(p => this.favoritePlaces.set(p.id, p));
      }
    } catch (e) {
      console.warn('載入收藏失敗:', e);
    }
  }

  toggleFavorite(place) {
    if (this.favoritePlaces.has(place.id)) {
      this.favoritePlaces.delete(place.id);
      UI.showToast(`已從收藏移除「${place.name}」`, 'info');
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

// 初始化
window.addEventListener('DOMContentLoaded', () => {
  const app = new EatFinderApp();
  app.init();
});
