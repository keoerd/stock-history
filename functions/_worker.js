// src/worker.js

/**
 * Cloudflare Cron Worker
 * - wrangler.toml의 cron 스케줄에 따라 주기적으로 실행됩니다.
 * 1. MY_KV에서 추적할 전체 티커 목록을 가져옵니다.
 * 2. 각 티커의 옵션 데이터를 Nasdaq에서 가져와 분석합니다.
 * 3. 분석 결과를 D1 데이터베이스의 'analysis_history' 테이블에 저장합니다.
 */

// ==========================================================
// 메인 워커 로직
// ==========================================================
export default {
    async scheduled(controller, env, ctx) {
        console.log("Cron Trigger 실행: 분석 데이터 수집 시작");

        // 1. KV에서 추적할 티커 목록 전체를 가져옵니다.
        const tickerListJson = await env.MY_KV.get("TICKER_MASTER_LIST");
        if (!tickerListJson) {
            console.log("추적할 티커 목록이 없습니다. 작업을 종료합니다.");
            return;
        }

        const tickers = JSON.parse(tickerListJson);
        if (!tickers || tickers.length === 0) {
            console.log("추적할 티커가 목록에 없습니다.");
            return;
        }

        console.log(`수집 대상 티커: ${tickers.join(', ')}`);

        const analysisResults = [];

        // 2. 각 티커에 대해 분석을 순차적으로 수행합니다.
        for (const ticker of tickers) {
            try {
                const data = await getOptionsAndPriceData(ticker);
                if (data && data.options.length > 0) {
                    const metrics = calculateLayer2Metrics(data.options, data.currentPrice);
                    const maxPainPrice = calculateMaxPain(data.options);
                    const analysis = generateAnalysis(ticker, data.currentPrice, metrics, maxPainPrice);

                    const result = {
                        ticker: ticker,
                        timestamp: Date.now(),
                        current_price: data.currentPrice,
                        analysis_data: JSON.stringify({ ...data, metrics, analysis, maxPainPrice })
                    };
                    analysisResults.push(result);
                    console.log(`[${ticker}] 분석 완료.`);
                } else {
                    console.log(`[${ticker}] 분석할 유효한 데이터가 없습니다.`);
                }
            } catch (error) {
                console.error(`[${ticker}] 분석 중 오류 발생:`, error.message);
            }
        }

        // 3. 분석 결과를 D1 데이터베이스에 일괄 저장합니다.
        if (analysisResults.length > 0) {
            try {
                const stmt = env.DB.prepare(
                    "INSERT INTO analysis_history (ticker, timestamp, current_price, analysis_data) VALUES (?, ?, ?, ?)"
                );
                const batch = analysisResults.map(r => stmt.bind(r.ticker, r.timestamp, r.current_price, r.analysis_data));
                await env.DB.batch(batch);
                console.log(`${analysisResults.length}개의 분석 결과를 D1에 성공적으로 저장했습니다.`);
            } catch (d1Error) {
                console.error("D1 데이터베이스 저장 실패:", d1Error.message);
            }
        } else {
            console.log("저장할 분석 결과가 없습니다.");
        }
    },
};


// ==========================================================
// 설정값 및 분석 로직
// ==========================================================

const NASDAQ_API_HEADERS = { "Accept": "application/json, text/plain, */*", "Accept-Language": "en-US,en;q=0.9", };
const MINIMUM_VOLUME_FOR_SIGNAL = 500;
const MINIMUM_VOLUME_FOR_VOI = 100;

async function getOptionsAndPriceData(ticker) {
    try {
        const baseUrl = `https://api.nasdaq.com/api/quote/${ticker}/option-chain`;
        const params = `?assetclass=stocks&limit=1000`;
        const url = baseUrl + params;

        const response = await fetch(url, { headers: NASDAQ_API_HEADERS });
        if (!response.ok) {
            throw new Error(`Nasdaq API fetching error: ${response.statusText}`);
        }
        const responseData = await response.json();

        if (!responseData.data?.table?.rows || responseData.data.table.rows.length < 2) return null;

        const lastTradeStr = responseData.data.lastTrade || "";
        const currentPriceMatch = lastTradeStr.match(/\$(\d+(\.\d+)?)/);
        const currentPrice = currentPriceMatch ? parseFloat(currentPriceMatch[1]) : 0;

        let rows = responseData.data.table.rows;
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
    } catch (error) {
        console.error(`[${ticker}] getOptionsAndPriceData error:`, error);
        throw error;
    }
}

function calculateLayer2Metrics(options, currentPrice) {
    const defaultOption = { vol: 0, openInterest: 0, strike: 'N/A', type: '-', lastPrice: 0, breakEvenPrice: 0, requiredMovePercent: 0, voiRatio: 0 };
    let totalCallVolume = 0, totalPutVolume = 0;
    let maxVolumeOption = { ...defaultOption, vol: -1 };
    let maxOiOption = { ...defaultOption, openInterest: -1 };
    let maxVoiOption = { ...defaultOption, voiRatio: -1 };

    const optionsWithVoi = options.map(opt => ({ ...opt, voiRatio: (opt.openInterest > 0) ? (opt.vol / opt.openInterest) : (opt.vol > 0 ? Infinity : 0) }));

    for (const opt of optionsWithVoi) {
        if (opt.type === "Call") totalCallVolume += opt.vol; else totalPutVolume += opt.vol;
        if (opt.vol > maxVolumeOption.vol) maxVolumeOption = opt;
        if (opt.openInterest > maxOiOption.openInterest) maxOiOption = opt;
        if (opt.vol >= MINIMUM_VOLUME_FOR_VOI && opt.voiRatio > maxVoiOption.voiRatio) maxVoiOption = opt;
    }

    if (maxVolumeOption.vol === -1) maxVolumeOption = { ...defaultOption };
    if (maxOiOption.openInterest === -1) maxOiOption = { ...defaultOption };
    if (maxVoiOption.voiRatio === -1) maxVoiOption = { ...defaultOption };

    const putCallRatio = totalCallVolume > 0 ? (totalPutVolume / totalCallVolume) : 0;

    [maxVolumeOption, maxOiOption, maxVoiOption].forEach(opt => {
        if (typeof opt.strike === 'number') {
            opt.breakEvenPrice = opt.type === 'Call' ? opt.strike + opt.lastPrice : opt.strike - opt.lastPrice;
            opt.requiredMovePercent = currentPrice > 0 ? ((opt.breakEvenPrice - currentPrice) / currentPrice) * 100 : 0;
        }
    });

    return { maxVolumeOption, maxOiOption, putCallRatio, maxVoiOption };
}

