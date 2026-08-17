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

    // 自訂位置狀態
    this.isCustomLocation = false;
    this.customLocationLabel = '';
    this.pendingCustomLat = null;
    this.pendingCustomLng = null;
    this.pendingCustomLabel = '';

    // GPS 原始座標備份（回到 GPS 定位用）
    this.gpsLat = null;
    this.gpsLng = null;
    this.gpsLabel = '';
  }

  async init() {
    UI.init();
    this.loadFavorites();
    this.bindEvents();
    this.bindMobileTabs();
    this.bindCustomLocationModal();

    await Config.resolveApiKey();
    await this.initGoogleMap();
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
          <div style="height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:2rem;text-align:center;color:#94a3b8;background:#0f172a;">
            <div style="font-size:3rem;margin-bottom:1rem;">🗺️</div>
            <h3 style="color:#f8fafc;margin-bottom:0.5rem;font-size:1.1rem;">地圖載入失敗</h3>
            <p style="max-width:320px;font-size:0.85rem;line-height:1.6;color:#94a3b8;">
              請確認 Cloudflare Pages 後台已設定 <code style="color:#f97316;background:rgba(249,115,22,0.15);padding:2px 6px;border-radius:4px;">GOOGLE_MAPS_API_KEY</code>，且 Google Cloud Console 已允許網站網址。
            </p>
            <p style="margin-top:0.5rem;font-size:0.78rem;color:#64748b;">${err.message || ''}</p>
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
      const isListTab = activeTab === 'list';
      tabList.classList.toggle('active', isListTab);
      tabMap.classList.toggle('active', !isListTab);
      panelList.classList.toggle('tab-hidden', !isListTab);
      panelMap.classList.toggle('tab-hidden', isListTab);
    };

    tabList.addEventListener('click', () => switchTab('list'));
    tabMap.addEventListener('click', () => switchTab('map'));

    if (isMobile()) {
      panelMap.classList.add('tab-hidden');
    }

    window.addEventListener('resize', () => {
      if (!isMobile()) {
        panelList.classList.remove('tab-hidden');
        panelMap.classList.remove('tab-hidden');
      } else {
        const listHidden = panelList.classList.contains('tab-hidden');
        const mapHidden = panelMap.classList.contains('tab-hidden');
        if (!listHidden && !mapHidden) {
          panelMap.classList.add('tab-hidden');
        }
      }
    });
  }

  /**
   * 自訂位置 Modal 邏輯
   */
  bindCustomLocationModal() {
    const modal = document.getElementById('customLocationModal');
    const closeBtn = document.getElementById('customLocationClose');
    const openBtn = document.getElementById('btnCustomLocation');
    const searchInput = document.getElementById('customLocationInput');
    const searchBtn = document.getElementById('btnSearchLocation');
    const resultContainer = document.getElementById('locationSearchResult');
    const currentInfo = document.getElementById('currentCustomLocationInfo');
    const confirmBtn = document.getElementById('btnConfirmLocation');
    const clearBtn = document.getElementById('btnClearCustomLocation');

    if (!modal) return;

    // 開啟 Modal
    openBtn?.addEventListener('click', () => {
      this.pendingCustomLat = null;
      this.pendingCustomLng = null;
      this.pendingCustomLabel = '';
      if (confirmBtn) confirmBtn.disabled = true;
      if (resultContainer) { resultContainer.style.display = 'none'; resultContainer.innerHTML = ''; }

      // 顯示目前自訂位置狀態
      if (currentInfo) {
        if (this.isCustomLocation) {
          currentInfo.style.display = 'flex';
          currentInfo.innerHTML = `<span>📌</span><span>目前自訂位置：<strong>${this.customLocationLabel}</strong></span>`;
        } else {
          currentInfo.style.display = 'none';
        }
      }

      modal.classList.add('modal-open');
      setTimeout(() => searchInput?.focus(), 200);
    });

    // 關閉 Modal
    const closeModal = () => modal.classList.remove('modal-open');
    closeBtn?.addEventListener('click', closeModal);
    modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

    // Enter 鍵搜尋
    searchInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') searchBtn?.click();
    });

    // 搜尋地址
    searchBtn?.addEventListener('click', async () => {
      const query = searchInput?.value?.trim();
      if (!query) return;

      searchBtn.disabled = true;
      searchBtn.textContent = '搜尋中...';
      if (resultContainer) { resultContainer.style.display = 'none'; resultContainer.innerHTML = ''; }

      try {
        const results = await this.geocodeAddress(query);

        if (!results || results.length === 0) {
          resultContainer.style.display = 'block';
          resultContainer.innerHTML = `
            <div style="padding:1rem;text-align:center;color:var(--text-secondary);font-size:0.85rem;">
              ❌ 找不到符合的地點，請嘗試更精確的描述。
            </div>
          `;
          return;
        }

        // 顯示結果清單
        resultContainer.style.display = 'block';
        resultContainer.innerHTML = results.map((r, i) => `
          <div class="location-result-item" data-idx="${i}" data-lat="${r.lat}" data-lng="${r.lng}" data-label="${encodeURIComponent(r.name)}">
            <div class="result-icon">📍</div>
            <div class="result-text">
              <div class="result-name">${r.name}</div>
              <div class="result-addr">${r.address || ''}</div>
            </div>
          </div>
        `).join('');

        // 選擇結果
        resultContainer.querySelectorAll('.location-result-item').forEach(item => {
          item.addEventListener('click', () => {
            resultContainer.querySelectorAll('.location-result-item').forEach(i => i.classList.remove('selected'));
            item.classList.add('selected');
            this.pendingCustomLat = parseFloat(item.dataset.lat);
            this.pendingCustomLng = parseFloat(item.dataset.lng);
            this.pendingCustomLabel = decodeURIComponent(item.dataset.label);
            if (confirmBtn) confirmBtn.disabled = false;
          });
        });

      } catch (err) {
        resultContainer.style.display = 'block';
        resultContainer.innerHTML = `
          <div style="padding:1rem;text-align:center;color:var(--text-secondary);font-size:0.85rem;">
            ⚠️ 搜尋失敗：${err.message}
          </div>
        `;
      } finally {
        searchBtn.disabled = false;
        searchBtn.textContent = '搜尋';
      }
    });

    // 確認使用自訂位置
    confirmBtn?.addEventListener('click', () => {
      if (this.pendingCustomLat === null) return;
      this.isCustomLocation = true;
      this.customLocationLabel = this.pendingCustomLabel;
      openBtn?.classList.add('location-active');
      openBtn.title = `📌 自訂位置：${this.pendingCustomLabel}`;
      closeModal();
      this.setLocation(this.pendingCustomLat, this.pendingCustomLng, `📌 ${this.pendingCustomLabel}`);
      UI.showToast(`📌 已切換至「${this.pendingCustomLabel}」`, 'success');
    });

    // 清除自訂位置，回到 GPS
    clearBtn?.addEventListener('click', () => {
      this.isCustomLocation = false;
      this.customLocationLabel = '';
      openBtn?.classList.remove('location-active');
      openBtn.title = '手動設定搜尋位置';
      closeModal();

      if (this.gpsLat !== null) {
        this.setLocation(this.gpsLat, this.gpsLng, this.gpsLabel);
        UI.showToast('📍 已回到 GPS 定位位置', 'info');
      } else {
        this.handleLocateMe();
      }
    });

    // ESC 關閉
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });
  }

  /**
   * 地理編碼：文字地址 → 座標
   * 優先嘗試解析 "lat, lng" 格式，其次使用 Google Geocoder
   */
  async geocodeAddress(query) {
    // 嘗試直接解析座標格式 "25.047, 121.517"
    const coordMatch = query.match(/^(-?\d+\.?\d*)\s*[,，]\s*(-?\d+\.?\d*)$/);
    if (coordMatch) {
      const lat = parseFloat(coordMatch[1]);
      const lng = parseFloat(coordMatch[2]);
      if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
        return [{ lat, lng, name: `座標 (${lat.toFixed(4)}, ${lng.toFixed(4)})`, address: '' }];
      }
    }

    // 使用 Google Geocoder（已在 Maps SDK 中，不需要額外 API 呼叫）
    if (!window.google?.maps?.Geocoder) {
      throw new Error('Google Maps SDK 尚未載入，請稍後再試');
    }

    const geocoder = new google.maps.Geocoder();
    return new Promise((resolve, reject) => {
      geocoder.geocode(
        { address: query, region: 'TW', language: 'zh-TW' },
        (results, status) => {
          if (status === 'OK' && results?.length > 0) {
            resolve(results.slice(0, 5).map(r => ({
              lat: r.geometry.location.lat(),
              lng: r.geometry.location.lng(),
              name: r.formatted_address.split(',')[0] || r.formatted_address,
              address: r.formatted_address
            })));
          } else if (status === 'ZERO_RESULTS') {
            resolve([]);
          } else {
            reject(new Error(`Geocoding 失敗：${status}`));
          }
        }
      );
    });
  }

  bindEvents() {
    const { elements } = UI;

    elements.btnLocateMe?.addEventListener('click', () => {
      this.isCustomLocation = false;
      this.customLocationLabel = '';
      document.getElementById('btnCustomLocation')?.classList.remove('location-active');
      this.handleLocateMe();
    });

    elements.searchRadiusSelect?.addEventListener('change', (e) => {
      this.currentRadiusKm = parseFloat(e.target.value) || 3;
      if (this.mapReady) MapService.updateUserLocation(this.currentLat, this.currentLng, this.currentRadiusKm);
      this.fetchPlaces();
    });

    elements.categoryFilter?.addEventListener('change', () => this.fetchPlaces());
    elements.openOnlyToggle?.addEventListener('change', () => this.applyFilterAndRender());
    elements.sortBySelect?.addEventListener('change', () => this.applyFilterAndRender());

    // 價位過濾
    document.getElementById('priceFilter')?.addEventListener('change', () => this.applyFilterAndRender());

    let searchTimer = null;
    elements.searchKeywords?.addEventListener('input', () => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => this.applyFilterAndRender(), 300);
    });

    elements.btnRandomPick?.addEventListener('click', () => this.handleRandomPick());
    document.getElementById('btnRandomPickMap')?.addEventListener('click', () => this.handleRandomPick());
    elements.btnSpinAgain?.addEventListener('click', () => this.handleRandomPick());
    elements.randomModalClose?.addEventListener('click', () => UI.closeModal(elements.randomModal));
    window.addEventListener('click', (e) => {
      if (e.target === elements.randomModal) UI.closeModal(elements.randomModal);
    });

    elements.btnFavoritesToggle?.addEventListener('click', () => {
      this.isShowingFavoritesOnly = !this.isShowingFavoritesOnly;
      elements.btnFavoritesToggle.classList.toggle('active', this.isShowingFavoritesOnly);
      UI.showToast(this.isShowingFavoritesOnly ? '已切換至我的收藏' : '已返回全部店家', 'info');
      this.applyFilterAndRender();
    });
  }

  async handleLocateMe() {
    UI.showToast('📡 正在偵測您的 GPS 位置...', 'info', 3000);
    try {
      const pos = await GeoService.getCurrentPosition();
      this.gpsLat = pos.lat;
      this.gpsLng = pos.lng;

      const addr = await GeoService.reverseGeocode(pos.lat, pos.lng);
      this.gpsLabel = addr;
      this.setLocation(pos.lat, pos.lng, addr);
      UI.showToast('📍 定位成功！正在搜尋周遭店家...', 'success');
    } catch (err) {
      console.warn('GPS 定位失敗:', err);
      UI.showToast(err.message || 'GPS 定位失敗，使用預設座標', 'error', 5000);
      this.gpsLat = this.currentLat;
      this.gpsLng = this.currentLng;
      this.gpsLabel = '台北市信義區 (預設)';
      this.setLocation(this.currentLat, this.currentLng, '台北市信義區 (預設)');
    }
  }

  async setLocation(lat, lng, label = '') {
    this.currentLat = lat;
    this.currentLng = lng;

    const displayText = label || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
    if (UI.elements.currentLocationText) UI.elements.currentLocationText.textContent = displayText;
    const mobileLocText = document.getElementById('mobileLocationText');
    if (mobileLocText) mobileLocText.textContent = displayText;

    if (this.mapReady) MapService.updateUserLocation(lat, lng, this.currentRadiusKm);
    await this.fetchPlaces();
  }

  async fetchPlaces() {
    if (this.isLoading) return;
    this.isLoading = true;
    UI.showLoadingSkeleton(5);

    const category = UI.elements.categoryFilter?.value || 'all';

    try {
      let places = [];
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

  applyFilterAndRender() {
    let list = this.isShowingFavoritesOnly
      ? Array.from(this.favoritePlaces.values())
      : [...this.allPlaces];

    const openOnly = UI.elements.openOnlyToggle?.checked;
    const searchKeyword = (UI.elements.searchKeywords?.value || '').trim().toLowerCase();
    const sortBy = UI.elements.sortBySelect?.value || 'distance';
    const priceLimit = document.getElementById('priceFilter')?.value || 'all';

    // 1. 營業中篩選
    if (openOnly) {
      list = list.filter(p => p.isOpen === true || p.isOpen === null);
    }

    // 2. 價位上限篩選
    if (priceLimit !== 'all') {
      const maxPrice = parseInt(priceLimit, 10);
      list = list.filter(p =>
        // 沒有價位資訊的保留（不確定）
        p.priceLevelNum === null ||
        p.priceLevelNum === 0 ||
        p.priceLevelNum <= maxPrice
      );
    }

    // 3. 關鍵字過濾
    if (searchKeyword) {
      list = list.filter(p =>
        p.name.toLowerCase().includes(searchKeyword) ||
        p.address.toLowerCase().includes(searchKeyword) ||
        (p.cuisine && p.cuisine.toLowerCase().includes(searchKeyword)) ||
        (p.category && p.category.toLowerCase().includes(searchKeyword))
      );
    }

    // 4. 排序
    switch (sortBy) {
      case 'distance': list.sort((a, b) => a.distanceKm - b.distanceKm); break;
      case 'closing_late': list.sort((a, b) => (b.closeMinutes || 0) - (a.closeMinutes || 0)); break;
      case 'closing_soon':
        list.sort((a, b) => {
          const aMin = (a.closeMinutes > 0) ? a.closeMinutes : 9999;
          const bMin = (b.closeMinutes > 0) ? b.closeMinutes : 9999;
          return aMin - bMin;
        });
        break;
      case 'rating': list.sort((a, b) => (b.rating || 0) - (a.rating || 0)); break;
      case 'name': list.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hant')); break;
    }

    this.filteredPlaces = list;

    // 更新 Tab 數量徽章
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
          // 手機版：切換回清單 Tab
          if (window.innerWidth < 900) {
            const panelList = document.getElementById('panelList');
            const panelMap = document.getElementById('panelMap');
            if (panelList && panelMap) {
              panelList.classList.remove('tab-hidden');
              panelMap.classList.add('tab-hidden');
              document.getElementById('tabList')?.classList.add('active');
              document.getElementById('tabMap')?.classList.remove('active');
            }
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

  handleRandomPick() {
    const currentRadius = this.currentRadiusKm;
    const inRadiusPlaces = this.filteredPlaces.filter(p => p.distanceKm <= (currentRadius + 0.05));

    if (inRadiusPlaces.length === 0) {
      UI.showRandomPick(null, currentRadius);
      return;
    }

    let candidates = inRadiusPlaces.filter(p => p.isOpen === true);
    if (candidates.length === 0) candidates = inRadiusPlaces;

    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    UI.showRandomPick(chosen, currentRadius);
  }

  loadFavorites() {
    try {
      const saved = localStorage.getItem('eatfinder_favorites');
      if (saved) JSON.parse(saved).forEach(p => this.favoritePlaces.set(p.id, p));
    } catch (e) { console.warn('載入收藏失敗:', e); }
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
    } catch (e) { console.warn('儲存收藏失敗:', e); }
    this.applyFilterAndRender();
  }
}

window.addEventListener('DOMContentLoaded', () => {
  const app = new EatFinderApp();
  app.init();
});
