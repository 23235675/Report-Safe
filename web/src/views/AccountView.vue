<script setup>
import { ref, onMounted } from 'vue';
import { registerUser, loginUser, setAuthSession, clearAuthToken } from '../api.js';
import { isValidHKID, normalizeHKID, normalizePhone } from '../hkid.js';
import AppIcon from '../components/AppIcon.vue';

const USER_KEY = 'rs_user';

const savedUser  = ref(JSON.parse(localStorage.getItem(USER_KEY) || 'null'));
// 'login' | 'register'  — only relevant when no savedUser.
const mode       = ref('login');
const loginPhone = ref('');
const form       = ref({ phone: '', name: '', personal_id: '', email: '', privacy_consent: false });
const loading    = ref(false);
const error      = ref('');
const success    = ref('');

/** Keep only the last 8 digits as the user types. */
function onLoginPhoneInput(e) { loginPhone.value = e.target.value.replace(/\D/g, '').slice(0, 8); }
function onPhoneInput(e)      { form.value.phone = e.target.value.replace(/\D/g, '').slice(0, 8); }

function applySession(res) {
  savedUser.value = res.user;
  localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  setAuthSession(res); // persists access + refresh tokens (kept forever until sign out)
}

async function login() {
  error.value = ''; success.value = '';
  const digits = loginPhone.value.replace(/\D/g, '');
  if (digits.length < 8) { error.value = 'Enter your 8-digit Hong Kong phone number.'; return; }
  loading.value = true;
  try {
    applySession(await loginUser(normalizePhone(digits)));
    success.value = 'Signed in.';
  } catch (e) {
    error.value = e?.status === 404
      ? 'No account found for that number. Create one below.'
      : (e.message || 'Sign in failed.');
  } finally {
    loading.value = false;
  }
}

async function register() {
  error.value = ''; success.value = '';
  const digits = form.value.phone.replace(/\D/g, '');
  if (digits.length < 8)        { error.value = 'Enter your 8-digit Hong Kong phone number.'; return; }
  if (!form.value.name.trim())  { error.value = 'Full name is required.'; return; }
  if (!form.value.personal_id.trim()) { error.value = 'HKID is required, e.g. A123456.'; return; }
  if (!isValidHKID(form.value.personal_id)) {
    error.value = 'HKID must have 1+ letter and 6+ digits, e.g. A123456.'; return;
  }
  if (!form.value.privacy_consent) { error.value = 'Privacy consent is required to register.'; return; }
  loading.value = true;
  try {
    applySession(await registerUser({
      phone:           normalizePhone(digits),
      name:            form.value.name.trim(),
      personal_id:     normalizeHKID(form.value.personal_id),
      email:           form.value.email || null,
      privacy_consent: form.value.privacy_consent,
      user_type:       'web',
    }));
    success.value = 'Account created.';
  } catch (e) {
    error.value = e?.details?.[0]?.message || e.message;
  } finally {
    loading.value = false;
  }
}

function logout() {
  savedUser.value = null;
  localStorage.removeItem(USER_KEY);
  clearAuthToken();
  loginPhone.value = '';
  form.value = { phone: '', name: '', personal_id: '', email: '', privacy_consent: false };
  mode.value = 'login';
  success.value = '';
  error.value = '';
}

function switchMode(m) { mode.value = m; error.value = ''; success.value = ''; }

onMounted(() => {});
</script>

