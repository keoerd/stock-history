<script setup>
import { ref, reactive, onMounted, watch, computed } from 'vue';
import axios from 'axios';
import draggable from 'vuedraggable';

// ==========================================================
// 상태 변수 (Reactive State)
// ==========================================================
const stocksData = reactive({});
const lastUpdated = ref(null);
const newTickerInput = ref('');
const userId = ref(''); // 사용자 ID 상태 변수
const isGloballyLoading = ref(false);
const POLLING_INTERVAL_SECONDS = 15;

const tickerOrder = ref([]);
const activeFilter = ref('all');
const compactMode = ref(false);
const fullChainMode = ref(false);

// 모달 상태
const isManageModalOpen = ref(false);

// ==========================================================
// 로컬 저장소 및 KV 연동 로직
// ==========================================================
onMounted(async () => {
  // KV 테스트 API 호출 (기존 로직 유지)
  const response = await axios.post('/api/kv/kv-test?key=snapshot', {
    data: '{"name": "Alice", "country": "Korea"}'
  });
  console.log(response.data);

  // 초기 로드는 로컬 저장소에서 진행
  const savedTickers = localStorage.getItem('stock_tickers');
  const tickers = savedTickers ? JSON.parse(savedTickers) : ['TSLA', 'NVDA', 'AAPL', 'MSFT'];

  tickerOrder.value = tickers;

  tickers.forEach(ticker => {
    stocksData[ticker] = { loading: true, error: null, analysis: null };
  });

  runAnalysisCycle();
  setInterval(runAnalysisCycle, POLLING_INTERVAL_SECONDS * 1000);
});

// 티커 순서가 변경되면 로컬 저장소에 자동 저장
watch(tickerOrder, (newOrder) => {
  localStorage.setItem('stock_tickers', JSON.stringify(newOrder));
}, { deep: true });

watch(fullChainMode, () => {
  runAnalysisCycle();
});

// ## 새로 추가된 함수: KV에 티커 저장 ##
async function saveTickerByUserId() {
  if (!userId.value.trim()) {
    alert('사용자 ID를 입력해주세요.');
    return;
  }
  try {
    await axios.post(`/api/kv/tickers/${userId.value.trim()}`, tickerOrder.value);
    alert('티커 목록이 성공적으로 저장되었습니다.');
  } catch (error) {
    console.error('티커 저장 실패:', error);
    alert('티커 목록 저장 중 오류가 발생했습니다.');
  }
}

// ## 새로 추가된 함수: KV에서 티커 불러오기 ##
async function loadTickerByUserId() {
  if (!userId.value.trim()) {
    alert('사용자 ID를 입력해주세요.');
    return;
  }
  try {
    const response = await axios.get(`/api/kv/tickers/${userId.value.trim()}`);
    const loadedTickers = response.data;

    if (!loadedTickers || loadedTickers.length === 0) {
      alert('조회할 data가 없습니다.');
      return; // 데이터가 없으면 기존 상태를 유지하고 함수 종료
    }

    // 기존 티커 목록과 불러온 목록을 합치되, 중복은 제거
    const combined = new Set([...tickerOrder.value, ...loadedTickers]);
    tickerOrder.value = Array.from(combined);

    // 새로 추가된 티커가 있을 수 있으므로 전체 분석 사이클 실행
    await runAnalysisCycle();

    alert('티커 목록을 성공적으로 불러왔습니다.');
    closeManageModal();

  } catch (error) {
    console.error('티커 불러오기 실패:', error);
    alert('티커 목록을 불러오는 중 오류가 발생했습니다.');
  }
}


// ==========================================================
// 필터링, 티커 관리, Nasdaq 페이지 열기 함수들
// ==========================================================
const filteredStocks = computed(() => {
  return tickerOrder.value
    .filter(ticker => {
      const data = stocksData[ticker];
      if (!stocksData[ticker]) return false;
      if (activeFilter.value === 'all') return true;
      if (!data.analysis) return false;

      if (activeFilter.value === 'bullish') {
        return data.analysis.analysis.strategicJudgement.includes('상승 베팅 유리');
      }
      if (activeFilter.value === 'bearish') {
        return data.analysis.analysis.strategicJudgement.includes('하락 베팅 유리');
      }
      return true;
    });
});

function setFilter(filter) { activeFilter.value = filter; }
function openNasdaqPage(ticker) { const url = `https://www.nasdaq.com/market-activity/stocks/${ticker.toLowerCase()}/option-chain`; window.open(url, '_blank', 'noopener,noreferrer'); }

// 모달 제어 함수
function openManageModal() { isManageModalOpen.value = true; }
function closeManageModal() { isManageModalOpen.value = false; }


async function addTicker() {
  const ticker = newTickerInput.value.trim().toUpperCase();
  if (!ticker || stocksData[ticker]) { newTickerInput.value = ''; return; }
  stocksData[ticker] = { loading: true, error: null, analysis: null };
  if (!tickerOrder.value.includes(ticker)) { tickerOrder.value.push(ticker); }
  await analyzeSingleTicker(ticker);
  newTickerInput.value = '';
}

