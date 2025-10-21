<script setup>
import { ref, onMounted } from 'vue';
import axios from 'axios';
import { RouterLink, RouterView } from 'vue-router';

const trackedTickers = ref([]);
const newTickerInput = ref('');
const isLoading = ref(true);
const errorMessage = ref('');

// 컴포넌트가 마운트될 때 실행되는 함수
onMounted(async () => {
  try {
    // 1. 백엔드 API(/api/tickers)에 GET 요청을 보내 티커 목록을 가져옵니다.
    const response = await axios.get('/api/kv/tickers');
    // 2. 응답으로 받은 데이터를 trackedTickers 상태 변수에 저장합니다.
    trackedTickers.value = response.data || [];
  } catch (error) {
    console.error("티커 목록을 불러오는 데 실패했습니다:", error);
    errorMessage.value = "티커 목록을 불러올 수 없습니다. 백엔드 서버가 실행 중인지 확인하세요.";
  } finally {
    isLoading.value = false;
  }
});

// 서버에 현재 티커 목록 전체를 업데이트하는 함수
async function updateTickerListOnServer() {
  try {
    await axios.post('/api/kv/tickers', trackedTickers.value);
    console.log("티커 목록이 서버에 업데이트되었습니다.");
  } catch (error) {
    alert("서버에 티커 목록을 업데이트하는 데 실패했습니다.");
  }
}

// 새 티커를 추가하는 함수
function addTicker() {
  const ticker = newTickerInput.value.trim().toUpperCase();
  if (ticker && !trackedTickers.value.includes(ticker)) {
    trackedTickers.value.push(ticker);
    newTickerInput.value = '';
    updateTickerListOnServer(); // 목록 변경 후 서버에 즉시 반영
  }
}

// 기존 티커를 삭제하는 함수
function removeTicker(tickerToRemove) {
  trackedTickers.value = trackedTickers.value.filter(t => t !== tickerToRemove);
  updateTickerListOnServer(); // 목록 변경 후 서버에 즉시 반영
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
      <div v-if="isLoading">목록을 불러오는 중...</div>
      <div v-else-if="errorMessage" class="error-message">{{ errorMessage }}</div>
      <ul v-else-if="trackedTickers.length > 0" class="ticker-list">
        <li v-for="ticker in trackedTickers" :key="ticker">
          <router-link :to="`/ticker/${ticker}`" class="ticker-link">
            {{ ticker }}
          </router-link>
          <button @click.stop="removeTicker(ticker)" class="remove-btn" title="삭제">&times;</button>
        </li>
      </ul>
      <p v-else>추적 중인 티커가 없습니다.</p>
    </main>

    <RouterView />
  </div>
</template>

<style scoped>
.container {
  max-width: 600px;
  margin: 2rem auto;
  padding: 20px;
  font-family: sans-serif;
}
header {
  margin-bottom: 2rem;
}
h1 {
  text-align: center;
}
.ticker-form {
  display: flex;
  gap: 10px;
}
.ticker-form input {
  flex: 1;
  padding: 10px;
  border: 1px solid #ccc;
  border-radius: 4px;
}
.ticker-form button {
  padding: 10px 15px;
  border: none;
  background-color: #007bff;
  color: white;
  border-radius: 4px;
  cursor: pointer;
}
.ticker-list {
  list-style: none;
  padding: 0;
}
.ticker-list li {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 15px;
  border-bottom: 1px solid #eee;
  transition: background-color 0.2s;
}
.ticker-list li:hover {
  background-color: #f9f9f9;
}
.ticker-link {
  text-decoration: none;
  color: #333;
  font-weight: bold;
  font-size: 1.1em;
}
.remove-btn {
  background: none;
  border: none;
  color: #ff4d4d;
  font-size: 1.8em;
  cursor: pointer;
  line-height: 1;
}
.error-message {
  color: #ff4d4d;
  text-align: center;
  padding: 20px;
  background-color: #fff0f0;
  border: 1px solid #ffcccc;
  border-radius: 4px;
}
</style>
