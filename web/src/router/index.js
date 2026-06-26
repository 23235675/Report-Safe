import { createRouter, createWebHistory } from 'vue-router';

const GOV_TOKEN_KEY = 'gov_token';

// Lazy route components: Vite emits one chunk per view, so the initial bundle
// no longer ships every screen (notably GovView's Leaflet map and AdminView)
// up front — they load on navigation.
const routes = [
  { path: '/', name: 'home', component: () => import('../views/HomeView.vue') },
  { path: '/status', name: 'status', component: () => import('../views/StatusView.vue') },
  { path: '/report', name: 'report', component: () => import('../views/ReportView.vue') },
  { path: '/family', name: 'family', component: () => import('../views/FamilyView.vue') },
  { path: '/shelters', name: 'shelters', component: () => import('../views/SheltersView.vue') },
  { path: '/account', name: 'account', component: () => import('../views/AccountView.vue') },
  { path: '/about', name: 'about', component: () => import('../views/AboutView.vue') },
  {
    path: '/gov',
    name: 'gov',
    component: () => import('../views/GovView.vue'),
    meta: { requiresToken: true },
  },
  {
    path: '/admin',
    name: 'admin',
    component: () => import('../views/AdminView.vue'),
    // AdminView manages its own auth (super_admin login / session), so no
    // router-level guard here — it shows the login form when unauthenticated.
    meta: { adminRoute: true },
  },
];

const router = createRouter({
  history: createWebHistory(),
  routes,
});

// Guard the gov dashboard. When a token is already present we let the user
// straight in. When absent we still allow GovView to load so its own token
// modal can collect the password — but we attach `?authRequired=true` so the
// view knows to open the modal immediately (and Home can surface a notice if
// the user navigates away).
router.beforeEach((to) => {
  if (to.meta.requiresToken) {
    const token = sessionStorage.getItem(GOV_TOKEN_KEY);
    if (!token && to.query.authRequired !== 'true') {
      return { path: '/gov', query: { authRequired: 'true' } };
    }
  }
  return true;
});

export default router;
export { GOV_TOKEN_KEY };