function removeTicker(ticker) {
  delete stocksData[ticker];
  tickerOrder.value = tickerOrder.value.filter(t => t !== ticker);
}

// ==========================================================
// 설정값 및 분석 로직 (이하 코드는 변경 없음)
// ==========================================================
const NASDAQ_API_HEADERS = { "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", };
const MINIMUM_VOLUME_FOR_SIGNAL = 500;
const MINIMUM_VOLUME_FOR_VOI = 100;

async function getOptionsAndPriceData(ticker) {
  try {
    const isDev = import.meta.env.DEV;
    let baseUrl = isDev
      ? `/api/quote/${ticker}/option-chain`
      : `/api/quote/${ticker}`;
    let params = `?assetclass=stocks&limit=1000`;
    if (fullChainMode.value) {
      params += '&money=all';
    }
    const url = baseUrl + params;
    const response = await axios.get(url, { headers: NASDAQ_API_HEADERS, timeout: 15000 });
    if (!response.data.data?.table?.rows || response.data.data.table.rows.length < 2) return null;
    const lastTradeStr = response.data.data.lastTrade || "";
    const currentPriceMatch = lastTradeStr.match(/\$(\d+(\.\d+)?)/);
    const currentPrice = currentPriceMatch ? parseFloat(currentPriceMatch[1]) : 0;
    let rows = response.data.data.table.rows;
    let expirationDate = "N/A";
    const options = [];
    const headerRow = rows.find((row) => row.expirygroup && row.expirygroup !== "");
    if (headerRow) expirationDate = headerRow.expirygroup;
    const targetDate = rows.find((row) => row.strike)?.expiryDate;
    if (targetDate) rows = rows.filter((item) => !item.strike || item.expiryDate === targetDate);
    for (const row of rows) {
      const strike = parseFloat(row.strike);
      if (!isNaN(strike)) {
        options.push({ type: "Call", strike, vol: parseInt(row.c_Volume) || 0, openInterest: parseInt(row.c_Openinterest) || 0, lastPrice: parseFloat(row.c_Last) || 0 });
        options.push({ type: "Put", strike, vol: parseInt(row.p_Volume) || 0, openInterest: parseInt(row.p_Openinterest) || 0, lastPrice: parseFloat(row.p_Last) || 0 });
      }
    }
    return { options, currentPrice, expirationDate };
  } catch (error) { throw error; }
}

// #############################################################
// ##  একমাত্র পরিবর্তিত অংশ ##
// #############################################################
function calculateLayer2Metrics(options, currentPrice) {
  // 기본값을 가진 '안전한' 객체 구조를 미리 정의합니다.
  const defaultOption = {
    vol: 0,
    openInterest: 0,
    strike: 'N/A',
    type: '-',
    lastPrice: 0,
    breakEvenPrice: 0,
    requiredMovePercent: 0,
    voiRatio: 0
  };

  let totalCallVolume = 0, totalPutVolume = 0;
  // 비교를 위해 초기값은 -1로 설정하되, 기본 구조를 복사해서 사용합니다.
  let maxVolumeOption = { ...defaultOption, vol: -1 };
  let maxOiOption = { ...defaultOption, openInterest: -1 };
  let maxVoiOption = { ...defaultOption, voiRatio: -1 };

  const optionsWithVoi = options.map(opt => ({
    ...opt,
    voiRatio: (opt.openInterest > 0) ? (opt.vol / opt.openInterest) : (opt.vol > 0 ? Infinity : 0)
  }));

  for (const opt of optionsWithVoi) {
    if (opt.type === "Call") totalCallVolume += opt.vol;
    else totalPutVolume += opt.vol;

    if (opt.vol > maxVolumeOption.vol) maxVolumeOption = opt;
    if (opt.openInterest > maxOiOption.openInterest) maxOiOption = opt;
    if (opt.vol >= MINIMUM_VOLUME_FOR_VOI && opt.voiRatio > maxVoiOption.voiRatio) {
      maxVoiOption = opt;
    }
  }

  // 만약 최대값을 찾지 못해 초기 상태(-1) 그대로라면, 안전한 기본 객체로 되돌립니다.
  if (maxVolumeOption.vol === -1) maxVolumeOption = { ...defaultOption };
  if (maxOiOption.openInterest === -1) maxOiOption = { ...defaultOption };
  if (maxVoiOption.voiRatio === -1) maxVoiOption = { ...defaultOption };

  const putCallRatio = totalCallVolume > 0 ? (totalPutVolume / totalCallVolume) : 0;

  // 이제 모든 객체는 항상 필요한 속성을 가지고 있으므로, 에러 없이 안전하게 계산됩니다.
  [maxVolumeOption, maxOiOption, maxVoiOption].forEach(opt => {
    // strike 값이 실제 숫자일 경우에만 계산을 수행합니다.
    if (typeof opt.strike === 'number') {
      opt.breakEvenPrice = opt.type === 'Call' ? opt.strike + opt.lastPrice : opt.strike - opt.lastPrice;
      opt.requiredMovePercent = currentPrice > 0 ? ((opt.breakEvenPrice - currentPrice) / currentPrice) * 100 : 0;
    }
  });

  return { maxVolumeOption, maxOiOption, putCallRatio, maxVoiOption };
}
// #############################################################
// ## 여기까지 수정된 부분 ##
// #############################################################


