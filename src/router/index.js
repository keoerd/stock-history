// src/router/index.js
import { createRouter, createWebHistory } from 'vue-router';
import App from '../App.vue'; // 메인 페이지 컴포넌트 경로 수정 필요 시
import TickerDetail from '../components/TickerDetail.vue';

const routes = [
  {
    path: '/',
    name: 'Home',
    component: App, // App.vue를 홈으로 사용
  },
  {
    path: '/ticker/:ticker', // 동적 경로 파라미터 사용
    name: 'TickerDetail',
    component: TickerDetail,
    props: true, // 경로 파라미터를 props로 전달
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

export default router;
