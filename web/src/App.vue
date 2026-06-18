<script setup>
import { ref, computed } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useSocket } from './socket.js';
import AppIcon from './components/AppIcon.vue';
import LangToggle from './components/LangToggle.vue';

const route = useRoute();
const router = useRouter();
const { isConnected } = useSocket();

const isGovRoute = computed(() => route.path === '/gov');
// The admin console is a fully separate interface — no citizen/gov chrome.
const isAdminRoute = computed(() => route.path === '/admin');
const mobileMenuOpen = ref(false);

function closeMenu() { mobileMenuOpen.value = false; }
function toggleMenu() { mobileMenuOpen.value = !mobileMenuOpen.value; }

router.afterEach(() => { mobileMenuOpen.value = false; });
</script>

<template>
  <!-- Admin console: standalone full-screen interface, no app chrome. -->
  <RouterView v-if="isAdminRoute" />

  <div v-else class="app-shell">
    <header class="app-header">
      <RouterLink to="/" class="brand" @click="closeMenu">
        <span class="brand-mark">報</span>
        <div>
          <div class="brand-text">Report Safe</div>
          <div class="brand-sub">{{ $t('nav.brandSub') }}</div>
        </div>
      </RouterLink>

      <nav class="app-nav">
        <RouterLink to="/">{{ $t('nav.home') }}</RouterLink>
        <RouterLink to="/report">{{ $t('nav.report') }}</RouterLink>
        <RouterLink to="/family">{{ $t('nav.family') }}</RouterLink>
        <RouterLink to="/shelters">{{ $t('nav.shelters') }}</RouterLink>
        <RouterLink to="/account">{{ $t('nav.account') }}</RouterLink>
        <RouterLink to="/gov">
          <span class="gov-link">
            {{ $t('nav.gov') }}
            <span class="gov-link-badge">GOV</span>
          </span>
        </RouterLink>
      </nav>

      <LangToggle />

      <span class="conn" :class="{ on: isConnected }" :title="isConnected ? $t('nav.live') : $t('nav.offline')">
        <AppIcon :name="isConnected ? 'wifi' : 'cloud-offline'" :size="15" />
        <span class="conn-label">{{ isConnected ? $t('nav.live') : $t('nav.offline') }}</span>
      </span>

      <button class="nav-hamburger" :class="{ open: mobileMenuOpen }" @click="toggleMenu" :aria-label="mobileMenuOpen ? $t('nav.closeMenu') : $t('nav.openMenu')" aria-haspopup="true">
        <span></span>
        <span></span>
        <span></span>
      </button>
    </header>

    <!-- Mobile slide-down menu -->
    <div v-if="mobileMenuOpen" class="mobile-nav-overlay" @click.self="closeMenu">
      <nav class="mobile-nav">
        <RouterLink to="/" @click="closeMenu">
          <AppIcon name="home" :size="18" />{{ $t('nav.home') }}
        </RouterLink>
        <RouterLink to="/report" @click="closeMenu">
          <AppIcon name="megaphone" :size="18" />{{ $t('nav.report') }}
        </RouterLink>
        <RouterLink to="/family" @click="closeMenu">
          <AppIcon name="people" :size="18" />{{ $t('nav.family') }}
        </RouterLink>
        <RouterLink to="/shelters" @click="closeMenu">
          <AppIcon name="shield-checkmark" :size="18" />{{ $t('nav.shelters') }}
        </RouterLink>
        <RouterLink to="/account" @click="closeMenu">
          <AppIcon name="person-circle" :size="18" />{{ $t('nav.account') }}
        </RouterLink>
        <RouterLink to="/gov" @click="closeMenu" class="mobile-nav-gov">
          <AppIcon name="shield" :size="18" />{{ $t('nav.govDashboard') }}
          <span class="gov-link-badge">GOV</span>
        </RouterLink>
      </nav>
    </div>

    <main :class="['app-main', { 'gov-mode': isGovRoute }]">
      <RouterView />
    </main>

    <footer v-if="!isGovRoute" class="app-footer">
      {{ $t('nav.footer') }}
    </footer>
  </div>
</template>