function calculateMaxPain(options) {
  if (!options || options.length === 0) return 0;
  const uniqueStrikes = [...new Set(options.map(o => o.strike))].sort((a, b) => a - b);
  let minLoss = Infinity, maxPainPrice = 0;
  for (const strikePrice of uniqueStrikes) {
    let totalLoss = 0;
    for (const option of options) {
      if (option.openInterest > 0) {
        if (option.type === 'Call' && option.strike < strikePrice) { totalLoss += (strikePrice - option.strike) * option.openInterest; }
        else if (option.type === 'Put' && option.strike > strikePrice) { totalLoss += (option.strike - strikePrice) * option.openInterest; }
      }
    }
    if (totalLoss < minLoss) {
      minLoss = totalLoss;
      maxPainPrice = strikePrice;
    }
  }
  return maxPainPrice;
}

function generateAnalysis(ticker, currentPrice, metrics, maxPainPrice) {
  const { maxVolumeOption, maxOiOption, putCallRatio, maxVoiOption } = metrics;
  const consensusOption = maxOiOption.openInterest > maxVolumeOption.vol ? maxOiOption : maxVolumeOption;
  let consensusText, consensusDirection;

  if (maxVolumeOption.type !== maxOiOption.type && maxVolumeOption.type !== '-' && maxOiOption.type !== '-') {
    consensusDirection = "신호 충돌";
    consensusText = `기존 세력(최대 OI)은 $${maxOiOption.strike} ${maxOiOption.type}을 중심으로 포진해 있으나, 신규 자금(최대 Volume)은 $${maxVolumeOption.strike} ${maxVolumeOption.type}을 통해 반대 방향으로 공격하며 힘겨루기를 하고 있습니다.`;
  } else {
    const pcrSentiment = putCallRatio > 1.0 ? "비관적(하락 우려)" : "낙관적(상승 기대)";
    consensusText = `시장의 주된 관심(최대 거래량/미결)은 $${consensusOption.strike} ${consensusOption.type} 옵션에 쏠려 있으며, 풋-콜 비율(${putCallRatio.toFixed(2)})은 ${pcrSentiment} 심리를 보여줍니다.`;
    if (putCallRatio < 1.0 && consensusOption.type === "Call") consensusDirection = "상승";
    else if (putCallRatio > 1.0 && consensusOption.type === "Put") consensusDirection = "하락";
    else consensusDirection = "혼조";
  }

  let variableText;
  if (maxVoiOption.vol > MINIMUM_VOLUME_FOR_SIGNAL) {
    variableText = `한편, $${maxVoiOption.strike} ${maxVoiOption.type} 옵션에서 높은 V/OI 비율(${maxVoiOption.voiRatio === Infinity ? '∞' : maxVoiOption.voiRatio.toFixed(2)})과 함께 강력한 '신규 자금' 유입이 포착되었습니다.`;
  } else {
    variableText = `V/OI를 통한 특별한 신규 자금 유입 신호는 미미합니다.`;
  }

  let finalText;
  const isTrendConfirmed = (consensusDirection === "상승" && maxVoiOption.type === "Call") || (consensusDirection === "하락" && maxVoiOption.type === "Put");
  if (consensusDirection === "신호 충돌") { finalText = `결론적으로, 현재 ${ticker}는 기존 세력과 신규 세력의 방향이 충돌하는 극심한 혼조세로, 단기 방향성 예측이 매우 어려운 상황입니다.`;
  } else if (isTrendConfirmed && maxVoiOption.vol > MINIMUM_VOLUME_FOR_SIGNAL) { finalText = `결론적으로, 현재 ${ticker}는 '${consensusDirection}' 컨센서스가 강하게 형성 중입니다. 기존 관심과 신규 자금 방향이 일치하여, 추세가 강화될 가능성이 높습니다.`;
  } else if (!isTrendConfirmed && maxVoiOption.vol > MINIMUM_VOLUME_FOR_SIGNAL) { finalText = `결론적으로, 현재 ${ticker}는 '${consensusDirection}'으로 기울어져 있으나, ${maxVoiOption.type} 베팅이라는 반대 신호가 포착되어 힘겨루기가 팽팽한 불안정한 상황입니다.`;
  } else { finalText = `결론적으로, 현재 ${ticker}는 '${consensusDirection}' 방향의 대세가 형성되어 있으며, 특별한 변수 없이 현재 추세가 이어질 가능성이 비교적 높습니다.` }

  let strategicJudgement;
  if (consensusDirection === "신호 충돌") { strategicJudgement = `관망 필수. 최대 거래량(${maxVolumeOption.type})과 최대 미결제약정(${maxOiOption.type})의 방향이 정반대입니다. 추세가 명확해질 때까지 기다리는 것이 가장 안전한 전략입니다.`;
  } else {
    const mainForceOption = maxVoiOption.vol > consensusOption.vol ? maxVoiOption : consensusOption;
    if (consensusDirection === '상승') {
      if (mainForceOption.strike > currentPrice) { strategicJudgement = `상승 베팅 유리. 핵심 자금이 현재가($${currentPrice.toFixed(2)})보다 높은 행사가 $${mainForceOption.strike}을 향하고 있습니다.`; }
      else { strategicJudgement = `신중한 접근 필요. 주요 콜옵션 행사가($${mainForceOption.strike})가 이미 현재가 아래에 있어, 단기 차익 실현이 나올 수 있습니다.`; }
    } else if (consensusDirection === '하락') {
      if (mainForceOption.strike < currentPrice) { strategicJudgement = `하락 베팅 유리. 핵심 자금이 현재가($${currentPrice.toFixed(2)})보다 낮은 행사가 $${mainForceOption.strike}을 향하고 있습니다.`; }
      else { strategicJudgement = `신중한 접근 필요. 주요 풋옵션 행사가($${mainForceOption.strike})가 이미 현재가 위에 있어, 기술적 반등 가능성이 있습니다.`; }
    } else { strategicJudgement = `관망 유리 (신호 혼재).` }
  }

  if (maxPainPrice > 0 && Math.abs((maxPainPrice - currentPrice) / currentPrice) > 0.05) {
    if (consensusDirection === '상승' && maxPainPrice < currentPrice) {
      strategicJudgement += ` (주의: 맥스 페인 가격($${maxPainPrice})이 현재가보다 낮아, 만기일 근처에서 하방 압력이 발생할 수 있습니다.)`;
    } else if (consensusDirection === '하락' && maxPainPrice > currentPrice) {
      strategicJudgement += ` (주의: 맥스 페인 가격($${maxPainPrice})이 현재가보다 높아, 만기일 근처에서 기술적 반등 압력이 발생할 수 있습니다.)`;
    }
  }

  let squeezeText = "특별한 스퀴즈 징후는 포착되지 않았습니다.";
  if (putCallRatio < 0.6 && maxVoiOption.type === 'Call' && maxVoiOption.strike > currentPrice && maxVoiOption.vol > MINIMUM_VOLUME_FOR_SIGNAL) {
    squeezeText = `⚠️ 감마 스퀴즈 잠재력: 낮은 풋-콜 비율과 함께 외가격(OTM) 콜옵션에 대한 강력한 신규 베팅이 감지되었습니다. 주가가 행사가 $${maxVoiOption.strike}을 넘어설 경우, 급격한 주가 상승이 촉발될 수 있습니다.`;
  }
  squeezeText += " (참고: 공매도 비율이 20% 이상으로 높을 경우, 숏스퀴즈 가능성도 함께 고려해야 합니다.)";

  let tradingPlan = { entry: '거래 보류', target: '거래 보류', stopLoss: '거래 보류' };
  if (strategicJudgement.includes('상승 베팅 유리')) {
    const targetStrike = consensusOption.strike;
    tradingPlan.entry = `현재가($${currentPrice.toFixed(2)}) 부근 또는 주요 저항선 돌파 시`;
    tradingPlan.target = `$${(targetStrike * 0.99).toFixed(2)} ~ $${targetStrike.toFixed(2)} (핵심 저항)`;
    const stopPrice = maxPainPrice > 0 ? Math.min(currentPrice * 0.97, maxPainPrice * 0.99) : currentPrice * 0.97;
    tradingPlan.stopLoss = `$${stopPrice.toFixed(2)} (주요 지지선 또는 맥스페인 근접)`;
  } else if (strategicJudgement.includes('하락 베팅 유리')) {
    const targetStrike = consensusOption.strike;
    tradingPlan.entry = `현재가($${currentPrice.toFixed(2)}) 부근 또는 주요 지지선 붕괴 시`;
    tradingPlan.target = `$${targetStrike.toFixed(2)} ~ $${(targetStrike * 1.01).toFixed(2)} (핵심 지지)`;
    const stopPrice = maxPainPrice > 0 ? Math.max(currentPrice * 1.03, maxPainPrice * 1.01) : currentPrice * 1.03;
    tradingPlan.stopLoss = `$${stopPrice.toFixed(2)} (주요 저항선 또는 맥스페인 근접)`;
  }

  return { consensusText, variableText, finalText, strategicJudgement, squeezeText, tradingPlan };
}

