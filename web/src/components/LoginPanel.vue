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
        <div v-if="error" class="login-error" role="alert">{{ error }}</div>
        <button class="login-btn" type="submit" :disabled="busy">{{ busy ? busyLabel : buttonLabel }}</button>
      </form>
      <p class="login-note"><slot name="note">Report Safe is a disaster-reporting tool.</slot></p>
    </div>
  </div>
</template>

<style scoped>
.login-wrap { min-height:100vh; display:flex; align-items:center; justify-content:center; background:#f5f5f6; }
.login-card { width:360px; background:#fff; border:1px solid #e9e9ec; padding:32px 28px; border-radius:4px; box-shadow:0 6px 24px rgba(0,0,0,0.07); }
.login-logo { text-align:center; margin-bottom:24px; border-bottom:1px solid #e9e9ec; padding-bottom:16px; }
.login-crest { display:inline-flex; align-items:center; justify-content:center; width:44px; height:44px; background:#26262b; color:#fff; font-size:21px; font-weight:700; margin-bottom:14px; border-radius:4px; }
.login-logo h1 { font-size:16px; font-weight:700; color:#1e1e22; margin:0; }
.login-sub { font-size:12px; color:#5b5c63; margin:2px 0 0; }
.login-form { display:flex; flex-direction:column; }
.login-error { margin:10px 0 0; padding:6px 8px; background:#fff; border:1px solid #e9e9ec; font-size:13px; color:#1e1e22; border-radius:3px; }
.login-btn { margin-top:18px; padding:11px; background:#26262b; color:#fff; border:1px solid #26262b; font-size:13.5px; font-weight:700; cursor:pointer; font-family:inherit; border-radius:3px; }
.login-btn:hover:not(:disabled) { background:#131316; }
.login-btn:disabled { opacity:.4; cursor:not-allowed; }
.login-note { text-align:center; font-size:12px; color:#5b5c63; margin-top:16px; }
</style>
