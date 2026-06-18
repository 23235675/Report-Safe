<script setup>
import { ref, computed } from 'vue';
import { RouterLink, RouterView, useRoute, useRouter } from 'vue-router';
import { useSocket } from './socket.js';
import AppIcon from './components/AppIcon.vue';

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
          <div class="brand-sub">報平安 · Disaster Accountability</div>
        </div>
      </RouterLink>

      <nav class="app-nav">
        <RouterLink to="/">Home</RouterLink>
        <RouterLink to="/report">File a Report</RouterLink>
        <RouterLink to="/family">Find Someone</RouterLink>
        <RouterLink to="/shelters">Shelters</RouterLink>
        <RouterLink to="/account">Account</RouterLink>
        <RouterLink to="/gov">
          <span class="gov-link">
            Gov
            <span class="gov-link-badge">GOV</span>
          </span>
        </RouterLink>
      </nav>

      <span class="conn" :class="{ on: isConnected }" :title="isConnected ? 'Live data connection' : 'Offline'">
        <AppIcon :name="isConnected ? 'wifi' : 'cloud-offline'" :size="15" />
        <span class="conn-label">{{ isConnected ? 'Live' : 'Offline' }}</span>
      </span>

      <button class="nav-hamburger" :class="{ open: mobileMenuOpen }" @click="toggleMenu" :aria-label="mobileMenuOpen ? 'Close menu' : 'Open menu'" aria-haspopup="true">
        <span></span>
        <span></span>
        <span></span>
      </button>
    </header>

    <!-- Mobile slide-down menu -->
    <div v-if="mobileMenuOpen" class="mobile-nav-overlay" @click.self="closeMenu">
      <nav class="mobile-nav">
        <RouterLink to="/" @click="closeMenu">
          <AppIcon name="home" :size="18" />Home
        </RouterLink>
        <RouterLink to="/report" @click="closeMenu">
          <AppIcon name="megaphone" :size="18" />File a Report
        </RouterLink>
        <RouterLink to="/family" @click="closeMenu">
          <AppIcon name="people" :size="18" />Find Someone
        </RouterLink>
        <RouterLink to="/shelters" @click="closeMenu">
          <AppIcon name="shield-checkmark" :size="18" />Shelters
        </RouterLink>
        <RouterLink to="/account" @click="closeMenu">
          <AppIcon name="person-circle" :size="18" />Account
        </RouterLink>
        <RouterLink to="/gov" @click="closeMenu" class="mobile-nav-gov">
          <AppIcon name="shield" :size="18" />Gov Dashboard
          <span class="gov-link-badge">GOV</span>
        </RouterLink>
      </nav>
    </div>

    <main :class="['app-main', { 'gov-mode': isGovRoute }]">
      <RouterView />
    </main>

    <footer v-if="!isGovRoute" class="app-footer">
      Report Safe 報平安 &mdash; Disaster Accountability &amp; Rescue Coordination
    </footer>
  </div>
</template>