async function analyzeSingleTicker(ticker) {
  if (!stocksData[ticker]) {
    stocksData[ticker] = { loading: true, error: null, analysis: null };
  };
  if (!stocksData[ticker].analysis) { stocksData[ticker].loading = true; }
  stocksData[ticker].error = null;
  try {
    const data = await getOptionsAndPriceData(ticker);
    if (data && data.options.length > 0) {
      const metrics = calculateLayer2Metrics(data.options, data.currentPrice);
      const maxPainPrice = calculateMaxPain(data.options);
      const analysis = generateAnalysis(ticker, data.currentPrice, metrics, maxPainPrice);
      stocksData[ticker].analysis = { ...data, metrics, analysis, maxPainPrice };
    } else {
      throw new Error('분석할 유효한 데이터가 없습니다.');
    }
  } catch (error) {
    if (stocksData[ticker]) stocksData[ticker].error = error.message;
    console.error(`[${ticker}] 데이터 분석 중 오류 발생:`, error.message);
  } finally {
    if (stocksData[ticker]) stocksData[ticker].loading = false;
  }
}

async function runAnalysisCycle() {
  isGloballyLoading.value = true;
  await Promise.all(tickerOrder.value.map(ticker => analyzeSingleTicker(ticker)));
  lastUpdated.value = new Date();
  isGloballyLoading.value = false;
}
</script>

