/**
 * config.js - API Key 管理與 Google Maps SDK 動態載入器
 * 支援從 Cloudflare Pages 環境變數 (/api/config)、本機 env.js 或 LocalStorage 讀取
 */

export const Config = {
  resolvedKey: null,

  /**
   * 非同步取得 Google Maps / Places API Key
   * 優先順序：
   * 1. Cloudflare Pages Functions (/api/config)
   * 2. 本機 window.ENV (env.js)
   * 3. LocalStorage
   */
  async resolveApiKey() {
    if (this.resolvedKey) {
      return this.resolvedKey;
    }

    // 1. 優先嘗試呼叫 Cloudflare Pages Function (/api/config)
    try {
      const res = await fetch('/api/config', {
        headers: { 'Accept': 'application/json' }
      });
      if (res.ok) {
        const data = await res.json();
        if (data && data.GOOGLE_MAPS_API_KEY && data.GOOGLE_MAPS_API_KEY.trim()) {
          this.resolvedKey = data.GOOGLE_MAPS_API_KEY.trim();
          console.log('☁️ 成功從 Cloudflare Pages 環境變數載入 API Key');
          return this.resolvedKey;
        }
      }
    } catch (e) {
      // 本機未啟動 functions 或一般 http server 時忽略
    }

    // 2. 本機 window.ENV (嘗試動態載入 env.js 或讀取已存在的 window.ENV)
    if (typeof window !== 'undefined') {
      if (window.ENV && window.ENV.GOOGLE_MAPS_API_KEY && window.ENV.GOOGLE_MAPS_API_KEY.trim() && window.ENV.GOOGLE_MAPS_API_KEY !== 'your_google_maps_api_key_here') {
        this.resolvedKey = window.ENV.GOOGLE_MAPS_API_KEY.trim();
        return this.resolvedKey;
      }
      
      // 若尚未載入 env.js，嘗試在本地環境動態載入 env.js
      try {
        await new Promise((resolve) => {
          const s = document.createElement('script');
          s.src = 'env.js';
          s.onload = () => resolve();
          s.onerror = () => resolve(); // 若不存在或線上環境則略過
          document.head.appendChild(s);
        });
        if (window.ENV && window.ENV.GOOGLE_MAPS_API_KEY && window.ENV.GOOGLE_MAPS_API_KEY.trim() && window.ENV.GOOGLE_MAPS_API_KEY !== 'your_google_maps_api_key_here') {
          this.resolvedKey = window.ENV.GOOGLE_MAPS_API_KEY.trim();
          return this.resolvedKey;
        }
      } catch (err) {
        // 忽略
      }
    }

    // 3. 本機 LocalStorage
    const localKey = localStorage.getItem('eatfinder_google_api_key');
    if (localKey && localKey.trim()) {
      this.resolvedKey = localKey.trim();
      return this.resolvedKey;
    }

    return '';
  },

  getGoogleApiKey() {
    return this.resolvedKey || (typeof window !== 'undefined' && window.ENV?.GOOGLE_MAPS_API_KEY) || localStorage.getItem('eatfinder_google_api_key') || '';
  },

  setGoogleApiKey(key) {
    this.resolvedKey = key ? key.trim() : '';
    if (key) {
      localStorage.setItem('eatfinder_google_api_key', key.trim());
    } else {
      localStorage.removeItem('eatfinder_google_api_key');
    }
  },

  hasGoogleApiKey() {
    return Boolean(this.getGoogleApiKey());
  },

  /**
   * 動態載入 Google Maps JavaScript API (強制繁體中文與台灣地區)
   */
  async loadGoogleMapsSDK() {
    if (window.google && window.google.maps) {
      return window.google.maps;
    }

    const apiKey = await this.resolveApiKey();
    if (!apiKey) {
      throw new Error('未偵測到 Google Maps API Key。請在 Cloudflare Pages 環境變數或 env.js 填入金鑰');
    }

    return new Promise((resolve, reject) => {
      const scriptId = 'google-maps-sdk-script';
      let existingScript = document.getElementById(scriptId);
      if (existingScript) {
        existingScript.remove();
      }

      const script = document.createElement('script');
      script.id = scriptId;
      // 強制使用繁體中文 (language=zh-TW) 與台灣地區 (region=TW)
      script.src = `https://maps.googleapis.com/maps/api/js?key=${apiKey}&libraries=places,geometry&language=zh-TW&region=TW`;
      script.async = true;
      script.defer = true;

      script.onload = () => {
        if (window.google && window.google.maps) {
          resolve(window.google.maps);
        } else {
          reject(new Error('Google Maps SDK 載入異常'));
        }
      };

      script.onerror = () => {
        reject(new Error('Google Maps SDK 載入失敗，請檢查 API Key 是否正確且已在 Google Console 允許 Cloudflare 網址'));
      };

      document.head.appendChild(script);
    });
  }
};
