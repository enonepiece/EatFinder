/**
 * ui.js - 介面渲染、互動控制器與元件管理
 */

export const UI = {
  // DOM 元素快取
  elements: {},

  init() {
    this.elements = {
      placesList: document.getElementById('placesList'),
      placesCount: document.getElementById('placesCount'),
      currentLocationText: document.getElementById('currentLocationText'),
      searchRadiusSelect: document.getElementById('searchRadius'),
      categoryFilter: document.getElementById('categoryFilter'),
      openOnlyToggle: document.getElementById('openOnlyToggle'),
      sortBySelect: document.getElementById('sortBy'),
      searchKeywords: document.getElementById('searchKeywords'),
      btnLocateMe: document.getElementById('btnLocateMe'),
      btnRandomPick: document.getElementById('btnRandomPick'),
      btnSettings: document.getElementById('btnSettings'),
      btnFavoritesToggle: document.getElementById('btnFavoritesToggle'),
      // Modals
      randomModal: document.getElementById('randomModal'),
      randomModalClose: document.getElementById('randomModalClose'),
      randomPickResult: document.getElementById('randomPickResult'),
      btnSpinAgain: document.getElementById('btnSpinAgain'),
      toastContainer: document.getElementById('toastContainer')
    };
  },

  /**
   * 顯示 Toast 通知訊息
   */
  showToast(message, type = 'info', duration = 3500) {
    if (!this.elements.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `
      <span class="toast-icon">${icon}</span>
      <span class="toast-text">${message}</span>
    `;

    this.elements.toastContainer.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-show');
    }, 10);

    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  /**
   * 顯示載入中骨架屏 (Skeleton)
   */
  showLoadingSkeleton(count = 6) {
    if (!this.elements.placesList) return;
    let skeletonHtml = '';
    for (let i = 0; i < count; i++) {
      skeletonHtml += `
        <div class="place-card skeleton-card">
          <div class="skeleton-line title"></div>
          <div class="skeleton-line badge"></div>
          <div class="skeleton-line row"></div>
          <div class="skeleton-line row short"></div>
          <div class="skeleton-actions">
            <div class="skeleton-btn"></div>
            <div class="skeleton-btn"></div>
          </div>
        </div>
      `;
    }
    this.elements.placesList.innerHTML = skeletonHtml;
  },

  /**
   * 渲染店家清單卡片
   * @param {Array<Object>} places 
   * @param {Function} onCardClick 
   * @param {Function} onFavoriteToggle 
   * @param {Set<string>} favoriteIds 
   */
  renderPlaces(places, onCardClick = null, onFavoriteToggle = null, favoriteIds = new Set()) {
    if (!this.elements.placesList) return;

    if (this.elements.placesCount) {
      this.elements.placesCount.textContent = `${places.length} 間店家`;
    }

    if (places.length === 0) {
      this.elements.placesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🍽️🔍</div>
          <h3>找不到符合條件的店家</h3>
          <p>請嘗試放大搜尋半徑、調整營業中篩選，或更換類別關鍵字。</p>
        </div>
      `;
      return;
    }

    const cardsHtml = places.map((place) => {
      const isFav = favoriteIds.has(place.id);
      const isCurrentlyOpen = place.isOpen === true;
      const isClosed = place.isOpen === false;

      let statusBadgeClass = 'status-unknown';
      let statusBadgeLabel = '時段未定';
      if (isCurrentlyOpen) {
        statusBadgeClass = 'status-open';
        statusBadgeLabel = '● 營業中';
      } else if (isClosed) {
        statusBadgeClass = 'status-closed';
        statusBadgeLabel = '● 本日已打烊';
      }

      return `
        <article class="place-card ${isCurrentlyOpen ? 'is-open' : ''}" data-id="${place.id}" data-lat="${place.lat}" data-lng="${place.lng}">
          <div class="card-header">
            <div class="card-title-group">
              <span class="category-tag">${place.categoryIcon || '🍽️'} ${place.category || '餐飲美食'}</span>
              <h3 class="place-name" title="${this.escapeHtml(place.name)}">${this.escapeHtml(place.name)}</h3>
            </div>
            <button class="btn-fav ${isFav ? 'active' : ''}" data-id="${place.id}" title="${isFav ? '取消收藏' : '加入收藏'}" aria-label="收藏店家">
              ${isFav ? '❤️' : '🤍'}
            </button>
          </div>

          <!-- 營業狀態、距離與評價 -->
          <div class="info-badge-row">
            <span class="status-badge ${statusBadgeClass}">${statusBadgeLabel}</span>
            <span class="distance-badge">📍 距離 ${place.distanceText}</span>
            ${place.rating ? `<span class="rating-badge">★ ${place.rating.toFixed(1)} ${place.userRatingCount ? `(${place.userRatingCount})` : ''}</span>` : ''}
            ${place.priceLevel ? `<span class="price-badge">${place.priceLevel}</span>` : ''}
          </div>

          <div class="card-body">
            <!-- 今日營業時間 -->
            <div class="card-detail-item hours-item">
              <span class="detail-icon">🕒</span>
              <div class="detail-content">
                <span class="detail-label">今日營業時間</span>
                <span class="detail-value hours-value">${this.escapeHtml(place.todayHoursText || '依現場公告為準')}</span>
                ${place.statusText ? `<span class="status-hint">${this.escapeHtml(place.statusText)}</span>` : ''}
              </div>
            </div>

            <!-- 店家地址 -->
            <div class="card-detail-item">
              <span class="detail-icon">🏠</span>
              <div class="detail-content">
                <span class="detail-label">地址</span>
                <span class="detail-value address-value">${this.escapeHtml(place.address)}</span>
              </div>
            </div>

            ${place.cuisine ? `
            <div class="card-detail-item">
              <span class="detail-icon">🍲</span>
              <div class="detail-content">
                <span class="detail-label">料理種類</span>
                <span class="detail-value">${this.escapeHtml(place.cuisine)}</span>
              </div>
            </div>` : ''}
          </div>

          <div class="card-footer">
            <a href="${place.googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-action btn-google-map" title="前往 Google 地圖查看詳細資訊、菜單與評論">
              <svg class="google-icon" viewBox="0 0 24 24" width="16" height="16" fill="currentColor">
                <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/>
              </svg>
              <span>Google Maps 連結</span>
              <svg class="external-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path><polyline points="15 3 21 3 21 9"></polyline><line x1="10" y1="14" x2="21" y2="3"></line></svg>
            </a>

            <a href="${place.directionsUrl}" target="_blank" rel="noopener noreferrer" class="btn-action btn-navigate" title="規劃導航路徑">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
              <span>導航前往</span>
            </a>

            ${place.phone ? `
              <a href="tel:${place.phone}" class="btn-action btn-call" title="撥打電話 ${this.escapeHtml(place.phone)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              </a>
            ` : ''}
          </div>
        </article>
      `;
    }).join('');

    this.elements.placesList.innerHTML = cardsHtml;

    // 綁定卡片點擊事件
    if (onCardClick) {
      const cards = this.elements.placesList.querySelectorAll('.place-card');
      cards.forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('a') || e.target.closest('button')) return;
          const id = card.dataset.id;
          const lat = parseFloat(card.dataset.lat);
          const lng = parseFloat(card.dataset.lng);
          onCardClick(id, lat, lng);
        });
      });
    }

    // 綁定收藏點擊事件
    if (onFavoriteToggle) {
      const favBtns = this.elements.placesList.querySelectorAll('.btn-fav');
      favBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const id = btn.dataset.id;
          const place = places.find(p => p.id === id);
          if (place) {
            onFavoriteToggle(place);
          }
        });
      });
    }
  },

  /**
   * 呈現隨機挑選轉盤結果
   */
  showRandomPick(place) {
    if (!this.elements.randomPickResult || !this.elements.randomModal) return;

    if (!place) {
      this.elements.randomPickResult.innerHTML = `
        <div class="random-empty">
          <p>目前篩選範圍內沒有可推薦的營業中店家！</p>
        </div>
      `;
    } else {
      this.elements.randomPickResult.innerHTML = `
        <div class="random-winner-card animate-pop">
          <div class="winner-badge">🎉 命運決定就是這家！</div>
          <div class="winner-icon">${place.categoryIcon || '🍽️'}</div>
          <h2 class="winner-name">${this.escapeHtml(place.name)}</h2>
          <div class="winner-meta">
            <span class="winner-category">${place.category || '餐飲美食'}</span>
            <span class="winner-dist">📍 距離 ${place.distanceText}</span>
            <span class="winner-status ${place.isOpen ? 'open' : ''}">${place.isOpen ? '● 營業中' : '● 時段待確認'}</span>
          </div>
          
          <div class="winner-info-box">
            <div class="info-row">
              <span class="label">🕒 今日營業時間：</span>
              <span class="val highlight">${this.escapeHtml(place.todayHoursText || '依現場公告')}</span>
            </div>
            <div class="info-row">
              <span class="label">🏠 店家地址：</span>
              <span class="val">${this.escapeHtml(place.address)}</span>
            </div>
          </div>

          <div class="winner-actions">
            <a href="${place.googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-winner-primary">
              <svg class="google-icon" viewBox="0 0 24 24" width="18" height="18" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              <span>前往 Google Maps 查看</span>
            </a>
            <a href="${place.directionsUrl}" target="_blank" rel="noopener noreferrer" class="btn-winner-secondary">
              立即導航
            </a>
          </div>
        </div>
      `;
    }

    this.elements.randomModal.classList.add('modal-open');
  },

  closeModal(modal) {
    if (modal) modal.classList.remove('modal-open');
  },

  escapeHtml(text) {
    if (!text) return '';
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
};
