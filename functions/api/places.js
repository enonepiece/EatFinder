/**
 * functions/api/places.js - Cloudflare Pages Function Proxy
 * 透過邊緣伺服器轉發 Google Places API (New) 請求
 * 100% 解決瀏覽器 CORS 問題，API Key 完全保護在伺服器端
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type"
};

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: CORS_HEADERS
  });
}

export async function onRequestPost(context) {
  const env = context.env || {};
  const apiKey = env.GOOGLE_MAPS_API_KEY || "";

  if (!apiKey) {
    return new Response(JSON.stringify({
      error: { message: "Cloudflare 環境變數 GOOGLE_MAPS_API_KEY 未設定。請至 Cloudflare Pages 後台 → Settings → Environment variables 新增此變數。" }
    }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
    });
  }

  let requestBody;
  try {
    requestBody = await context.request.json();
  } catch (_) {
    return new Response(JSON.stringify({
      error: { message: "請求 Body 格式錯誤，需為有效 JSON" }
    }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
    });
  }

  // 確保 languageCode 欄位
  if (!requestBody.languageCode) {
    requestBody.languageCode = "zh-TW";
  }

  try {
    const endpoint = requestBody.endpoint === "searchText" ? "searchText" : "searchNearby";
    delete requestBody.endpoint;
    const googleUrl = `https://places.googleapis.com/v1/places:${endpoint}`;

    const googleRes = await fetch(googleUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        // 關鍵：讓 Google API Key 的 HTTP Referrer 白名單校驗通過
        // Cloudflare Worker 不帶 Referer，加上後 Google 就認得這是合法請求
        "Referer": "https://eatfinder.pages.dev/",
        "Origin": "https://eatfinder.pages.dev",
        "X-Goog-FieldMask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.location",
          "places.rating",
          "places.userRatingCount",
          "places.currentOpeningHours",
          "places.regularOpeningHours",
          "places.googleMapsUri",
          "places.websiteUri",
          "places.nationalPhoneNumber",
          "places.priceLevel",
          "places.primaryType"
        ].join(",")
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await googleRes.text();

    if (!googleRes.ok) {
      // 嘗試解析 Google 錯誤訊息
      let errMsg = `Google Places API 回傳錯誤 (${googleRes.status})`;
      try {
        const errJson = JSON.parse(responseText);
        if (errJson?.error?.message) errMsg = errJson.error.message;
      } catch (_) {}

      console.error(`[places proxy] Google error ${googleRes.status}: ${errMsg}`);
      return new Response(JSON.stringify({ error: { message: errMsg, status: googleRes.status } }), {
        status: googleRes.status,
        headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
      });
    }

    return new Response(responseText, {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "public, max-age=180", // 快取 3 分鐘
        ...CORS_HEADERS
      }
    });

  } catch (err) {
    console.error("[places proxy] Fetch 失敗:", err.message);
    return new Response(JSON.stringify({
      error: { message: `轉發 Google Places 請求失敗：${err.message}` }
    }), {
      status: 500,
      headers: { "Content-Type": "application/json; charset=utf-8", ...CORS_HEADERS }
    });
  }
}