function calculateMaxPain(options) {
    if (!options || options.length === 0) return 0;
    const uniqueStrikes = [...new Set(options.map(o => o.strike))].sort((a, b) => a - b);
    let minLoss = Infinity, maxPainPrice = 0;
    for (const strikePrice of uniqueStrikes) {
        let totalLoss = 0;
        for (const option of options) {
            if (option.openInterest > 0) {
                if (option.type === 'Call' && option.strike < strikePrice) totalLoss += (strikePrice - option.strike) * option.openInterest;
                else if (option.type === 'Put' && option.strike > strikePrice) totalLoss += (option.strike - strikePrice) * option.openInterest;
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
    if (consensusDirection === "신호 충돌") {
        finalText = `결론적으로, 현재 ${ticker}는 기존 세력과 신규 세력의 방향이 충돌하는 극심한 혼조세로, 단기 방향성 예측이 매우 어려운 상황입니다.`;
    } else if (isTrendConfirmed && maxVoiOption.vol > MINIMUM_VOLUME_FOR_SIGNAL) {
        finalText = `결론적으로, 현재 ${ticker}는 '${consensusDirection}' 컨센서스가 강하게 형성 중입니다. 기존 관심과 신규 자금 방향이 일치하여, 추세가 강화될 가능성이 높습니다.`;
    } else if (!isTrendConfirmed && maxVoiOption.vol > MINIMUM_VOLUME_FOR_SIGNAL) {
        finalText = `결론적으로, 현재 ${ticker}는 '${consensusDirection}'으로 기울어져 있으나, ${maxVoiOption.type} 베팅이라는 반대 신호가 포착되어 힘겨루기가 팽팽한 불안정한 상황입니다.`;
    } else {
        finalText = `결론적으로, 현재 ${ticker}는 '${consensusDirection}' 방향의 대세가 형성되어 있으며, 특별한 변수 없이 현재 추세가 이어질 가능성이 비교적 높습니다.`
    }

    let strategicJudgement;
    if (consensusDirection === "신호 충돌") {
        strategicJudgement = `관망 필수. 최대 거래량(${maxVolumeOption.type})과 최대 미결제약정(${maxOiOption.type})의 방향이 정반대입니다. 추세가 명확해질 때까지 기다리는 것이 가장 안전한 전략입니다.`;
    } else {
        const mainForceOption = maxVoiOption.vol > consensusOption.vol ? maxVoiOption : consensusOption;
        if (consensusDirection === '상승') {
            if (mainForceOption.strike > currentPrice) {
                strategicJudgement = `상승 베팅 유리. 핵심 자금이 현재가($${currentPrice.toFixed(2)})보다 높은 행사가 $${mainForceOption.strike}을 향하고 있습니다.`;
            } else {
                strategicJudgement = `신중한 접근 필요. 주요 콜옵션 행사가($${mainForceOption.strike})가 이미 현재가 아래에 있어, 단기 차익 실현이 나올 수 있습니다.`;
            }
        } else if (consensusDirection === '하락') {
            if (mainForceOption.strike < currentPrice) {
                strategicJudgement = `하락 베팅 유리. 핵심 자금이 현재가($${currentPrice.toFixed(2)})보다 낮은 행사가 $${mainForceOption.strike}을 향하고 있습니다.`;
            } else {
                strategicJudgement = `신중한 접근 필요. 주요 풋옵션 행사가($${mainForceOption.strike})가 이미 현재가 위에 있어, 기술적 반등 가능성이 있습니다.`;
            }
        } else {
            strategicJudgement = `관망 유리 (신호 혼재).`
        }
    }

    if (maxPainPrice > 0 && Math.abs((maxPainPrice - currentPrice) / currentPrice) > 0.05) {
        if (consensusDirection === '상승' && maxPainPrice < currentPrice) {
            strategicJudgement += ` (주의: 맥스 페인 가격($${maxPainPrice})이 현재가보다 낮아, 만기일 근처에서 하방 압력이 발생할 수 있습니다.)`;
        } else if (consensusDirection === '하락' && maxPainPrice > currentPrice) {
            strategicJudgement += ` (주의: 맥스 페인 가격($${maxPainPrice})이 현재가보다 높아, 만기일 근처에서 기술적 반등 압력이 발생할 수 있습니다.)`;
        }
    }

    let squeezeText = "특별한 스퀴즈 징후는 포착되지 않았습니다.";
    if (putCallRatio < 0.6 && maxVoiOption.type === 'Call' && typeof maxVoiOption.strike === 'number' && maxVoiOption.strike > currentPrice && maxVoiOption.vol > MINIMUM_VOLUME_FOR_SIGNAL) {
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