<template>
  <div>
    <header>
      <h1>Stock DOC</h1>
      <div class="status-bar">
        <div v-if="isGloballyLoading" class="spinner"></div>
        <div v-if="lastUpdated" class="last-updated">
          마지막 업데이트: {{ lastUpdated.toLocaleTimeString('ko-KR') }}
        </div>
      </div>
      <form @submit.prevent="addTicker" class="ticker-form">
        <input v-model="newTickerInput" type="text" placeholder="티커 추가 (e.g., AAPL)" autofocus />
        <button type="submit">추가</button>
        <button type="button" @click="openManageModal" class="manage-btn">티커 관리</button>
      </form>
      <div class="view-controls">
        <div class="filter-controls">
          <button :class="{ active: activeFilter === 'all' }" @click="setFilter('all')">전체</button>
          <button :class="{ active: activeFilter === 'bullish' }" @click="setFilter('bullish')">상승 우세</button>
          <button :class="{ active: activeFilter === 'bearish' }" @click="setFilter('bearish')">하락 우세</button>
        </div>
        <div class="options-toggle">
          <input type="checkbox" id="full-chain-mode" v-model="fullChainMode">
          <label for="full-chain-mode">전체 옵션 보기</label>
        </div>
        <div class="compact-toggle">
          <input type="checkbox" id="compact-mode" v-model="compactMode">
          <label for="compact-mode">압축 보기</label>
        </div>
      </div>
    </header>

    <draggable
      v-model="tickerOrder"
      tag="main"
      item-key="ticker"
      handle=".card-header"
      ghost-class="ghost"
      :delay="100"
      delay-on-touch-only
    >
      <template #item="{ element: ticker }">
        <div v-if="filteredStocks.includes(ticker)" :key="ticker" :class="['stock-card', { compact: compactMode }]">
          <div class="card-header">
            <div class="card-title-group">
              <h2>{{ ticker }}</h2>
              <a href="#" @click.prevent="openNasdaqPage(ticker)" class="details-link" title="Nasdaq 옵션 상세 보기">
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" width="18" height="18">
                  <path d="M10 6V8H5V19H16V14H18V19C18 20.1 17.1 21 16 21H5C3.9 21 3 20.1 3 19V8C3 6.9 3.9 6 5 6H10M19 3V11H17V5.41L12 10.41L10.59 9L15.59 4H13V2H21V10H19V3Z" />
                </svg>
              </a>
            </div>
            <button @click="removeTicker(ticker)" class="delete-btn" title="삭제">&times;</button>
          </div>

          <div v-if="compactMode" class="compact-content">
            <p v-if="stocksData[ticker] && stocksData[ticker].analysis" class="strategic-judgement-compact">
              {{ stocksData[ticker].analysis.analysis.strategicJudgement }}
            </p>
            <div v-else-if="stocksData[ticker] && stocksData[ticker].loading" class="loading-compact">분석 중...</div>
            <div v-else-if="stocksData[ticker] && stocksData[ticker].error" class="error-compact">⚠️</div>
            <div v-else class="loading-compact">...</div>
          </div>

          <div v-else>
            <div v-if="stocksData[ticker] && stocksData[ticker].loading" class="loading">분석 중...</div>
            <div v-else-if="stocksData[ticker] && stocksData[ticker].error" class="error">⚠️ 오류: {{ stocksData[ticker].error }}</div>
            <transition name="fade" mode="out-in">
              <div v-if="stocksData[ticker] && stocksData[ticker].analysis" class="analysis-content" :key="lastUpdated">
                <div class="layer">
                  <h3>[레이어 1: 기초 분석]</h3>
                  <p><strong>현재 주가:</strong> ${{ stocksData[ticker].analysis.currentPrice.toFixed(2) }}</p>
                  <p><strong>분석 만기일:</strong> {{ stocksData[ticker].analysis.expirationDate }}</p>
                </div>
                <div class="layer">
                  <h3>[레이어 2: 핵심 지표]</h3>
                  <ul>
                    <li>
                      <strong>자금 집중도 (거래량):</strong>
                      ${{ stocksData[ticker].analysis.metrics.maxVolumeOption.strike }} {{ stocksData[ticker].analysis.metrics.maxVolumeOption.type }}
                      <span class="premium-info">(프리미엄: ${{ stocksData[ticker].analysis.metrics.maxVolumeOption.lastPrice.toFixed(2) }})</span>
                      (거래량: {{ stocksData[ticker].analysis.metrics.maxVolumeOption.vol.toLocaleString() }})
                      <div v-if="stocksData[ticker].analysis.metrics.maxVolumeOption.breakEvenPrice" class="breakeven-info">
                        손익분기: ${{ stocksData[ticker].analysis.metrics.maxVolumeOption.breakEvenPrice.toFixed(2) }}
                        (필요: <span :class="stocksData[ticker].analysis.metrics.maxVolumeOption.requiredMovePercent > 0 ? 'up' : 'down'">{{ stocksData[ticker].analysis.metrics.maxVolumeOption.requiredMovePercent.toFixed(2) }}%</span>)
                      </div>
                    </li>
                    <li>
                      <strong>자금 집중도 (미결):</strong>
                      ${{ stocksData[ticker].analysis.metrics.maxOiOption.strike }} {{ stocksData[ticker].analysis.metrics.maxOiOption.type }}
                      <span class="premium-info">(프리미엄: ${{ stocksData[ticker].analysis.metrics.maxOiOption.lastPrice.toFixed(2) }})</span>
                      (미결: {{ stocksData[ticker].analysis.metrics.maxOiOption.openInterest.toLocaleString() }})
                      <div v-if="stocksData[ticker].analysis.metrics.maxOiOption.breakEvenPrice" class="breakeven-info">
                        손익분기: ${{ stocksData[ticker].analysis.metrics.maxOiOption.breakEvenPrice.toFixed(2) }}
                        (필요: <span :class="stocksData[ticker].analysis.metrics.maxOiOption.requiredMovePercent > 0 ? 'up' : 'down'">{{ stocksData[ticker].analysis.metrics.maxOiOption.requiredMovePercent.toFixed(2) }}%</span>)
                      </div>
                    </li>
                    <li><strong>시장 심리 (풋-콜 비율):</strong> {{ stocksData[ticker].analysis.metrics.putCallRatio.toFixed(2) }}</li>
                    <li>
                      <strong>새로운 돈 유입 (최대 V/OI):</strong>
                      ${{ stocksData[ticker].analysis.metrics.maxVoiOption.strike }} {{ stocksData[ticker].analysis.metrics.maxVoiOption.type }}
                      <span class="premium-info">(프리미엄: ${{ stocksData[ticker].analysis.metrics.maxVoiOption.lastPrice.toFixed(2) }})</span>
                      (V/OI: {{ stocksData[ticker].analysis.metrics.maxVoiOption.voiRatio === Infinity ? '∞' : stocksData[ticker].analysis.metrics.maxVoiOption.voiRatio.toFixed(2) }}, 거래량: {{ stocksData[ticker].analysis.metrics.maxVoiOption.vol.toLocaleString() }})
                      <div v-if="stocksData[ticker].analysis.metrics.maxVoiOption.breakEvenPrice" class="breakeven-info">
                        손익분기: ${{ stocksData[ticker].analysis.metrics.maxVoiOption.breakEvenPrice.toFixed(2) }}
                        (필요: <span :class="stocksData[ticker].analysis.metrics.maxVoiOption.requiredMovePercent > 0 ? 'up' : 'down'">{{ stocksData[ticker].analysis.metrics.maxVoiOption.requiredMovePercent.toFixed(2) }}%</span>)
                      </div>
                    </li>
                    <li v-if="stocksData[ticker].analysis.maxPainPrice > 0">
                      <strong>맥스 페인(Max Pain) 가격:</strong> ${{ stocksData[ticker].analysis.maxPainPrice.toFixed(2) }}
                    </li>
                  </ul>
                </div>
                <div class="layer">
                  <h3>[레이어 3: 종합 판단]</h3>
                  <p><strong>대세 시나리오:</strong> {{ stocksData[ticker].analysis.analysis.consensusText }}</p>
                  <p><strong>변수 시나리오:</strong> {{ stocksData[ticker].analysis.analysis.variableText }}</p>
                  <p class="final-analysis"><strong>최종 분석:</strong> {{ stocksData[ticker].analysis.analysis.finalText }}</p>
                </div>
                <div class="layer">
                  <h3>[레이어 4: 전략적 판단]</h3>
                  <p class="strategic-judgement">{{ stocksData[ticker].analysis.analysis.strategicJudgement }}</p>
                </div>
                <div class="layer">
                  <h3>[레이어 5: 단타 트레이딩 계획]</h3>
                  <ul class="trading-plan">
                    <li><strong>추천 진입:</strong> {{ stocksData[ticker].analysis.analysis.tradingPlan.entry }}</li>
                    <li><strong>목표 가격:</strong> {{ stocksData[ticker].analysis.analysis.tradingPlan.target }}</li>
                    <li><strong>손절 가격:</strong> {{ stocksData[ticker].analysis.analysis.tradingPlan.stopLoss }}</li>
                  </ul>
                </div>
                <div v-if="stocksData[ticker].analysis.analysis.squeezeText && stocksData[ticker].analysis.analysis.squeezeText.includes('⚠️')" class="layer">
                  <h3>[레이어 6: 주요 리스크 및 기회]</h3>
                  <p class="context-analysis squeeze-alert">
                    {{ stocksData[ticker].analysis.analysis.squeezeText }}
                  </p>
                </div>
              </div>
            </transition>
          </div>
        </div>
      </template>
    </draggable>

    <div v-if="isManageModalOpen" class="modal-overlay" @click.self="closeManageModal">
      <div class="modal-content">
        <div class="modal-header">
          <h3>티커 목록 관리</h3>
          <button @click="closeManageModal" class="close-btn">&times;</button>
        </div>
        <div class="modal-body">
          <input v-model="userId" type="text" placeholder="사용자 ID 입력" />
          <div class="modal-actions">
            <button @click="saveTickerByUserId" class="action-btn save-btn">티커 저장</button>
            <button @click="loadTickerByUserId" class="action-btn load-btn">티커 불러오기</button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
