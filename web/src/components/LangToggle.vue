<script setup>
/**
 * LangToggle — a compact EN / 中 switch for the citizen/volunteer chrome.
 * Flips the global locale (persisted to localStorage) between English and
 * Traditional Chinese. Not shown on the Gov / Admin surfaces.
 */
import { locale, setLocale, t } from '../i18n/index.js';
</script>

<template>
  <div class="lang-toggle" role="group" :aria-label="t('lang.switch')">
    <button
      type="button"
      class="lang-opt"
      :class="{ active: locale === 'en' }"
      :aria-pressed="locale === 'en'"
      @click="setLocale('en')"
    >EN</button>
    <button
      type="button"
      class="lang-opt"
      :class="{ active: locale === 'zh' }"
      :aria-pressed="locale === 'zh'"
      @click="setLocale('zh')"
    >中</button>
  </div>
</template>

<style scoped>
.lang-toggle {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 2px;
  background: var(--bg-raised);
  border: 1px solid var(--border-line);
  border-radius: var(--radius-pill, 999px);
  flex-shrink: 0;
}
.lang-opt {
  border: none;
  background: transparent;
  color: var(--text-lo);
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  padding: 5px 9px;
  border-radius: 999px;
  cursor: pointer;
  transition: background 0.15s, color 0.15s;
}
.lang-opt:hover { color: var(--text-hi); }
.lang-opt.active {
  background: var(--gov-blue);
  color: #fff;
}
</style>
