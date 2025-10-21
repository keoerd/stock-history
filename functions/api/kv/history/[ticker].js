// functions/api/kv/history/[ticker].js

/**
 * API: /api/kv/history/[ticker]
 * - GET: URL 경로에서 [ticker] 파라미터를 받아 D1에서 해당 티커의 분석 기록을 조회합니다.
 */
export async function onRequest(context) {
    const { env, request, params } = context;
    const { DB } = env; // D1 데이터베이스 바인딩
    const ticker = params.ticker?.toUpperCase(); // URL 경로에서 동적 파라미터 추출

    if (request.method !== 'GET') {
        return new Response('Method Not Allowed', { status: 405 });
    }

    if (!ticker) {
        return new Response('Ticker parameter is required.', { status: 400 });
    }

    try {
        // D1에서 해당 티커의 모든 기록을 시간 내림차순으로 조회
        const stmt = DB.prepare(
            "SELECT * FROM analysis_history WHERE ticker = ? ORDER BY timestamp DESC"
        ).bind(ticker);

        const { results } = await stmt.all();

        return new Response(JSON.stringify(results), {
            headers: { 'Content-Type': 'application/json' },
        });

    } catch (error) {
        console.error(`History API Error for ${ticker}:`, error);
        return new Response('Internal Server Error', { status: 500 });
    }
}
