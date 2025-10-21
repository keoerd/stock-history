// functions/api/kv/tickers.js

/**
 * API: /api/kv/tickers
 * - GET: KV에 저장된 마스터 티커 목록을 조회합니다.
 * - POST: 클라이언트에서 받은 티커 목록으로 KV를 업데이트합니다.
 */
export async function onRequest(context) {
    const { env, request } = context;
    const { MY_KV } = env; // KV 네임스페이스 바인딩

    try {
        switch (request.method) {
            case 'GET': {
                // "TICKER_MASTER_LIST" 키로 저장된 값을 가져옵니다.
                const tickersJson = await MY_KV.get("TICKER_MASTER_LIST");
                // 값이 없으면(null) 빈 배열 '[]'을 반환하여 프론트엔드 에러를 방지합니다.
                const responseBody = tickersJson || "[]";
                return new Response(responseBody, {
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            case 'POST': {
                // 요청 본문에서 티커 배열을 가져옵니다.
                const tickers = await request.json();
                // KV에 JSON 문자열 형태로 저장합니다.
                await MY_KV.put("TICKER_MASTER_LIST", JSON.stringify(tickers));
                return new Response(JSON.stringify({ success: true }), {
                    headers: { 'Content-Type': 'application/json' },
                });
            }

            default:
                return new Response('Method Not Allowed', { status: 405 });
        }
    } catch (error) {
        console.error("Tickers API Error:", error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
