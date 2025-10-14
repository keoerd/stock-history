// Cloudflare Worker 환경에서는 fetch가 기본적으로 제공됩니다.

const NASDAQ_API_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36",
  Accept: "application/json, text/plain, */*",
  "Accept-Language": "en-US,en;q=0.9",
};

export async function onRequest(context) {
  try {
    // 1. URL 경로에서 동적 파라미터(ticker)를 추출합니다.
    const { ticker } = context.params;

    // ==========================================================
    // ## 변경된 부분: Vue 앱이 보낸 쿼리 스트링을 그대로 사용 ##
    // ==========================================================
    // 2. 들어온 요청 URL에서 쿼리 스트링(?key=value...) 부분을 추출합니다.
    const { search } = new URL(context.request.url);

    // 3. 실제 Nasdaq API URL을 만듭니다. (티커 + 추출한 쿼리 스트링)
    const url = `https://api.nasdaq.com/api/quote/${ticker}/option-chain${search}`;
    // ==========================================================

    // 4. Nasdaq API에 데이터를 요청합니다.
    const response = await fetch(url, { headers: NASDAQ_API_HEADERS });

    if (!response.ok) {
      throw new Error(`Nasdaq API error! status: ${response.status}`);
    }

    const data = await response.json();

    // 5. Vue 앱으로 응답을 보냅니다.
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };

    return new Response(JSON.stringify(data), { headers });

  } catch (error) {
    const headers = {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    };
    return new Response(JSON.stringify({ error: error.message }), { status: 500, headers });
  }
}
