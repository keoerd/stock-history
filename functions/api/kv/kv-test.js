/**
 * KV에 데이터를 쓰기, 읽기, 삭제하는 API 예제
 * - POST /api/kv-test?key=myKey  : 'myKey'라는 키로 요청 본문(body)을 저장합니다.
 * - GET /api/kv-test?key=myKey   : 'myKey'라는 키의 값을 읽어옵니다.
 * - DELETE /api/kv-test?key=myKey: 'myKey'라는 키와 값을 삭제합니다.
 */
export async function onRequest(context) {
  // context.env 객체를 통해 바인딩한 KV 변수에 접근할 수 있습니다.
  const kv = context.env.MY_KV;
  console.log('KV Namespace:', kv);
  const url = new URL(context.request.url);
  const key = url.searchParams.get('key');

  if (!key) {
    return new Response('"key" query parameter is required.', { status: 400 });
  }

  try {
    switch (context.request.method) {
      case 'POST': {
        const body = await context.request.json();
        // 값은 반드시 문자열이어야 하므로, JSON 객체는 stringify 처리합니다.
        await kv.put(key, JSON.stringify(body));
        return new Response(`Successfully stored data for key: ${key}`);
      }

      case 'GET': {
        const value = await kv.get(key);
        if (value === null) {
          return new Response(`Value for key "${key}" not found.`, { status: 404 });
        }
        // 저장된 문자열을 다시 JSON 객체로 파싱하여 반환할 수 있습니다.
        return new Response(value, {
          headers: { 'Content-Type': 'application/json' },
        });
      }

      case 'DELETE': {
        await kv.delete(key);
        return new Response(`Successfully deleted key: ${key}`);
      }

      default:
        return new Response('Method not allowed.', { status: 405 });
    }
  } catch (error) {
    return new Response(`Error processing request: ${error.message}`, { status: 500 });
  }
}
