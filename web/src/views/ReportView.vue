<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { submitReport } from '../api.js';
import { useOutbox } from '../composables/useOutbox.js';
import { isValidHKID, normalizeHKID } from '../hkid.js';
import AppIcon from '../components/AppIcon.vue';
import VisibilityChip from '../components/VisibilityChip.vue';
import { t } from '../i18n/index.js';

const route = useRoute();

const VALID_STATUSES = ['injured', 'need_help', 'awaiting_response', 'missing'];
const initStatus = VALID_STATUSES.includes(route.query.status) ? route.query.status : 'injured';
const initName   = route.query.name  || '';

const subjectName  = ref(initName);
const reporterName = ref('');
const status       = ref(initStatus);
const medicalNotes = ref('');
const phone        = ref('');
const personalId   = ref('');
const submitting   = ref(false);
const message      = ref(null);
const success      = ref(false);
const lastRefId    = ref(null);

const { enqueue, markSent, retryAll, pendingCount, storageUnavailable } = useOutbox();

const proxyStatuses = ['injured', 'need_help', 'awaiting_response', 'missing'];
const availableStatuses = computed(() => proxyStatuses);

const META_KEY = { injured: 'Injured', need_help: 'NeedHelp', awaiting_response: 'Awaiting', missing: 'Missing' };
function metaText(s) {
  const k = META_KEY[s] || 'Injured';
  return { label: t(`report.meta${k}Label`), sub: t(`report.meta${k}Sub`) };
}

const showNotes = computed(() => status.value === 'injured' || status.value === 'need_help');

function resetForm() {
  subjectName.value  = '';
  reporterName.value = '';
  status.value       = 'injured';
  medicalNotes.value = '';
  phone.value        = '';
  personalId.value   = '';
  message.value      = null;
}