<template>
  <div class="account-page">
    <div class="page-header">
      <h1>Account</h1>
      <p class="subtitle">Sign in with your phone number, or create an account to track loved ones.</p>
    </div>

    <div v-if="error"   class="msg msg-error msg-row"><AppIcon name="alert-circle" :size="16" /><span>{{ error }}</span></div>
    <div v-if="success" class="msg msg-success msg-row"><AppIcon name="checkmark-circle" :size="16" /><span>{{ success }}</span></div>

    <!-- ════ SIGNED IN: profile ════ -->
    <div v-if="savedUser" class="account-card">
      <div class="ac-head">
        <div class="ac-avatar">{{ (savedUser.name || savedUser.phone || '?').charAt(0).toUpperCase() }}</div>
        <div class="ac-identity">
          <span class="ac-name">{{ savedUser.name || 'Unnamed Account' }}</span>
          <span class="ac-phone">{{ savedUser.phone }}</span>
        </div>
        <div class="ac-actions">
          <button @click="logout" class="btn btn-ghost" style="color: var(--need-help);"><AppIcon name="log-out" :size="14" /> Sign Out</button>
        </div>
      </div>
      <div class="ac-profile">
        <div class="profile-row"><span class="pr-lbl">Phone</span><span class="pr-val font-mono">{{ savedUser.phone }}</span></div>
        <div class="profile-row" v-if="savedUser.email"><span class="pr-lbl">Email</span><span class="pr-val">{{ savedUser.email }}</span></div>
        <div class="profile-row" v-if="savedUser.personal_id"><span class="pr-lbl">HKID</span><span class="pr-val font-mono">{{ savedUser.personal_id }}</span></div>
        <div class="profile-row">
          <span class="pr-lbl">Privacy Consent</span>
          <span class="pr-val" :style="{ color: savedUser.privacy_consent ? 'var(--safe)' : 'var(--text-lo)' }">
            {{ savedUser.privacy_consent ? 'Granted' : 'Not granted' }}
          </span>
        </div>
        <div class="profile-row"><span class="pr-lbl">Account Type</span><span class="pr-val">{{ savedUser.user_type || 'web' }}</span></div>
      </div>
    </div>

    <!-- ════ LOGIN BOX ════ -->
    <div v-else-if="mode === 'login'" class="auth-card">
      <div class="auth-head">
        <AppIcon name="person-circle" :size="32" style="color: var(--gov-blue);" />
        <h2 class="auth-title">Sign In</h2>
        <p class="auth-sub">Enter your Hong Kong phone number</p>
      </div>
      <form @submit.prevent="login" class="auth-form">
        <label class="field">
          <span class="field-lbl">Phone number</span>
          <div class="phone-row">
            <span class="phone-prefix">+852</span>
            <input :value="loginPhone" @input="onLoginPhoneInput" class="field-input font-mono phone-input" placeholder="98765432" inputmode="numeric" maxlength="8" autofocus />
          </div>
        </label>
        <button type="submit" :disabled="loading" class="btn btn-primary btn-block">
          <AppIcon v-if="!loading" name="log-in" :size="16" /> {{ loading ? 'Signing in…' : 'Sign In' }}
        </button>
      </form>
      <div class="auth-switch">
        <span>Don't have an account?</span>
        <button class="link-btn" @click="switchMode('register')">Create one now</button>
      </div>
    </div>

    <!-- ════ REGISTER BOX ════ -->
    <div v-else class="auth-card">
      <div class="auth-head">
        <AppIcon name="person-circle" :size="32" style="color: var(--gov-blue);" />
        <h2 class="auth-title">Create Account</h2>
        <p class="auth-sub">Set up your disaster-safety profile</p>
      </div>
      <form @submit.prevent="register" class="auth-form">
        <label class="field">
          <span class="field-lbl">Phone * <span class="field-hint">(8 digits, +852 added automatically)</span></span>
          <div class="phone-row">
            <span class="phone-prefix">+852</span>
            <input :value="form.phone" @input="onPhoneInput" class="field-input font-mono phone-input" placeholder="98765432" inputmode="numeric" maxlength="8" />
          </div>
        </label>
        <label class="field">
          <span class="field-lbl">Full Name *</span>
          <input v-model="form.name" class="field-input" placeholder="Your full name" />
        </label>
        <label class="field">
          <span class="field-lbl">HKID * <span class="field-hint">(1+ letter, 6+ digits — never shown publicly)</span></span>
          <input v-model="form.personal_id" class="field-input font-mono" placeholder="A123456" autocomplete="off" style="text-transform: uppercase;" />
        </label>
        <label class="field">
          <span class="field-lbl">Email <span class="field-hint">(optional)</span></span>
          <input v-model="form.email" class="field-input" type="email" placeholder="name@example.com" />
        </label>
        <label class="field consent-field">
          <input v-model="form.privacy_consent" type="checkbox" class="consent-check" />
          <span class="consent-text">
            I consent to authorized rescue teams viewing my location and medical notes during active disasters.
          </span>
        </label>
        <button type="submit" :disabled="loading" class="btn btn-primary btn-block">
          <AppIcon v-if="!loading" name="checkmark" :size="15" /> {{ loading ? 'Creating…' : 'Create Account' }}
        </button>
      </form>
      <div class="auth-switch">
        <span>Already have an account?</span>
        <button class="link-btn" @click="switchMode('login')">Sign in</button>
      </div>
    </div>

    <!-- Privacy note -->
    <div class="privacy-note">
      <span class="pn-title inline-ico"><AppIcon name="shield-checkmark" :size="15" style="color: var(--gov-blue);" /> Privacy by Design</span>
      <p class="pn-body">
        Exact GPS coordinates are only visible to authorized government rescue teams with a valid Bearer token.
        Public and family searches show approximate location only. Medical notes are never shown publicly.
      </p>
    </div>
  </div>
</template>

<style scoped>
.account-page { display: flex; flex-direction: column; gap: var(--sp-5); max-width: 600px; }

