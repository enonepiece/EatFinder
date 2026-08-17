/**
 * config.js - API Key 管理與 Google Maps SDK 動態載入器
 */

export const Config = {
  resolvedKey: null,

  /**
   * 解析 API Key
   * 優先順序：Cloudflare /api/config → window.ENV → localStorage
   */
  async resolveApiKey() {
    if (this.resolvedKey) return this.resolvedKey;

    // 1. Cloudflare Pages Function（帶 5 秒 timeout 防止 cold start 卡住）
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch('/api/config', {
        headers: { 'Accept': 'application/json' },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        const key = data?.GOOGLE_MAPS_API_KEY?.trim();
        if (key && key !== 'your_google_maps_api_key_here') {
          this.resolvedKey = key;
          console.log('☁️ 成功從 Cloudflare 環境變數載入 API Key');
          return this.resolvedKey;
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.warn('/api/config 請求失敗:', e.message);
      } else {
        console.warn('/api/config 超時（Cloudflare cold start），嘗試備援方式');
      }
    }

    // 2. window.ENV（本機 env.js）
    if (typeof window !== 'undefined') {
      const envKey = window.ENV?.GOOGLE_MAPS_API_KEY?.trim();
      if (envKey && envKey !== 'your_google_maps_api_key_here') {
        this.resolvedKey = envKey;
        return this.resolvedKey;
      }

      // 嘗試動態載入 env.js
      try {
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = 'env.js?' + Date.now(); // 避免快取
          s.onload = resolve;
          s.onerror = resolve;
          document.head.appendChild(s);
        });
        const envKey2 = window.ENV?.GOOGLE_MAPS_API_KEY?.trim();
        if (envKey2 && envKey2 !== 'your_google_maps_api_key_here') {
          this.resolvedKey = envKey2;
          return this.resolvedKey;
        }
      } catch (_) {}
    }

    // 3. localStorage
    const localKey = localStorage.getItem('eatfinder_google_api_key')?.trim();
    if (localKey) {
      this.resolvedKey = localKey;
      return this.resolvedKey;
    }

    return '';
  },

  getGoogleApiKey() {
    return this.resolvedKey
      || (typeof window !== 'undefined' && window.ENV?.GOOGLE_MAPS_API_KEY)
      || localStorage.getItem('eatfinder_google_api_key')
      || '';
  },

  setGoogleApiKey(key) {
    this.resolvedKey = key ? key.trim() : '';
    if (key) localStorage.setItem('eatfinder_google_api_key', key.trim());
    else localStorage.removeItem('eatfinder_google_api_key');
  },

  hasGoogleApiKey() {
    return Boolean(this.getGoogleApiKey());
  },

  /**
   * 動態載入 Google Maps JavaScript API
   */
  async loadGoogleMapsSDK() {
    if (window.google?.maps) return window.google.maps;

    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new Error('未偵測到 Google Maps API Key。請在 Cloudflare Pages 環境變數設定 GOOGLE_MAPS_API_KEY');
    }

    return new Promise((resolve, reject) => {
      // 設定 10 秒 timeout 防止 SDK 載入卡住
      const timeout = setTimeout(() => {
        reject(new Error('Google Maps SDK 載入超時，請檢查網路連線'));
      }, 10000);

      const scriptId = 'google-maps-sdk-script';
      document.getElementById(scriptId)?.remove();

      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&language=zh-TW&region=TW`;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        clearTimeout(timeout);
        if (window.google?.maps) {
          resolve(window.google.maps);
        } else {
          reject(new Error('Google Maps SDK 載入異常'));
        }
      };

      script.onerror = (e) => {
        clearTimeout(timeout);
        reject(new Error('Google Maps SDK 載入失敗。請確認：(1) API Key 正確 (2) Google Cloud Console 已加入 eatfinder.pages.dev/* 白名單'));
      };

      document.head.appendChild(script);
    });
  }
};
