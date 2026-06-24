<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useSocket } from './socket.js';
import { getCurrentUser, clearAuthToken } from './api.js';
import LangToggle from './components/LangToggle.vue';

const route = useRoute();
const router = useRouter();
const { isConnected } = useSocket();

// Admin console and Gov EOC dashboard are fully separate interfaces — no
// citizen chrome, reachable only by URL.
const isGovRoute   = computed(() => route.path === '/gov');
const isAdminRoute = computed(() => route.path === '/admin');

const todayLabel = new Date().toLocaleDateString();

// AccountView writes/clears localStorage directly (no shared store) — re-read
// on every navigation so the sidebar's Login/Sign out state stays correct
// after the user signs in or out on the Account page.
const currentUser = ref(getCurrentUser());
function refreshCurrentUser() { currentUser.value = getCurrentUser(); }
watch(() => route.fullPath, refreshCurrentUser);
onMounted(() => window.addEventListener('rs-auth-changed', refreshCurrentUser));
onUnmounted(() => window.removeEventListener('rs-auth-changed', refreshCurrentUser));

function signOut() {
  localStorage.removeItem('rs_user');
  clearAuthToken();
  currentUser.value = null;
  router.push('/');
}
</script>

<template>
  <!-- Admin console and Gov EOC dashboard: standalone full-screen interfaces,
       no app chrome, reachable only by typing the URL directly — never linked
       from the citizen nav. Each gates itself behind its own login. -->
  <RouterView v-if="isAdminRoute || isGovRoute" />

  <!-- Citizen shell: dark-teal clinical layout — white top connection bar,
       a teal horizontal tab strip (primary nav), a left sidebar (brand +
       Account-first secondary nav), a paper-first canvas, and a sticky mono
       metadata footer. -->
  <div v-else class="rs-shell">
    <header class="rs-top-nav">
      <span class="rs-conn-status">
        <span class="rs-conn-dot" :class="{ on: isConnected }"></span>
        <span>{{ isConnected ? $t('nav.live') : $t('nav.offline') }}</span>
      </span>
      <span class="rs-top-nav-title">{{ $t('nav.brandSub') }}</span>
      <LangToggle />
    </header>

    <nav class="rs-tabs-bar">
      <RouterLink to="/" class="rs-tab">{{ $t('nav.home') }}</RouterLink>
      <RouterLink to="/report" class="rs-tab">{{ $t('nav.report') }}</RouterLink>
      <RouterLink to="/family" class="rs-tab">{{ $t('nav.family') }}</RouterLink>
      <RouterLink to="/shelters" class="rs-tab">{{ $t('nav.shelters') }}</RouterLink>
      <RouterLink to="/about" class="rs-tab">{{ $t('nav.about') }}</RouterLink>
    </nav>

    <div class="rs-app-container">
      <aside class="rs-sidebar">
        <div>
          <RouterLink to="/" class="rs-brand-area">
            <span class="rs-brand-mark">報</span>
            <span>Report Safe</span>
          </RouterLink>

          <div class="rs-nav-group">
            <div class="rs-nav-section-label">{{ $t('nav.account') }}</div>
            <template v-if="currentUser">
              <RouterLink to="/account" class="rs-sub-nav-item">
                <span>{{ currentUser.name || currentUser.phone }}</span>
              </RouterLink>
              <button type="button" class="rs-sub-nav-item rs-sub-nav-btn" @click="signOut">
                <span>{{ $t('account.signOut') }}</span>
              </button>
            </template>
            <RouterLink v-else to="/account" class="rs-sub-nav-item">
              <span>{{ $t('account.signIn') }}</span>
            </RouterLink>
          </div>

          <div class="rs-nav-group">
            <RouterLink to="/status" class="rs-sub-nav-item">
              <span>{{ $t('statusView.title') }}</span>
            </RouterLink>
          </div>
        </div>

      </aside>

      <main class="rs-workspace">
        <div class="rs-paper">
          <RouterView />
        </div>
      </main>
    </div>

    <footer class="rs-sticky-footer">
      <span>{{ $t('nav.brandSub') }}</span>
      <span>{{ todayLabel }} · {{ isConnected ? $t('nav.live') : $t('nav.offline') }}</span>
    </footer>
  </div>
</template>
