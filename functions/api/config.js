/**
 * functions/api/config.js - Cloudflare Pages Function
 * 自動讀取 Cloudflare Dashboard 中設定的環境變數 GOOGLE_MAPS_API_KEY
 */

export async function onRequest(context) {
  const env = context.env || {};
  const apiKey = env.GOOGLE_MAPS_API_KEY || "";

  return new Response(JSON.stringify({
    GOOGLE_MAPS_API_KEY: apiKey
  }), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*"
    }
  });
}
