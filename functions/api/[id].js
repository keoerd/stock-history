/**
 * 사용자 ID를 기반으로 티커 목록을 KV에 저장하고 불러옵니다.
 * - POST /api/kv/tickers/{id} : 요청 본문의 티커 배열을 해당 ID로 저장합니다.
 * - GET /api/kv/tickers/{id}  : 해당 ID로 저장된 티커 배열을 불러옵니다.
 */
export async function onRequest(context) {
  // 1. KV 네임스페이스에 접근합니다.
  // wrangler.toml 파일에 'MY_KV'라는 이름으로 바인딩이 설정되어 있어야 합니다.
  const { MY_KV } = context.env;
  const { id } = context.params;

  // 2. 사용자 ID (라우트 파라미터)가 유효한지 확인합니다.
  if (!id) {
    return new Response('User ID is required in the URL path.', { status: 400 });
  }

  // 3. 전체 로직을 try...catch로 감싸 에러를 안전하게 처리합니다.
  try {
    switch (context.request.method) {
      // 4. POST 요청 (티커 저장)
      case 'POST': {
        const tickers = await context.request.json();

        // KV에는 문자열만 저장 가능하므로, 배열을 JSON 문자열로 변환합니다.
        await MY_KV.put(id, JSON.stringify(tickers));

        return new Response(JSON.stringify({ success: true, message: `Tickers saved for user: ${id}` }), {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 5. GET 요청 (티커 불러오기)
      case 'GET': {
        const tickersJson = await MY_KV.get(id);

        // KV에서 해당 ID로 데이터를 찾지 못한 경우 (null 반환)
        if (tickersJson === null) {
          // 클라이언트가 파싱 에러를 겪지 않도록 빈 배열 형태의 JSON 문자열을 반환합니다.
          return new Response('[]', {
            headers: { 'Content-Type': 'application/json' },
          });
        }

        // 성공적으로 데이터를 찾은 경우, 저장된 JSON 문자열을 그대로 반환합니다.
        return new Response(tickersJson, {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // 6. 허용되지 않은 다른 HTTP 메소드 처리
      default:
        return new Response('Method Not Allowed', { status: 405 });
    }
  } catch (error) {
    console.error('KV operation failed:', error);
    return new Response(`Error processing request: ${error.message}`, { status: 500 });
  }
}
