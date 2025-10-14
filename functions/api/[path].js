// functions/api/[[path]].js

export async function onRequest(context) {
    const { env, request, params } = context;
    const url = new URL(request.url);
    const path = params.path; // e.g., ['tickers'] or ['history', 'TSLA']

    try {
        // --- 티커 목록 관리 API ---
        // 경로: /api/tickers
        if (path[0] === 'tickers') {
            // GET: 전체 티커 목록 불러오기
            if (request.method === 'GET') {
                const tickers = await env.TICKER_KV.get("TICKER_MASTER_LIST") || "[]";
                return new Response(tickers, { headers: { 'Content-Type': 'application/json' } });
            }
            // POST: 전체 티커 목록 저장하기
            if (request.method === 'POST') {
                const body = await request.json();
                await env.TICKER_KV.put("TICKER_MASTER_LIST", JSON.stringify(body));
                return new Response(JSON.stringify({ success: true }));
            }
        }

        // --- 분석 히스토리 API ---
        // 경로: /api/history/TSLA
        if (path[0] === 'history' && path[1]) {
            const ticker = path[1].toUpperCase();
            const stmt = env.DB.prepare(
                "SELECT * FROM analysis_history WHERE ticker = ? ORDER BY timestamp DESC"
            ).bind(ticker);
            const { results } = await stmt.all();
            return new Response(JSON.stringify(results), { headers: { 'Content-Type': 'application/json' } });
        }

        return new Response("Not Found", { status: 404 });

    } catch (error) {
        return new Response(error.message, { status: 500 });
    }
}