/* 🎯 기본 페이지 및 헤더 스타일 */
#app {
  padding: 20px;
}

header {
  text-align: center;
  margin-bottom: 2rem;

  h1 {
    color: var(--header-color);
    font-size: 2em;
  }
}

.status-bar {
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 10px;
  background-color: var(--card-background);
  padding: 10px 20px;
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0,0,0,0.05);
  max-width: 400px;
  margin: 1rem auto;
}

.last-updated {
  font-size: 0.9em;
  color: #555;
}

/* 🎯 폼 및 컨트롤 UI 스타일 */
.ticker-form {
  display: flex;
  gap: 10px;
  margin: 1rem auto;
  max-width: 500px;
  align-items: center;

  input {
    flex: 1;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 1em;
  }

  button {
    flex-shrink: 0;
    padding: 10px 20px;
    border: none;
    background-color: var(--accent-color);
    color: white;
    border-radius: 4px;
    font-size: 1em;
    cursor: pointer;
    transition: background-color 0.2s;

    &:hover {
      background-color: #36a88a;
    }

    &.manage-btn {
      background-color: #888;
      &:hover {
        background-color: #666;
      }
    }
  }
}

.view-controls {
  display: flex;
  justify-content: center;
  align-items: center;
  flex-wrap: wrap;
  gap: 20px;
  margin-bottom: 2rem;
}

