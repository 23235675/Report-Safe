<script setup>
// Gov dashboard token gate — same design as the Admin console login.
// Owns the token input locally; GovView verifies on @submit and feeds back
// error/busy. On success GovView unmounts this gate entirely.
import { ref } from 'vue';
import LoginPanel from '../LoginPanel.vue';

defineProps({
  error: { type: String, default: null },
  busy:  { type: Boolean, default: false },
});
const emit = defineEmits(['submit']);

const passwordInput = ref('');
function submit() { emit('submit', passwordInput.value); }
</script>

<template>
  <LoginPanel
    subtitle="Operations Dashboard — Authorized Users Only"
    :error="error"
    :busy="busy"
    button-label="Sign in"
    busy-label="Verifying…"
    @submit="submit"
  >
    <label class="field-label" for="gov-access-token">Access token</label>
    <input id="gov-access-token" v-model="passwordInput" class="login-input" type="password" placeholder="Enter access token..." autocomplete="off" autofocus required />
  </LoginPanel>
</template>

<style scoped>
.field-label { font-size:12px; font-weight:600; color:#555; margin-bottom:4px; }
.login-input { padding:8px 10px; border:1px solid #d0d0d0; font-size:14px; color:#222; background:#fff; width:100%; box-sizing:border-box; font-family:inherit; border-radius:3px; }
.login-input:focus { border-color:#999; }
</style>
