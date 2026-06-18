<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { submitReport } from '../api.js';
import { useOutbox } from '../composables/useOutbox.js';
import { isValidHKID, normalizeHKID } from '../hkid.js';
import AppIcon from '../components/AppIcon.vue';
import VisibilityChip from '../components/VisibilityChip.vue';
import { statusIcon } from '../iconography.js';

const route = useRoute();

// 'safe' is excluded from web proxy reports — only the affected person can
// confirm their own safety, via the mobile app.
const VALID_STATUSES = ['injured', 'need_help', 'awaiting_response', 'missing'];
const initStatus = VALID_STATUSES.includes(route.query.status) ? route.query.status : 'injured';
const initName   = route.query.name  || '';

// Web is PROXY-ONLY (A6): always filing on behalf of someone else.
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

// Web is proxy-only: 'safe' is intentionally excluded — the affected person
// must confirm their own safety from the mobile app.
const proxyStatuses = ['injured', 'need_help', 'awaiting_response', 'missing'];
const availableStatuses = computed(() => proxyStatuses);

const STATUS_META = {
  injured:           { label: 'Injured',             sub: 'Needs medical attention',                    color: 'var(--injured)',    cls: 'active-injured'   },
  need_help:         { label: 'Needs Help',           sub: 'Please send rescuers to their location',     color: 'var(--need-help)',  cls: 'active-need-help' },
  awaiting_response: { label: 'Awaiting Response',   sub: 'In the disaster zone, status unconfirmed',   color: 'var(--awaiting)',   cls: 'active-awaiting'  },
  missing:           { label: 'Missing',             sub: 'Last known location was in the affected area',color: 'var(--missing)',    cls: 'active-missing'   },
};

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
    message.value = { type: 'error', text: 'Please enter the name of the person you are reporting.' };
    return;
  }
  if (!reporterName.value.trim()) {
    message.value = { type: 'error', text: 'Please enter your name as the person submitting this report.' };
    return;
  }
  if (personalId.value.trim() && !isValidHKID(personalId.value)) {
    message.value = { type: 'error', text: 'HKID looks invalid — check the format A123456(7).' };
    return;
  }

  submitting.value = true;
  success.value    = false;
  message.value    = null;

  try {
    const id = crypto.randomUUID();
    // Web proxy reports carry NO browser location (A6) — the server resolves
    // the affected person's location from their own (mobile) report.
    const report = {
      id,
      name,
      status:        status.value,
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
      // Distinguish a PERMANENT rejection (the server received it and refused —
      // bad data) from a TRANSIENT failure (offline / server down). A 4xx will
      // never succeed on retry, so drop it from the queue and show the real
      // reason instead of pretending it's queued for later.
      const status = err?.status;
      if (status && status >= 400 && status < 500) {
        markSent(id); // remove from outbox — retrying won't help
        message.value = {
          type: 'error',
          text: err?.message || 'The server rejected this report. Please check the details and try again.',
        };
      } else {
        message.value = {
          type: 'warn',
          text: 'No connection to the server — saved offline and will be delivered when connectivity returns.',
        };
      }
    }
  } catch {
    message.value = { type: 'error', text: 'Something went wrong. Your report has been saved locally.' };
  } finally {
    submitting.value = false;
  }
}

onMounted(async () => { try { await retryAll(); } catch {} });
</script>

