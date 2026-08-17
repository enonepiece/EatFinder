/**
 * ui.js - 介面渲染、互動控制器與元件管理
 */

export const UI = {
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
      btnFavoritesToggle: document.getElementById('btnFavoritesToggle'),
      randomModal: document.getElementById('randomModal'),
      randomModalClose: document.getElementById('randomModalClose'),
      randomPickResult: document.getElementById('randomPickResult'),
      btnSpinAgain: document.getElementById('btnSpinAgain'),
      toastContainer: document.getElementById('toastContainer')
    };
  },

  /**
   * Toast 通知
   */
  showToast(message, type = 'info', duration = 3500) {
    if (!this.elements.toastContainer) return;

    const toast = document.createElement('div');
    toast.className = `toast-item toast-${type}`;
    const icon = type === 'success' ? '✅' : type === 'error' ? '⚠️' : 'ℹ️';
    toast.innerHTML = `<span>${icon}</span><span>${message}</span>`;

    this.elements.toastContainer.appendChild(toast);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => toast.classList.add('toast-show'));
    });

    setTimeout(() => {
      toast.classList.remove('toast-show');
      setTimeout(() => toast.remove(), 350);
    }, duration);
  },

  /**
   * 骨架屏
   */
  showLoadingSkeleton(count = 5) {
    if (!this.elements.placesList) return;
    let html = '';
    for (let i = 0; i < count; i++) {
      html += `
        <div class="place-card skeleton-card">
          <div style="display:flex;gap:0.5rem;align-items:center;">
            <div class="skeleton-line badge" style="width:30%;height:13px;"></div>
          </div>
          <div class="skeleton-line title"></div>
          <div class="skeleton-line row"></div>
          <div class="skeleton-line row short"></div>
          <div class="skeleton-actions">
            <div class="skeleton-btn"></div>
            <div class="skeleton-btn"></div>
          </div>
        </div>
      `;
    }
    this.elements.placesList.innerHTML = html;
    if (this.elements.placesCount) {
      this.elements.placesCount.textContent = '搜尋中...';
    }
  },

  /**
   * 渲染店家清單卡片
   */
  renderPlaces(places, onCardClick = null, onFavoriteToggle = null, favoriteIds = new Set()) {
    if (!this.elements.placesList) return;

    if (this.elements.placesCount) {
      this.elements.placesCount.textContent = `${places.length} 間`;
    }

    if (places.length === 0) {
      this.elements.placesList.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>找不到符合條件的店家</h3>
          <p>請嘗試放大搜尋半徑、關閉「只顯示營業中」篩選，或更換類別。</p>
        </div>
      `;
      return;
    }

    const cardsHtml = places.map((place) => {
      const isFav = favoriteIds.has(place.id);
      const isOpen = place.isOpen === true;
      const isClosed = place.isOpen === false;

      let statusClass = 'status-unknown';
      let statusLabel = '● 時段未定';
      if (isOpen) { statusClass = 'status-open'; statusLabel = '● 營業中'; }
      else if (isClosed) { statusClass = 'status-closed'; statusLabel = '● 已打烊'; }

      // 評分星星
      let starHtml = '';
      if (place.rating) {
        const full = Math.floor(place.rating);
        const half = place.rating - full >= 0.5;
        starHtml = '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(Math.max(0, 5 - full - (half ? 1 : 0)));
      }

      return `
        <article class="place-card ${isOpen ? 'is-open' : isClosed ? 'is-closed' : ''}" data-id="${place.id}" data-lat="${place.lat}" data-lng="${place.lng}">
          <div class="card-header">
            <div class="card-title-group">
              <span class="category-tag">${place.categoryIcon || '🍽️'} ${place.category || '餐飲'}</span>
              <h3 class="place-name" title="${this.escapeHtml(place.name)}">${this.escapeHtml(place.name)}</h3>
            </div>
            <button class="btn-fav ${isFav ? 'active' : ''}" data-id="${place.id}" aria-label="${isFav ? '取消收藏' : '加入收藏'}">
              ${isFav ? '❤️' : '🤍'}
            </button>
          </div>

          <div class="info-badge-row">
            <span class="status-badge ${statusClass}">${statusLabel}</span>
            <span class="distance-badge">📍 ${place.distanceText}</span>
            ${place.rating ? `<span class="rating-badge" title="${place.userRatingCount ? place.userRatingCount + ' 則評論' : ''}">★ ${place.rating.toFixed(1)}${place.userRatingCount ? ` (${this._formatCount(place.userRatingCount)})` : ''}</span>` : ''}
            ${place.priceLevel ? `<span class="rating-badge" title="價位">${place.priceLevel}</span>` : ''}
          </div>

          <div class="card-body">
            <div class="card-detail-item">
              <span class="detail-icon">🕒</span>
              <div class="detail-content">
                <span class="detail-label">今日營業時間</span>
                <span class="detail-value hours-value">${this.escapeHtml(place.todayHoursText || '依現場公告為準')}</span>
              </div>
            </div>

            <div class="card-detail-item">
              <span class="detail-icon">📍</span>
              <div class="detail-content">
                <span class="detail-label">地址</span>
                <span class="detail-value address-value" title="${this.escapeHtml(place.address)}">${this.escapeHtml(place.address)}</span>
              </div>
            </div>
          </div>

          <div class="card-footer">
            <a href="${place.googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-action btn-google-map" title="在 Google Maps 查看">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              <span>查看</span>
            </a>
            <a href="${place.directionsUrl}" target="_blank" rel="noopener noreferrer" class="btn-action btn-navigate" title="導航前往">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="3 11 22 2 13 21 11 13 3 11"></polygon></svg>
              <span>導航</span>
            </a>
            ${place.phone ? `
              <a href="tel:${place.phone}" class="btn-action btn-call" title="電話 ${this.escapeHtml(place.phone)}">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z"></path></svg>
              </a>
            ` : ''}
          </div>
        </article>
      `;
    }).join('');

    this.elements.placesList.innerHTML = cardsHtml;

    // 綁定卡片點擊
    if (onCardClick) {
      this.elements.placesList.querySelectorAll('.place-card').forEach(card => {
        card.addEventListener('click', (e) => {
          if (e.target.closest('a') || e.target.closest('button')) return;
          onCardClick(card.dataset.id, parseFloat(card.dataset.lat), parseFloat(card.dataset.lng));
        });
      });
    }

    // 綁定收藏點擊
    if (onFavoriteToggle) {
      this.elements.placesList.querySelectorAll('.btn-fav').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const place = places.find(p => p.id === btn.dataset.id);
          if (place) onFavoriteToggle(place);
        });
      });
    }
  },

  /**
   * 呈現隨機推薦結果
   */
  showRandomPick(place, radiusKm = 3) {
    if (!this.elements.randomPickResult || !this.elements.randomModal) return;

    if (!place) {
      this.elements.randomPickResult.innerHTML = `
        <div class="random-empty">
          <div style="font-size:2.5rem;margin-bottom:0.75rem;">🍽️</div>
          <p>目前半徑 <strong>${radiusKm} 公里</strong>內找不到可推薦的店家，請嘗試加大搜尋半徑或關閉「只顯示營業中」篩選。</p>
        </div>
      `;
    } else {
      this.elements.randomPickResult.innerHTML = `
        <div class="random-winner-card">
          <div class="winner-badge">🎯 半徑 ${radiusKm} 公里・命運推薦</div>
          <div class="winner-icon">${place.categoryIcon || '🍽️'}</div>
          <h2 class="winner-name">${this.escapeHtml(place.name)}</h2>
          <div class="winner-meta">
            <span>${place.category || '餐飲'}</span>
            <span>📍 ${place.distanceText}</span>
            <span class="winner-status ${place.isOpen ? 'open' : ''}">${place.isOpen ? '● 營業中' : '● 時段待確認'}</span>
            ${place.rating ? `<span>★ ${place.rating.toFixed(1)}</span>` : ''}
          </div>

          <div class="winner-info-box">
            <div class="info-row">
              <span class="label">今日營業時間</span>
              <span class="val highlight">${this.escapeHtml(place.todayHoursText || '依現場公告')}</span>
            </div>
            <div class="info-row">
              <span class="label">店家地址</span>
              <span class="val">${this.escapeHtml(place.address)}</span>
            </div>
          </div>

          <div class="winner-actions">
            <a href="${place.googleMapsUrl}" target="_blank" rel="noopener noreferrer" class="btn-winner-primary">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
              Google Maps
            </a>
            <a href="${place.directionsUrl}" target="_blank" rel="noopener noreferrer" class="btn-winner-secondary">
              🧭 導航
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

  _formatCount(n) {
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return n;
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
