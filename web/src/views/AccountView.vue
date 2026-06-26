<script setup>
import { ref } from 'vue';
import { registerUser, loginUser, setAuthSession, clearAuthToken } from '../api.js';
import { isValidHKID, normalizeHKID, normalizePhone } from '../hkid.js';
import AppIcon from '../components/AppIcon.vue';
import { genderIcon } from '../iconography.js';
import { t } from '../i18n/index.js';

const USER_KEY = 'rs_user';

function readSavedUser() {
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
  catch { localStorage.removeItem(USER_KEY); return null; }
}
const savedUser  = ref(readSavedUser());
const mode       = ref('login');
const loginPhone = ref('');
const form       = ref({ phone: '', name: '', gender: '', personal_id: '', email: '', privacy_consent: false });
const loading    = ref(false);
const error      = ref('');
const success    = ref('');

// 使用精準的正則過濾，並直接用 v-model 綁定，避免游標跳動
function onLoginPhoneInput(e) {
  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 8);
  loginPhone.value = cleaned;
  e.target.value = cleaned; // 強制讓 DOM 的值與 ref 同步
}

function onPhoneInput(e) {
  const cleaned = e.target.value.replace(/\D/g, '').slice(0, 8);
  form.value.phone = cleaned;
  e.target.value = cleaned;
}

// 實時將 HKID 改為大寫，優化填寫體驗
function onHkidInput(e) {
  form.value.personal_id = e.target.value.toUpperCase().replace(/\s/g, '');
}

function applySession(res) {
  savedUser.value = res.user;
  localStorage.setItem(USER_KEY, JSON.stringify(res.user));
  setAuthSession(res);
  window.dispatchEvent(new Event('rs-auth-changed'));
}

async function login() {
  error.value = ''; success.value = '';
  if (loginPhone.value.length < 8) { error.value = t('account.errPhone'); return; }
  loading.value = true;
  try {
    applySession(await loginUser(normalizePhone(loginPhone.value)));
    success.value = t('account.signedIn');
  } catch (e) {
    error.value = e?.status === 404
      ? t('account.noAccount')
      : (e.message || t('account.signInFailed'));
  } finally {
    loading.value = false;
  }
}