<template>
  <div style="max-width: 600px; margin: 0 auto;">

    <div class="page-header">
      <h1>Submit a Report</h1>
      <p class="subtitle">
        File a report on behalf of a family member or neighbor in the affected area.
        The web portal is for proxy reports only — if you are personally affected, use the mobile app to report your own status.
      </p>
    </div>

    <!-- ── Success State ─────────────────────────────────────────── -->
    <div v-if="success" class="state-block" style="border: none; background: transparent;">
      <div class="state-icon is-safe" style="width: 84px; height: 84px;"><AppIcon name="checkmark-circle" :size="44" /></div>
      <h2 style="margin-bottom: var(--sp-1);">Report Submitted</h2>
      <p class="state-sub">The report has been filed and shared with rescue coordination teams.</p>
      <div class="ref-pill"><AppIcon name="shield-checkmark" :size="13" /> Ref {{ (lastRefId || '').slice(0, 8) }}</div>
      <button class="btn-secondary" @click="success = false" style="margin-top: var(--sp-5);">
        <AppIcon name="add" :size="16" /> Submit Another Report
      </button>
    </div>

    <template v-if="!success">
      <!-- Warnings -->
      <div v-if="storageUnavailable()" class="msg msg-warn msg-row">
        <AppIcon name="warning" :size="16" />
        <span>Local storage is unavailable — your report is held in memory only.</span>
      </div>
      <div v-if="pendingCount > 0" class="outbox-badge">
        <AppIcon name="cloud-offline" :size="14" />
        {{ pendingCount }} unsent {{ pendingCount === 1 ? 'report' : 'reports' }} queued — will send when connected
      </div>

      <!-- Web is proxy-only: every web report is filed on behalf of a relative. -->
      <div class="card" style="margin-bottom: var(--sp-5);">
        <div style="display: flex; align-items: flex-start; gap: var(--sp-3); font-size: 15px; font-weight: 600; color: var(--text-hi);">
          <span class="proxy-ico"><AppIcon name="people" :size="20" /></span>
          <div>
            Proxy report — filing on someone else's behalf
            <div style="font-size: 13px; font-weight: 400; color: var(--text-lo); margin-top: 2px;">
              Use this form to report the status of a family member or neighbor in the affected area.
              If they are safe, they should confirm it themselves via the mobile app.
            </div>
          </div>
        </div>
      </div>

      <form @submit.prevent="onSubmit">

        <!-- Subject name -->
        <div class="field">
          <label for="subject-name">Name of the person you are reporting</label>
          <input
            id="subject-name"
            v-model="subjectName"
            type="text"
            placeholder="e.g. Wei Chen"
            autocomplete="name"
          />
        </div>

        <!-- Reporter name -->
        <div class="field">
          <label for="reporter-name">Your name (the person submitting this report)</label>
          <input
            id="reporter-name"
            v-model="reporterName"
            type="text"
            placeholder="e.g. David Lin (brother)"
            autocomplete="off"
          />
        </div>

        <!-- Status selection -->
        <div class="field">
          <label style="margin-bottom: var(--sp-3);">Their current status</label>
          <div class="status-group">
            <label
              v-for="s in availableStatuses"
              :key="s"
              class="status-option"
              :class="{ [STATUS_META[s].cls]: status === s }"
            >
              <input v-model="status" type="radio" :value="s" />
              <span
                class="status-medallion"
                :style="status === s
                  ? { color: STATUS_META[s].color, background: 'var(--bg-panel)' }
                  : { color: 'var(--text-lo)', background: 'var(--bg-raised)' }"
              >
                <AppIcon :name="statusIcon(s)" :size="22" />
              </span>
              <div style="flex: 1;">
                <div style="font-size: 16px; font-weight: 700; line-height: 1.2;">{{ STATUS_META[s].label }}</div>
                <div style="font-size: 13px; font-weight: 400; margin-top: 3px; opacity: 0.8;">{{ STATUS_META[s].sub }}</div>
              </div>
              <AppIcon
                :name="status === s ? 'radio-on' : 'radio-off'"
                :size="20"
                :style="{ color: status === s ? STATUS_META[s].color : 'var(--border-strong)' }"
              />
            </label>
          </div>
        </div>

        <!-- Medical notes -->
        <div v-show="showNotes" class="field">
          <label for="notes">Medical Notes / Situation Details</label>
          <textarea
            id="notes"
            v-model="medicalNotes"
            rows="3"
            placeholder="Describe injuries, what help is needed, number of people..."
          ></textarea>
        </div>

        <!-- Personal ID (HKID) -->
        <div class="field">
          <label for="personal-id">
            Their HKID
            <span style="font-weight: 400; color: var(--text-lo);">(if known — helps rescue teams confirm identity)</span>
          </label>
          <input id="personal-id" v-model="personalId" type="text" placeholder="A123456(7)" autocomplete="off" style="text-transform: uppercase;" />
        </div>

        <!-- Phone -->
        <div class="field">
          <label for="phone">
            Their phone number
            <span style="font-weight: 400; color: var(--text-lo);">(if known)</span>
          </label>
          <input id="phone" v-model="phone" type="tel" placeholder="+852 ..." autocomplete="tel" />
        </div>

        <!-- Submit -->
        <button
          type="submit"
          :disabled="submitting"
          :class="['btn-xl', 'submit-btn', status === 'need_help' ? 'btn-danger' : '']"
        >
          <template v-if="submitting"><span class="spinner" style="border-top-color: #fff;"></span> Submitting…</template>
          <template v-else><AppIcon name="send" :size="18" /> Submit This Report</template>
        </button>
      </form>

      <div v-if="message" class="msg msg-row" :class="`msg-${message.type}`">
        <AppIcon :name="message.type === 'error' ? 'alert-circle' : message.type === 'warn' ? 'cloud-offline' : message.type === 'success' ? 'checkmark-circle' : 'information-circle'" :size="16" />
        <span>{{ message.text }}</span>
      </div>

      <!-- Privacy note: the two tiers this report will be visible under -->
      <div class="report-privacy">
        <div class="rp-head inline-ico"><AppIcon name="lock-closed" :size="15" /> Who can see this report</div>
        <div class="rp-tiers">
          <VisibilityChip tier="coarse" />
          <VisibilityChip tier="rescue" />
        </div>
        <p class="rp-note">
          Family &amp; public search shows approximate location only (±1 km). Exact GPS and medical
          notes are visible to authorised rescue teams only.
        </p>
      </div>
    </template>
  </div>
</template>

<style scoped>
.proxy-ico {
  display: inline-grid; place-items: center; flex-shrink: 0;
  width: 40px; height: 40px; border-radius: var(--radius-md);
  background: var(--gov-blue-dim); color: var(--gov-blue);
}
.submit-btn { gap: 8px; margin-top: var(--sp-3); }

.ref-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 5px 12px; border-radius: 20px;
  background: var(--bg-raised); border: 1px solid var(--border-line);
  font-size: 12px; font-weight: 600; color: var(--text-md);
  font-variant-numeric: tabular-nums;
}

.report-privacy {
  margin-top: var(--sp-6); padding: var(--sp-4);
  background: var(--bg-raised); border: 1px solid var(--border-line);
  border-radius: var(--radius-md);
}
.rp-head { font-size: 13px; font-weight: 700; color: var(--text-md); margin-bottom: var(--sp-3); }
.rp-tiers { display: flex; flex-wrap: wrap; gap: var(--sp-2); margin-bottom: var(--sp-2); }
.rp-note  { font-size: 12px; color: var(--text-lo); line-height: 1.6; margin: 0; }
</style>