.filter-controls {
  display: flex;
  justify-content: center;
  gap: 10px;

  button {
    padding: 8px 16px;
    border: 1px solid var(--border-color);
    background-color: var(--card-background);
    color: var(--text-color);
    border-radius: 20px;
    cursor: pointer;
    transition: all 0.2s;

    &.active {
      background-color: var(--accent-color);
      color: white;
      border-color: var(--accent-color);
    }
    &:hover:not(.active) {
      background-color: #f0f0f0;
    }
  }
}

.options-toggle,
.compact-toggle {
  display: flex;
  align-items: center;
  gap: 8px;

  label {
    cursor: pointer;
    user-select: none;
  }
}

/* 🎯 메인 콘텐츠 및 카드 스타일 */
main {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(450px, 1fr));
  gap: 20px;
}

.stock-card {
  background-color: var(--card-background);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 20px;
  box-shadow: 0 4px 8px rgba(0,0,0,0.08);
  transition: all 0.2s ease-in-out;
  display: flex;
  flex-direction: column;

  &:hover {
    transform: translateY(-5px);
  }

  &.compact {
    flex-basis: 200px;
    min-width: 180px;
    padding: 15px;
    text-align: center;
  }
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 2px solid var(--accent-color);
  padding-bottom: 10px;
  margin-bottom: 1rem;
  cursor: move;

  .card-title-group {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  h2 {
    margin: 0;
    color: var(--accent-color);
    border: none;
    padding: 0;
  }

  .details-link {
    color: #aaa;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    &:hover {
      color: var(--info-color);
    }
  }

  .delete-btn {
    background: none;
    border: none;
    font-size: 1.8em;
    color: #aaa;
    cursor: pointer;
    padding: 5px 10px;
    line-height: 1;
    margin: -5px -10px;
    &:hover {
      color: var(--error-color);
    }
  }
}

