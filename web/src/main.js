import { createApp } from 'vue';
import App from './App.vue';
import router from './router/index.js';
import i18n from './i18n/index.js';
import { initAuth } from './api.js';
import './assets/main.css';

// H3: restore the in-memory access token from the httpOnly refresh cookie before
// mount (best-effort) so a reload keeps the user signed in without storing any
// token in localStorage.
initAuth().finally(() => {
  const app = createApp(App);
  app.use(router);
  app.use(i18n);
  app.mount('#app');
});
