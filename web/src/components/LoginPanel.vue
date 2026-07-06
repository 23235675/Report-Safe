<script setup>
// Shared centered login layout for the Admin console and Gov dashboard gates:
// 報 crest, "Report Safe" title + per-view subtitle, separator, slotted form
// fields, full-width sign-in button, footer note. Field inputs come in via the
// default slot so each view keeps its own field markup + scoped field CSS
// (label spacing differs slightly between Admin and Gov).
defineProps({
  subtitle:    { type: String, required: true },
  title:       { type: String, default: 'Report Safe' },
  error:       { type: String, default: null },
  busy:        { type: Boolean, default: false },
  buttonLabel: { type: String, default: 'Sign in' },
  busyLabel:   { type: String, default: 'Signing in…' },
});
defineEmits(['submit']);
</script>

<template>
  <div class="login-wrap">
    <div class="login-card">
      <div class="login-logo">
        <div class="login-crest">報</div>
        <h1>{{ title }}</h1>
        <p class="login-sub">{{ subtitle }}</p>
      </div>
      <form @submit.prevent="$emit('submit')" class="login-form">
        <slot />
        <div v-if="error" class="login-error">{{ error }}</div>
        <button class="login-btn" type="submit" :disabled="busy">{{ busy ? busyLabel : buttonLabel }}</button>
      </form>
      <p class="login-note"><slot name="note">Report Safe is a disaster-reporting tool.</slot></p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f0f0f0; }
.login-card { width:360px; background:#fff; border:1px solid #d0d0d0; padding:32px 28px; }
.login-logo { text-align:center; margin-bottom:24px; border-bottom:1px solid #d0d0d0; padding-bottom:16px; }
.login-crest { display:inline-flex; align-items:center; justify-content:center; width:40px; height:40px; background:#e0e0e0; border:1px solid #c0c0c0; color:#333; font-size:20px; font-weight:700; margin-bottom:12px; }
.login-logo h1 { font-size:15px; font-weight:700; color:#222; margin:0; }
.login-sub { font-size:11px; color:#888; margin:2px 0 0; }
.login-form { display:flex; flex-direction:column; }
.login-error { margin:10px 0 0; padding:6px 8px; background:#fff; border:1px solid #d0d0d0; font-size:12px; color:#222; }
.login-btn { margin-top:16px; padding:10px; background:#555; color:#fff; border:1px solid #555; font-size:12px; font-weight:700; cursor:pointer; font-family:inherit; border-radius:2px; }
.login-btn:hover:not(:disabled) { background:#444; }
.login-btn:disabled { opacity:.4; cursor:not-allowed; }
.login-note { text-align:center; font-size:11px; color:#888; margin-top:16px; }
</style>