.compact-content {
  margin-top: 10px;

  .strategic-judgement-compact {
    font-weight: bold;
    font-size: 0.9em;
    margin: 0;
  }
  .loading-compact, .error-compact {
    font-size: 0.9em;
    font-style: italic;
    color: #888;
  }
  .error-compact {
    font-size: 1.5em;
  }
}

.loading, .error {
  font-weight: bold;
  padding: 40px 20px;
  text-align: center;
  font-size: 1.1em;
  margin: auto;
}
.error {
  color: var(--error-color);
}

.analysis-content {
  display: flex;
  flex-direction: column;
  flex-grow: 1;

  .layer {
    margin-bottom: 1.5rem;
  }
  h3 {
    font-size: 1.1em;
    color: var(--header-color);
    margin-bottom: 0.5rem;
  }
  p, ul {
    margin: 0;
    padding: 0;
    line-height: 1.6;
  }
  ul {
    list-style-type: none;
  }
  li {
    margin-bottom: 10px;
  }
}

.final-analysis {
  font-weight: bold;
  margin-top: 1rem !important;
  background-color: #f0f7f5;
  padding: 10px;
  border-left: 4px solid var(--accent-color);
  border-radius: 4px;
}
.strategic-judgement {
  font-weight: bold;
  font-size: 1.05em;
  margin-top: 0.5rem !important;
  background-color: #ebf5fb;
  padding: 15px;
  border-left: 4px solid var(--info-color);
  border-radius: 4px;
}
.breakeven-info {
  font-size: 0.85em;
  color: #555;
  padding-left: 15px;
  border-left: 2px solid var(--border-color);
  margin-top: 4px;

  .up {
    color: var(--up-color);
    font-weight: bold;
  }
  .down {
    color: var(--down-color);
    font-weight: bold;
  }
}

.premium-info {
  font-size: 0.9em;
  color: var(--info-color);
  font-style: italic;
  margin-left: 5px;
}

.context-analysis {
  font-style: italic;
  background-color: #fcf8e3;
  color: #8a6d3b;
  padding: 10px;
  border-left: 4px solid #f0ad4e;
  border-radius: 4px;
}

.squeeze-alert {
  background-color: #f2dede;
  color: #a94442;
  border-left-color: var(--error-color);
  font-weight: bold;
}

.trading-plan {
  list-style-type: '➡️ ';
  padding-left: 20px;

  li {
    padding-left: 10px;
    margin-bottom: 8px;
  }
}

/* 🎯 모달 및 유틸리티 스타일 */
.modal-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  background-color: rgba(0, 0, 0, 0.6);
  display: flex;
  justify-content: center;
  align-items: center;
  z-index: 1000;
}

.modal-content {
  background: var(--card-background);
  padding: 25px;
  border-radius: 10px;
  box-shadow: 0 5px 15px rgba(0,0,0,0.3);
  width: 90%;
  max-width: 400px;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  border-bottom: 1px solid var(--border-color);
  padding-bottom: 15px;
  margin-bottom: 15px;

  h3 {
    margin: 0;
    color: var(--header-color);
    font-size: 1.25em;
  }
  .close-btn {
    background: none;
    border: none;
    font-size: 2em;
    color: #aaa;
    cursor: pointer;
    line-height: 1;

    &:hover {
      color: #333;
    }
  }
}

.modal-body {
  display: flex;
  flex-direction: column;
  gap: 15px;

  input {
    width: 100%;
    padding: 12px;
    border: 1px solid var(--border-color);
    border-radius: 4px;
    font-size: 1em;
    box-sizing: border-box;
  }
}

.modal-actions {
  display: flex;
  gap: 10px;

  .action-btn {
    flex: 1;
    padding: 12px;
    border: none;
    border-radius: 4px;
    color: white;
    font-size: 1em;
    font-weight: bold;
    cursor: pointer;
    transition: opacity 0.2s;

    &:hover {
      opacity: 0.85;
    }

    &.save-btn {
      background-color: var(--accent-color);
    }
    &.load-btn {
      background-color: var(--info-color);
    }
  }
}

.ghost {
  opacity: 0.5;
  background: #c8ebfb;
}

.spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--accent-color);
  border-top-color: transparent;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}


/* 📱 모바일 화면 대응 */
@media (max-width: 600px) {
  .ticker-form {
    flex-direction: column;
    align-items: stretch;
  }
}

@media (max-width: 480px) {
  #app {
    padding: 10px;
  }
  header h1 {
    font-size: 1.5em;
  }
  main {
    grid-template-columns: 1fr;
    gap: 15px;
  }
  .stock-card {
    padding: 15px;
  }
}
</style>
<!-- 이 코드는 분석 로직에 문제가 있어보여. 수정해줘 -->
