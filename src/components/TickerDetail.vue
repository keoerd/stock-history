<script setup>
import { ref, onMounted, computed } from 'vue';
import axios from 'axios';

const props = defineProps({
  ticker: {
    type: String,
    required: true,
  },
});

const history = ref([]);
const isLoading = ref(true);

onMounted(async () => {
  try {
    const response = await axios.get(`/api/history/${props.ticker}`);
    // analysis_data가 JSON 문자열이므로 객체로 파싱합니다.
    history.value = response.data.map(item => ({
      ...item,
      analysis: JSON.parse(item.analysis_data)
    }));
  } catch (error) {
    console.error("히스토리 로딩 실패:", error);
  } finally {
    isLoading.value = false;
  }
});

// 표시용 날짜 포맷 함수
function formatTimestamp(ts) {
  return new Date(ts).toLocaleString('ko-KR');
}
</script>

<template>
  <div class="container">
    <header>
      <router-link to="/">&larr; 목록으로 돌아가기</router-link>
      <h1>{{ ticker }} 분석 히스토리</h1>
    </header>

    <div v-if="isLoading">로딩 중...</div>
    <div v-else-if="history.length === 0">수집된 데이터가 없습니다.</div>

    <div v-else class="history-list">
      <div v-for="item in history" :key="item.id" class="history-item">
        <div class="timestamp">{{ formatTimestamp(item.timestamp) }}</div>
        <div class="price">당시 주가: ${{ item.current_price.toFixed(2) }}</div>
        <div class="judgement">
          <strong>전략적 판단:</strong> {{ item.analysis.analysis.strategicJudgement }}
        </div>
        </div>
    </div>
  </div>
</template>

<style scoped>
.container { max-width: 800px; margin: auto; padding: 20px; }
.history-list { display: flex; flex-direction: column; gap: 15px; }
.history-item { border: 1px solid #ddd; border-radius: 8px; padding: 15px; }
.timestamp { font-size: 0.9em; color: #666; margin-bottom: 5px; }
.price { font-weight: bold; margin-bottom: 10px; }
.judgement { background-color: #f5f5f5; padding: 10px; border-radius: 4px; }
</style>
