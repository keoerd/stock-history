<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';

const trackedTickers = ref([]);
const newTickerInput = ref('');

// 페이지 로드 시 KV에 저장된 전체 티커 목록을 불러옵니다.
onMounted(async () => {
  const response = await axios.get('/api/tickers');
  trackedTickers.value = response.data || [];
});

// KV에 현재 티커 목록 전체를 덮어쓰는 함수
async function updateTickerList() {
  try {
    await axios.post('/api/tickers', trackedTickers.value);
    console.log("티커 목록이 서버에 업데이트되었습니다.");
  } catch (error) {
    alert("서버 업데이트에 실패했습니다.");
  }
}

function addTicker() {
  const ticker = newTickerInput.value.trim().toUpperCase();
  if (ticker && !trackedTickers.value.includes(ticker)) {
    trackedTickers.value.push(ticker);
    newTickerInput.value = '';
    updateTickerList(); // 목록 변경 후 서버에 업데이트
  }
}

function removeTicker(tickerToRemove) {
  trackedTickers.value = trackedTickers.value.filter(t => t !== tickerToRemove);
  updateTickerList(); // 목록 변경 후 서버에 업데이트
}
</script>

<template>
  <div class="container">
    <header>
      <h1>티커 추적 목록</h1>
      <form @submit.prevent="addTicker" class="ticker-form">
        <input v-model="newTickerInput" placeholder="추가할 티커 입력 (e.g., AAPL)" />
        <button type="submit">추가</button>
      </form>
    </header>

    <main>
      <ul class="ticker-list">
        <li v-for="ticker in trackedTickers" :key="ticker">
          <router-link :to="`/ticker/${ticker}`" class="ticker-link">
            {{ ticker }}
          </router-link>
          <button @click.stop="removeTicker(ticker)" class="remove-btn">&times;</button>
        </li>
      </ul>
       <p v-if="trackedTickers.length === 0">추적 중인 티커가 없습니다.</p>
    </main>
  </div>
</template>

<style scoped>
/* 간단한 스타일 */
.container { max-width: 600px; margin: auto; padding: 20px; }
.ticker-form { display: flex; gap: 10px; margin-bottom: 20px; }
.ticker-form input { flex: 1; padding: 8px; }
.ticker-list { list-style: none; padding: 0; }
.ticker-list li { display: flex; justify-content: space-between; align-items: center; padding: 12px; border-bottom: 1px solid #eee; }
.ticker-link { text-decoration: none; color: #333; font-weight: bold; }
.remove-btn { background: none; border: none; color: red; font-size: 1.5em; cursor: pointer; }
</style>