async function onSubmit() {
  const name = subjectName.value.trim();
  if (!name) {
    message.value = { type: 'error', text: t('report.errName') };
    return;
  }
  if (!reporterName.value.trim()) {
    message.value = { type: 'error', text: t('report.errReporter') };
    return;
  }
  if (personalId.value.trim() && !isValidHKID(personalId.value)) {
    message.value = { type: 'error', text: t('report.errHkid') };
    return;
  }

  submitting.value = true;
  success.value    = false;
  message.value    = null;

  try {
    const id = crypto.randomUUID();
    const report = {
      id,
      name,
      status:        status.value,
      severity:      null,
      medical_notes: showNotes.value ? medicalNotes.value.trim() || null : null,
      phone:         phone.value.trim() || null,
      personal_id:   personalId.value.trim() ? normalizeHKID(personalId.value) : null,
      created_at:    Date.now(),
      reported_by:   'family',
      reporter_name: reporterName.value.trim(),
      user_type:     'web',
    };

    enqueue(report);

    try {
      const res = await submitReport(report);
      markSent(res.id || id);
      lastRefId.value = res.id || id;
      success.value   = true;
      resetForm();
    } catch (err) {
      const status = err?.status;
      if (status === 400 || status === 422) {
        markSent(id);
        message.value = { type: 'error', text: err?.message || t('report.errRejected') };
      } else {
        message.value = { type: 'warn', text: t('report.warnOffline') };
      }
    }
  } catch {
    message.value = { type: 'error', text: t('report.errGeneric') };
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => { try { await retryAll(); } catch {} });
</script>

<template>
  <div class="report-form-wrap resp-shell">

    <div class="form-title-block">
      <h1>{{ $t('report.title') }}</h1>
      <p>{{ $t('report.subtitle') }}</p>
    </div>

    <hr class="divider">

    <div v-if="success" class="state-block">
      <div class="state-icon is-safe"><AppIcon name="checkmark-circle" :size="32" /></div>
      <h2>{{ $t('report.submitted') }}</h2>
      <p class="state-sub">{{ $t('report.submittedSub') }}</p>
      <div class="ref-pill"><AppIcon name="shield-checkmark" :size="13" /> {{ $t('report.ref') }} {{ (lastRefId || '').slice(0, 8) }}</div>
      <button class="btn-secondary-outline" @click="success = false" style="margin-top: var(--sp-4);">
        <AppIcon name="add" :size="16" /> {{ $t('report.submitAnother') }}
      </button>
    </div>

    <template v-if="!success">
      <div v-if="storageUnavailable()" class="msg msg-warn msg-row">
        <AppIcon name="warning" :size="16" />
        <span>{{ $t('report.storageUnavailable') }}</span>
      </div>
      <div v-if="pendingCount > 0" class="outbox-badge">
        <AppIcon name="cloud-offline" :size="14" />
        {{ $t(pendingCount === 1 ? 'report.queuedOne' : 'report.queuedMany', { n: pendingCount }) }}
      </div>

      <div class="card proxy-banner">
        <span class="proxy-ico"><AppIcon name="people" :size="20" /></span>
        <div class="proxy-text">
          <h3>{{ $t('report.proxyTitle') }}</h3>
          <p>{{ $t('report.proxyBody') }}</p>
        </div>
      </div>

      <form @submit.prevent="onSubmit">

        <div class="section-label">{{ $t('report.sectionWho') }}</div>

        <div class="field-block">
          <label class="resp-question" for="subject-name">{{ $t('report.subjectName') }}</label>
          <div class="input-field-wrapper">
            <input id="subject-name" v-model="subjectName" type="text" class="input-text-clinical" :placeholder="$t('report.subjectPlaceholder')" autocomplete="name" />
          </div>
        </div>

        <div class="field-block">
          <label class="resp-question" for="reporter-name">{{ $t('report.reporterName') }}</label>
          <div class="input-field-wrapper">
            <input id="reporter-name" v-model="reporterName" type="text" class="input-text-clinical" :placeholder="$t('report.reporterPlaceholder')" autocomplete="off" />
          </div>
        </div>

        <div class="field-block">
          <label class="resp-question" for="phone">
            {{ $t('report.phoneLabel') }}
            <span class="resp-question-hint">({{ $t('report.phoneHint') }})</span>
          </label>
          <div class="input-field-wrapper">
            <input id="phone" v-model="phone" type="tel" class="input-text-clinical" placeholder="+852 ..." autocomplete="tel" />
          </div>
        </div>

        <div class="field-block">
          <label class="resp-question" for="personal-id">
            {{ $t('report.hkidLabel') }}
            <span class="resp-question-hint">({{ $t('report.hkidHint') }})</span>
          </label>
          <div class="input-field-wrapper">
            <input id="personal-id" v-model="personalId" type="text" class="input-text-clinical" placeholder="A123456(7)" autocomplete="off" style="text-transform: uppercase;" />
            <span class="field-icon-indicator">☰</span>
          </div>
        </div>

        <div class="section-label" style="margin-top: var(--sp-5);">{{ $t('report.sectionSituation') }}</div>

        <div class="field-block">
          <label class="resp-question" style="margin-bottom: var(--sp-2);">{{ $t('report.currentStatus') }}</label>
          <div class="resp-option-vertical-group">
            <label
              v-for="s in availableStatuses"
              :key="s"
              class="resp-option"
              :class="{ 'is-selected': status === s }"
            >
              <input v-model="status" type="radio" :value="s" class="hidden-radio" />
              <span class="resp-glyph"></span>
              <div class="option-label-group">
                <span class="option-title">{{ metaText(s).label }}</span>
                <span class="option-desc">{{ metaText(s).sub }}</span>
              </div>
            </label>
          </div>
        </div>

        <div v-show="showNotes" class="field-block">
          <label class="resp-question" for="notes">{{ $t('report.notesLabel') }}</label>
          <div class="input-field-wrapper">
            <textarea id="notes" v-model="medicalNotes" rows="3" class="input-text-clinical textarea-clinical" :placeholder="$t('report.notesPlaceholder')"></textarea>
          </div>
        </div>

        <div class="action-slot-bar" style="margin-top: var(--sp-5);">
          <button type="submit" :disabled="submitting" class="btn-teal-action complete-action">
            <template v-if="submitting">
              <span class="spinner"></span> {{ $t('report.submitting') }}
            </template>
            <template v-else>
              <span>✓</span> {{ $t('report.submitReport') }}
            </template>
          </button>
        </div>
      </form>

      <div v-if="message" class="msg msg-row" :class="`msg-${message.type}`" style="margin-top: var(--sp-3);">
        <AppIcon :name="message.type === 'error' ? 'alert-circle' : 'information-circle'" :size="16" />
        <span>{{ message.text }}</span>
      </div>

      <div class="report-privacy">
        <div class="rp-head"><AppIcon name="lock-closed" :size="14" /> {{ $t('report.whoCanSee') }}</div>
        <div class="rp-tiers">
          <VisibilityChip tier="coarse" />
          <VisibilityChip tier="rescue" />
        </div>
        <p class="rp-note">{{ $t('report.privacyNote') }}</p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.report-form-wrap {
  background: #ffffff;
  padding: 40px;
  border-radius: 4px;
  border: 1px solid #cbd5e1;
  max-width: 820px;
  margin: var(--sp-5) auto;
  box-shadow: 0 4px 10px rgba(0, 0, 0, 0.04);
}

/* Master Color System */
.resp-shell {
  --resp-teal-header:   #2a706d;
  --resp-teal-accent:   #0f766e;
  --resp-teal-action:   #034e4b;
  --resp-accent-dim:    #f2f8f7;
  --resp-accent-border: #99cbc8;
  --resp-accent-text:   #044e4b;
}

/* Typography Headings Layout */
.form-title-block h1 { font-size: 26px; font-weight: 700; color: #0f172a; margin: 0 0 var(--sp-2) 0; }
.form-title-block p { font-size: 13.5px; color: #334155; line-height: 1.5; margin: 0 0 var(--sp-5) 0; }
.divider { border: 0; border-top: 1px solid #cbd5e1; margin-bottom: var(--sp-5); }
.section-label { font-size: 12px; font-weight: 700; color: var(--resp-teal-accent); text-transform: uppercase; margin-bottom: var(--sp-3); letter-spacing: 0.05em; }

/* Structural Form Blocks */
.field-block { margin-bottom: var(--sp-4); }
.resp-question { font-size: 13px; font-weight: 700; color: #0f172a; display: block; margin-bottom: var(--sp-1); }
.resp-question-hint { font-size: 12px; color: #64748b; font-weight: 400; }

/* 100% Strict Input Fields Style Layout */
.input-field-wrapper { position: relative; display: flex; align-items: center; width: 100%; }
.input-text-clinical {
  width: 100%; height: 34px; border: 1px solid #cbd5e1;
  border-radius: 4px; padding: 0 var(--sp-3);
  font-size: 13.5px; color: #0f172a; box-sizing: border-box;
  background: #ffffff;
}
.input-text-clinical:focus {
  outline: none; border-color: var(--resp-teal-accent);
  box-shadow: 0 0 0 2px var(--resp-accent-dim);
}
.textarea-clinical { height: auto; padding: var(--sp-2) var(--sp-3); resize: vertical; }
.field-icon-indicator { position: absolute; right: var(--sp-3); color: #64748b; font-size: 14px; pointer-events: none; }

/* 100% Option Selection Card Styles Layout Row */
.resp-option-vertical-group { display: flex; flex-direction: column; gap: var(--sp-2); width: 100%; }
.resp-shell .resp-option {
  display: flex; align-items: center; gap: var(--sp-3);
  padding: var(--sp-2) var(--sp-3); background: #ffffff;
  border: 1px solid #cbd5e1; border-radius: 4px;
  cursor: pointer; font-size: 13px; color: #0f172a; user-select: none;
}
.resp-shell .resp-option.is-selected {
  background: var(--resp-accent-dim); border-color: var(--resp-accent-border);
  color: var(--resp-accent-text); font-weight: 600;
}
.resp-shell .resp-glyph {
  width: 14px; height: 14px; border: 1.5px solid #64748b;
  border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box; flex-shrink: 0;
}
.resp-shell .resp-option.is-selected .resp-glyph { border-color: var(--resp-teal-accent); background: var(--resp-teal-accent); }
.resp-shell .resp-option.is-selected .resp-glyph::after { content: ""; width: 4px; height: 4px; background: #ffffff; border-radius: 50%; }
.hidden-radio { position: absolute; opacity: 0; pointer-events: none; }

.option-label-group { display: flex; flex-direction: column; }
.option-title { font-size: 14px; font-weight: 700; }
.option-desc { font-size: 12px; color: #64748b; font-weight: 400; }
.resp-option.is-selected .option-desc { color: var(--resp-teal-accent); }

/* Actions Bar Trigger Group Layout */
.action-slot-bar { display: flex; gap: var(--sp-3); }
.btn-teal-action {
  background: var(--resp-teal-action); color: #ffffff; border: none;
  padding: var(--sp-2) var(--sp-4); font-size: 13px; font-weight: 600;
  border-radius: 4px; cursor: pointer; display: inline-flex; align-items: center; gap: var(--sp-2);
}
.btn-teal-action:hover { background: var(--resp-teal-accent); }
.complete-action { width: 100%; justify-content: center; height: 40px; font-size: 14px; }

/* Informational Banners and Context Cards */
.proxy-banner { display: flex; gap: var(--sp-3); padding: var(--sp-3); background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 4px; margin-bottom: var(--sp-4); }
.proxy-ico { color: var(--resp-teal-accent); display: flex; align-items: center; }
.proxy-text h3 { margin: 0; font-size: 14px; font-weight: 700; color: #0f172a; }
.proxy-text p { margin: 2px 0 0 0; font-size: 12.5px; color: #64748b; }

.report-privacy { margin-top: var(--sp-5); padding-top: var(--sp-4); border-top: 1px solid #cbd5e1; }
.rp-head { font-size: 13px; font-weight: 700; color: #0f172a; display: flex; align-items: center; gap: 6px; margin-bottom: var(--sp-2); }
.rp-tiers { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-2); }
.rp-note { font-size: 12px; color: #64748b; margin: 0; line-height: 1.4; }
.ref-pill { display: inline-flex; align-items: center; gap: var(--sp-1); background: #f1f5f9; padding: var(--sp-1) var(--sp-2); border-radius: 4px; font-size: 12px; font-weight: 600; }
</style>
