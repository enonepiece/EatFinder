/**
 * functions/api/places.js - Cloudflare Pages Function Proxy
 * 透過邊緣伺服器轉發 Google Places API (New) 請求
 * 優點：100% 解決瀏覽器 CORS 限制，並完全隱藏 API Key
 */

export async function onRequestPost(context) {
  const env = context.env || {};
  const apiKey = env.GOOGLE_MAPS_API_KEY || "";

  if (!apiKey) {
    return new Response(JSON.stringify({
      error: { message: "Cloudflare 未設定 GOOGLE_MAPS_API_KEY 環境變數" }
    }), {
      status: 400,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }

  try {
    const body = await context.request.json();
    const googleUrl = "https://places.googleapis.com/v1/places:searchNearby";

    const googleRes = await fetch(googleUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": apiKey,
        "X-Goog-Language-Code": "zh-TW",
        "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location,places.rating,places.userRatingCount,places.currentOpeningHours,places.regularOpeningHours,places.googleMapsUri,places.websiteUri,places.nationalPhoneNumber,places.priceLevel,places.primaryType"
      },
      body: JSON.stringify(body)
    });

    const data = await googleRes.text();

    return new Response(data, {
      status: googleRes.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
        "Cache-Control": "public, max-age=300"
      }
    });
  } catch (err) {
    return new Response(JSON.stringify({
      error: { message: err.message || "轉發 Google Places 請求失敗" }
    }), {
      status: 500,
      headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" }
    });
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}