async function register() {
  error.value = ''; success.value = '';
  if (form.value.phone.length < 8)        { error.value = t('account.errPhone'); return; }
  if (!form.value.name.trim())  { error.value = t('account.errFullName'); return; }
  if (!form.value.gender) { error.value = t('account.errGender'); return; }
  if (!form.value.personal_id.trim()) { error.value = t('account.errHkidRequired'); return; }
  if (!isValidHKID(form.value.personal_id)) {
    error.value = t('account.errHkidFormat'); return;
  }
  if (!form.value.privacy_consent) { error.value = t('account.errConsent'); return; }
  loading.value = true;
  try {
    applySession(await registerUser({
      phone:           normalizePhone(form.value.phone),
      name:            form.value.name.trim(),
      gender:          form.value.gender,
      personal_id:     normalizeHKID(form.value.personal_id),
      email:           form.value.email || null,
      privacy_consent: form.value.privacy_consent,
      user_type:       'web',
    }));
    success.value = t('account.created');
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
  window.dispatchEvent(new Event('rs-auth-changed'));
  loginPhone.value = '';
  form.value = { phone: '', name: '', gender: '', personal_id: '', email: '', privacy_consent: false };
  mode.value = 'login';
  success.value = '';
  error.value = '';
}

function switchMode(m) { mode.value = m; error.value = ''; success.value = ''; }
</script>

<template>
  <div class="account-page">
    <div class="page-header">
      <h1>{{ $t('account.title') }}</h1>
      <p class="subtitle">{{ $t('account.subtitle') }}</p>
    </div>

    <div v-if="error"   class="msg msg-error msg-row"><AppIcon name="alert-circle" :size="16" /><span>{{ error }}</span></div>
    <div v-if="success" class="msg msg-success msg-row"><AppIcon name="checkmark-circle" :size="16" /><span>{{ success }}</span></div>

    <div v-if="savedUser" class="account-card">
      <div class="ac-head">
        <div class="ac-avatar"><AppIcon :name="genderIcon(savedUser.gender)" :size="24" /></div>
        <div class="ac-identity">
          <span class="ac-name">{{ savedUser.name || $t('account.unnamed') }}</span>
          <span class="ac-phone">{{ savedUser.phone }}</span>
        </div>
        <div class="ac-actions">
          <button @click="logout" class="btn btn-ghost" style="color: var(--need-help);"><AppIcon name="log-out" :size="14" /> {{ $t('account.signOut') }}</button>
        </div>
      </div>
      <div class="ac-profile">
        <div class="profile-row"><span class="pr-lbl">{{ $t('account.phone') }}</span><span class="pr-val font-mono">{{ savedUser.phone }}</span></div>
        <div class="profile-row" v-if="savedUser.email"><span class="pr-lbl">{{ $t('account.email') }}</span><span class="pr-val">{{ savedUser.email }}</span></div>
        <div class="profile-row" v-if="savedUser.personal_id"><span class="pr-lbl">{{ $t('account.hkid') }}</span><span class="pr-val font-mono">{{ savedUser.personal_id }}</span></div>
        <div class="profile-row">
          <span class="pr-lbl">{{ $t('account.privacyConsent') }}</span>
          <span class="pr-val" :style="{ color: savedUser.privacy_consent ? 'var(--safe)' : 'var(--text-lo)' }">
            {{ savedUser.privacy_consent ? $t('account.granted') : $t('account.notGranted') }}
          </span>
        </div>
        <div class="profile-row"><span class="pr-lbl">{{ $t('account.accountType') }}</span><span class="pr-val">{{ savedUser.user_type || 'web' }}</span></div>
      </div>
    </div>

    <div v-else-if="mode === 'login'" class="auth-card">
      <div class="auth-head">
        <AppIcon name="person-circle" :size="32" style="color: var(--gov-blue);" />
        <h2 class="auth-title">{{ $t('account.signIn') }}</h2>
        <p class="auth-sub">{{ $t('account.enterPhone') }}</p>
      </div>
      <form @submit.prevent="login" class="auth-form">
        <label class="field">
          <span class="field-lbl">{{ $t('account.phoneNumber') }}</span>
          <div class="phone-row">
            <span class="phone-prefix">+852</span>
            <input :value="loginPhone" @input="onLoginPhoneInput" class="field-input font-mono phone-input" placeholder="98765432" inputmode="numeric" maxlength="8" autofocus />
          </div>
        </label>
        <button type="submit" :disabled="loading" class="btn btn-primary btn-block">
          <AppIcon v-if="!loading" name="log-in" :size="16" /> {{ loading ? $t('account.signingIn') : $t('account.signIn') }}
        </button>
      </form>
      <div class="auth-switch">
        <span>{{ $t('account.noAccountQ') }}</span>
        <button class="link-btn" @click="switchMode('register')">{{ $t('account.createNow') }}</button>
      </div>
    </div>

    <div v-else class="auth-card">
      <div class="auth-head">
        <AppIcon name="person-circle" :size="32" style="color: var(--gov-blue);" />
        <h2 class="auth-title">{{ $t('account.createAccount') }}</h2>
        <p class="auth-sub">{{ $t('account.setupProfile') }}</p>
      </div>
      <form @submit.prevent="register" class="auth-form">
        <label class="field">
          <span class="field-lbl">{{ $t('account.phoneStar') }} <span class="field-hint">{{ $t('account.phoneHint') }}</span></span>
          <div class="phone-row">
            <span class="phone-prefix">+852</span>
            <input :value="form.phone" @input="onPhoneInput" class="field-input font-mono phone-input" placeholder="98765432" inputmode="numeric" maxlength="8" />
          </div>
        </label>
        <label class="field">
          <span class="field-lbl">{{ $t('account.fullNameStar') }}</span>
          <input v-model="form.name" class="field-input" :placeholder="$t('account.fullNamePlaceholder')" />
        </label>
        <label class="field">
          <span class="field-lbl">{{ $t('account.genderStar') }}</span>
          <select v-model="form.gender" class="field-input">
            <option value="" disabled>{{ $t('account.genderSelect') }}</option>
            <option value="male">{{ $t('account.genderMale') }}</option>
            <option value="female">{{ $t('account.genderFemale') }}</option>
          </select>
        </label>
        <label class="field">
          <span class="field-lbl">{{ $t('account.hkidStar') }} <span class="field-hint">{{ $t('account.hkidHint') }}</span></span>
          <input :value="form.personal_id" @input="onHkidInput" class="field-input font-mono" placeholder="A123456" autocomplete="off" style="text-transform: uppercase;" />
        </label>
        <label class="field">
          <span class="field-lbl">{{ $t('account.email') }} <span class="field-hint">{{ $t('account.emailHint') }}</span></span>
          <input v-model="form.email" class="field-input" type="email" placeholder="name@example.com" />
        </label>
        <label class="field consent-field">
          <input v-model="form.privacy_consent" type="checkbox" class="consent-check" />
          <span class="consent-text">{{ $t('account.consent') }}</span>
        </label>
        <button type="submit" :disabled="loading" class="btn btn-primary btn-block">
          <AppIcon v-if="!loading" name="checkmark" :size="15" /> {{ loading ? $t('account.creating') : $t('account.createAccount') }}
        </button>
      </form>
      <div class="auth-switch">
        <span>{{ $t('account.haveAccountQ') }}</span>
        <button class="link-btn" @click="switchMode('login')">{{ $t('account.signIn') }}</button>
      </div>
    </div>

    <div class="privacy-note">
      <span class="pn-title inline-ico"><AppIcon name="shield-checkmark" :size="15" style="color: var(--gov-blue);" /> {{ $t('account.privacyTitle') }}</span>
      <p class="pn-body">{{ $t('account.privacyBody') }}</p>
    </div>
  </div>
</template>

<style scoped>
.account-page { display: flex; flex-direction: column; gap: var(--sp-5); max-width: 600px; }

/* Login / register box */
.auth-card { background: var(--bg-panel); border: 1px solid var(--border-line); border-radius: var(--radius-lg); padding: var(--sp-6); max-width: 560px; width: 100%; margin: 0 auto; }
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