/* Login / register box */
.auth-card { background: var(--bg-panel); border: 1px solid var(--border-line); border-radius: var(--radius-lg); padding: var(--sp-5); max-width: 420px; }
.auth-head { text-align: center; margin-bottom: var(--sp-4); }
.auth-title { font-size: 19px; font-weight: 800; color: var(--text-hi); margin: var(--sp-2) 0 2px; }
.auth-sub { font-size: 13px; color: var(--text-lo); margin: 0; }
.auth-form { display: flex; flex-direction: column; gap: var(--sp-3); }
.btn-block { width: 100%; justify-content: center; padding: 11px; font-size: 15px; margin-top: var(--sp-1); }
.auth-switch { display: flex; align-items: center; justify-content: center; gap: 6px; margin-top: var(--sp-4); padding-top: var(--sp-4); border-top: 1px solid var(--border-line); font-size: 13px; color: var(--text-md); }
.link-btn { background: none; border: none; padding: 0; color: var(--gov-blue); font-weight: 700; font-size: 13px; cursor: pointer; text-decoration: underline; }

.account-card { background: var(--bg-panel); border: 1px solid var(--border-line); border-radius: var(--radius-lg); overflow: hidden; }

.ac-head { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-line); }
.ac-avatar { display: flex; align-items: center; justify-content: center; width: 44px; height: 44px; border-radius: 50%; background: var(--gov-blue); color: white; font-size: 18px; font-weight: 700; flex-shrink: 0; }
.ac-identity { flex: 1; min-width: 0; }
.ac-name  { display: block; font-size: 15px; font-weight: 700; color: var(--text-hi); }
.ac-phone { display: block; font-size: 13px; color: var(--text-lo); font-family: var(--font-mono); margin-top: 2px; }
.ac-actions { display: flex; gap: var(--sp-2); }

.ac-form { padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-line); }
.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-wide { grid-column: 1 / -1; }
.field-lbl  { font-size: 12px; font-weight: 600; color: var(--text-md); }
.field-hint { font-weight: 400; color: var(--text-lo); }
.field-input { padding: 8px 10px; border: 1px solid var(--border-line); border-radius: var(--radius-sm); background: var(--bg-panel); color: var(--text-hi); font-size: 13px; outline: none; }
.field-input:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--gov-blue-dim); }
.field-input:disabled { background: var(--bg-raised); color: var(--text-lo); cursor: not-allowed; }
.font-mono { font-family: var(--font-mono); }
.phone-row { display: flex; align-items: stretch; }
.phone-prefix { display: flex; align-items: center; padding: 0 10px; background: var(--bg-raised); border: 1px solid var(--border-line); border-right: none; border-radius: var(--radius-sm) 0 0 var(--radius-sm); font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--text-md); }
.phone-input { border-radius: 0 var(--radius-sm) var(--radius-sm) 0 !important; flex: 1; }
.consent-field { flex-direction: row; align-items: flex-start; gap: var(--sp-2); }
.consent-check { margin-top: 2px; flex-shrink: 0; width: 16px; height: 16px; accent-color: var(--gov-blue); }
.consent-text  { font-size: 13px; color: var(--text-md); line-height: 1.5; }
.form-actions  { display: flex; justify-content: flex-end; gap: var(--sp-2); margin-top: var(--sp-4); }

.ac-profile { padding: var(--sp-4) var(--sp-5); }
.profile-row { display: flex; gap: var(--sp-4); padding: var(--sp-2) 0; border-bottom: 1px solid var(--border-line); }
.profile-row:last-child { border-bottom: none; }
.pr-lbl { width: 140px; flex-shrink: 0; font-size: 12px; font-weight: 600; color: var(--text-lo); text-transform: uppercase; letter-spacing: 0.04em; padding-top: 1px; }
.pr-val { flex: 1; font-size: 14px; color: var(--text-hi); }

.lookup-card { background: var(--gov-blue-dim); border: 1px solid var(--gov-blue-border); border-radius: var(--radius-md); padding: var(--sp-4); }
.lc-title { font-size: 14px; font-weight: 600; color: var(--gov-blue-text); margin-bottom: var(--sp-1); }
.lc-body  { font-size: 13px; color: var(--text-md); line-height: 1.5; }

.privacy-note { background: var(--bg-raised); border: 1px solid var(--border-line); border-radius: var(--radius-md); padding: var(--sp-4); }
.pn-title { display: block; font-size: 13px; font-weight: 600; color: var(--text-md); margin-bottom: var(--sp-1); }
.pn-body  { font-size: 13px; color: var(--text-lo); line-height: 1.6; margin: 0; }
</style>
