import { createRouter, createWebHistory } from 'vue-router';
import HomeView     from '../views/HomeView.vue';
import ReportView   from '../views/ReportView.vue';
import FamilyView   from '../views/FamilyView.vue';
import GovView      from '../views/GovView.vue';
import SheltersView from '../views/SheltersView.vue';
import AccountView  from '../views/AccountView.vue';
import StatusView   from '../views/StatusView.vue';
import AdminView    from '../views/AdminView.vue';

const GOV_TOKEN_KEY = 'gov_token';

const routes = [
  { path: '/', name: 'home', component: HomeView },
  { path: '/status', name: 'status', component: StatusView },
  { path: '/report', name: 'report', component: ReportView },
  { path: '/family', name: 'family', component: FamilyView },
  { path: '/shelters', name: 'shelters', component: SheltersView },
  { path: '/account', name: 'account', component: AccountView },
  {
    path: '/gov',
    name: 'gov',
    component: GovView,
    meta: { requiresToken: true },
  },
  {
    path: '/admin',
    name: 'admin',
    component: AdminView,
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
