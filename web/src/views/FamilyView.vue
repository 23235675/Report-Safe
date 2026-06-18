<script setup>
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useRouter } from 'vue-router';
import {
  searchByName, listLovedOnes, addLovedOne, confirmLovedOne, removeLovedOne, currentUserId,
} from '../api.js';
import AppIcon from '../components/AppIcon.vue';
import StatusIcon from '../components/StatusIcon.vue';
import StatusBadge from '../components/StatusBadge.vue';
import VisibilityChip from '../components/VisibilityChip.vue';
import { statusColor } from '../iconography.js';

const router = useRouter();

/* ── Loved ones (real account links) ─────────────────────────────── */
const hasAccount  = ref(!!currentUserId());
const links       = ref([]);
const linksLoading = ref(false);
const linksError  = ref(null);
const addPhone    = ref('');
const adding      = ref(false);
const notice      = ref(null);

const confirmed = computed(() => links.value.filter((l) => l.link_status === 'confirmed'));
const incoming  = computed(() => links.value.filter((l) => l.link_status === 'pending' && l.is_incoming));
const outgoing  = computed(() => links.value.filter((l) => l.link_status === 'pending' && !l.is_incoming));

async function loadLinks() {
  const uid = currentUserId();
  hasAccount.value = !!uid;
  if (!uid) { links.value = []; return; }
  linksLoading.value = true;
  linksError.value = null;
  try {
    const res = await listLovedOnes();
    links.value = res.links || [];
  } catch {
    linksError.value = 'Could not load your loved ones.';
  } finally {
    linksLoading.value = false;
  }
}

async function onAdd() {
  const phone = addPhone.value.trim();
  if (!phone) return;
  adding.value = true;
  notice.value = null;
  try {
    await addLovedOne(phone);
    addPhone.value = '';
    notice.value = 'Request sent. They’ll appear here once they confirm.';
    await loadLinks();
  } catch (e) {
    const detail = e?.details?.[0]?.message;
    notice.value =
      e?.status === 404 ? 'No account found for that number. They need to register first.'
      : e?.status === 400 ? (detail || e.message || 'That number can’t be linked.')
      : e?.status === 429 ? 'Too many link requests — please wait a bit and try again.'
      : 'Could not send the request. Please try again.';
  } finally {
    adding.value = false;
  }
}

async function onConfirm(linkId) {
  try { await confirmLovedOne(linkId); await loadLinks(); }
  catch { notice.value = 'Could not confirm. Try again.'; }
}

async function onRemoveLink(link) {
  if (!confirm(`Stop sharing status with ${link.name || link.phone}?`)) return;
  try { await removeLovedOne(link.link_id); await loadLinks(); }
  catch { notice.value = 'Could not remove. Try again.'; }
}

/* ── Name search ─────────────────────────────────────────────────── */
const query    = ref('');
const results  = ref([]);
const loading  = ref(false);
const searched = ref(false);
const error    = ref(null);

async function onSearch(nameOverride) {
  const q = (nameOverride ?? query.value).trim();
  if (!q) return;
  query.value    = q;
  loading.value  = true;
  error.value    = null;
  searched.value = true;
  try {
    const res     = await searchByName(q);
    results.value = res.results || [];
  } catch {
    error.value   = 'Search failed. Please try again.';
    results.value = [];
  } finally {
    loading.value = false;
  }
}

function reportOnBehalf(name) {
  router.push({ path: '/report', query: { proxy: '1', name } });
}

function relativeTime(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1)  return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
}

const ALERT_STATUSES = new Set(['need_help', 'awaiting_response', 'potentially_missing', 'missing']);
function isAlert(s) { return ALERT_STATUSES.has(s); }

// Keep the list fresh so a recipient sees a new incoming request without a manual
// reload: refresh on tab focus and poll every 20s while the page is open.
function onFocus() { loadLinks(); }
let pollTimer = null;
onMounted(() => {
  loadLinks();
  window.addEventListener('focus', onFocus);
  pollTimer = setInterval(() => { if (hasAccount.value) loadLinks(); }, 20000);
});
onUnmounted(() => {
  window.removeEventListener('focus', onFocus);
  if (pollTimer) clearInterval(pollTimer);
});
</script>

<template>
  <div style="max-width: 720px; margin: 0 auto;">

    <div class="page-header">
      <h1>Find a Loved One</h1>
      <p class="subtitle">
        Link the people you care about by phone. Once they confirm, you’ll see their status here and be
        alerted if they’re ever in a disaster zone.
      </p>
    </div>

    <!-- ── Loved Ones ─────────────────────────────────────────────── -->
    <div class="section-label inline-ico"><AppIcon name="heart" :size="13" style="color: var(--gov-blue);" /> Loved Ones{{ confirmed.length ? ` (${confirmed.length})` : '' }}</div>

    <!-- Account gate -->
    <div v-if="!hasAccount" class="state-block">
      <div class="state-icon is-info"><AppIcon name="person-circle" :size="26" /></div>
      <p class="state-title">Set up your account first</p>
      <p class="state-sub">Loved ones are linked by phone number, so we need your account before you can add them.</p>
      <button class="btn-primary btn-sm" style="margin-top: var(--sp-2);" @click="router.push('/account')">
        <AppIcon name="arrow-forward" :size="14" /> Go to Account
      </button>
    </div>

    <template v-else>
      <div v-if="notice" class="msg msg-info msg-row" style="margin-bottom: var(--sp-3);">
        <AppIcon name="information-circle" :size="16" /><span>{{ notice }}</span>
      </div>

      <!-- Add by phone -->
      <form class="search-form" @submit.prevent="onAdd">
        <div class="search-field">
          <AppIcon name="call" :size="16" style="color: var(--text-lo);" />
          <input v-model="addPhone" type="tel" placeholder="Add a loved one by phone…" autocomplete="off" />
        </div>
        <button type="submit" :disabled="adding" class="search-btn">
          <span v-if="adding" class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></span>
          <template v-else><AppIcon name="person-add" :size="16" /> Add</template>
        </button>
      </form>

      <div v-if="linksLoading && links.length === 0" class="state-loading"><span class="spinner"></span> Loading…</div>
      <div v-else-if="linksError" class="msg msg-error msg-row"><AppIcon name="alert-circle" :size="16" /><span>{{ linksError }}</span></div>

      <!-- Confirmed loved ones -->
      <div v-if="confirmed.length > 0" class="list" style="margin-bottom: var(--sp-4);">
        <div
          v-for="l in confirmed"
          :key="l.link_id"
          class="report-card"
          :class="isAlert(l.report_status) ? 'alert-card' : ''"
          :style="{ borderLeftColor: isAlert(l.report_status) ? statusColor(l.report_status) : undefined, flexDirection: 'column', alignItems: 'stretch', gap: 'var(--sp-3)' }"
        >
          <div style="display: flex; align-items: center; gap: var(--sp-3);">
            <StatusIcon v-if="l.report_status" :status="l.report_status" :size="40" :icon="20" />
            <span v-else class="watch-avatar">{{ (l.name || l.phone).charAt(0).toUpperCase() }}</span>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 16px; font-weight: 700; color: var(--text-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ l.name || l.phone }}</div>
              <div style="font-size: 12px; color: var(--text-lo); margin-top: 3px;">
                <span v-if="l.report_status" class="inline-ico"><AppIcon name="time" :size="13" /> {{ l.status_updated_at ? relativeTime(l.status_updated_at) : 'updated' }}</span>
                <span v-else>No status reported yet</span>
              </div>
            </div>
            <StatusBadge v-if="l.report_status" :status="l.report_status" />
            <span v-else class="no-report-chip">No report</span>
          </div>
          <div style="display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap;">
            <VisibilityChip tier="coarse" :short="true" />
            <span style="flex: 1;"></span>
            <button class="btn-ghost btn-sm" style="color: var(--gov-blue);" @click="reportOnBehalf(l.name)"><AppIcon name="create" :size="14" /> Report</button>
            <button class="btn-ghost btn-sm" aria-label="Remove loved one" @click="onRemoveLink(l)"><AppIcon name="close" :size="14" /></button>
          </div>
        </div>
      </div>

      <p v-else-if="!linksLoading && !linksError" class="empty-hint">
        No loved ones yet. Add someone by their phone number above — once they confirm, you’ll see their status here.
      </p>

      <!-- Incoming requests -->
      <template v-if="incoming.length > 0">
        <div class="section-label inline-ico" style="margin-top: var(--sp-4);"><AppIcon name="mail-unread" :size="13" style="color: var(--awaiting);" /> Requests for you ({{ incoming.length }})</div>
        <div class="list">
          <div v-for="l in incoming" :key="l.link_id" class="card req-row">
            <span class="watch-avatar">{{ (l.name || l.phone).charAt(0).toUpperCase() }}</span>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 700; color: var(--text-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ l.name || l.phone }}</div>
              <div style="font-size: 12px; color: var(--text-lo);">wants to connect</div>
            </div>
            <button class="btn-sm confirm-btn" @click="onConfirm(l.link_id)"><AppIcon name="checkmark" :size="14" /> Confirm</button>
            <button class="btn-ghost btn-sm" aria-label="Decline" @click="onRemoveLink(l)"><AppIcon name="close" :size="14" /></button>
          </div>
        </div>
      </template>

      <!-- Outgoing pending -->
      <template v-if="outgoing.length > 0">
        <div class="section-label inline-ico" style="margin-top: var(--sp-4);"><AppIcon name="time" :size="13" /> Awaiting confirmation ({{ outgoing.length }})</div>
        <div class="list">
          <div v-for="l in outgoing" :key="l.link_id" class="card req-row">
            <span class="watch-avatar" style="background: var(--bg-raised); color: var(--text-lo);">{{ (l.name || l.phone).charAt(0).toUpperCase() }}</span>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 700; color: var(--text-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ l.name || l.phone }}</div>
              <div style="font-size: 12px; color: var(--text-lo);">request sent</div>
            </div>
            <button class="btn-ghost btn-sm" @click="onRemoveLink(l)">Cancel</button>
          </div>
        </div>
      </template>
    </template>

    <!-- ── Name / phone search ────────────────────────────────────── -->
    <div class="section-label inline-ico" style="margin-top: var(--sp-6);"><AppIcon name="search" :size="13" /> Search by name or phone</div>
    <p class="subtitle" style="margin: 0 0 var(--sp-3);">
      Find any registered person by their real name (e.g. “Chan Tai Man”) or their 8-digit phone number — even if they’re not linked to you — to check on them or file a report on their behalf.
    </p>

    <form class="search-form" @submit.prevent="() => onSearch()">
      <div class="search-field">
        <AppIcon name="search" :size="18" style="color: var(--text-lo);" />
        <input v-model="query" type="search" placeholder="Name or phone number…" autocomplete="off" />
      </div>
      <button type="submit" :disabled="loading" class="search-btn">
        <span v-if="loading" class="spinner" style="width: 16px; height: 16px; border-width: 2px;"></span>
        <template v-else><AppIcon name="arrow-forward" :size="18" /> Search</template>
      </button>
    </form>

    <div v-if="loading" class="state-loading"><span class="spinner"></span> Searching…</div>

    <div v-else-if="error" class="state-block">
      <div class="state-icon is-error"><AppIcon name="alert-circle" :size="26" /></div>
      <p class="state-title">Search failed</p>
      <p class="state-sub">{{ error }}</p>
      <button class="btn-secondary btn-sm" @click="onSearch()" style="margin-top: var(--sp-2);"><AppIcon name="refresh" :size="14" /> Try again</button>
    </div>

    <div v-else-if="searched && results.length === 0" class="state-block">
      <div class="state-icon is-warn"><AppIcon name="search" :size="26" /></div>
      <p class="state-title">No one found for “{{ query }}”</p>
      <p class="state-sub">No registered account matches that name or phone number. You can file a report on their behalf so rescue teams know to look.</p>
      <button class="btn-secondary btn-sm" @click="reportOnBehalf(query)" style="margin-top: var(--sp-2);">
        <AppIcon name="person-add" :size="14" /> Report {{ query }} as Missing
      </button>
    </div>

    <div v-else-if="results.length > 0">
      <div class="section-label inline-ico"><AppIcon name="list" :size="13" /> Search Results ({{ results.length }})</div>
      <div class="list">
        <div
          v-for="r in results"
          :key="r.id"
          class="report-card"
          :class="isAlert(r.status) ? 'alert-card' : ''"
          :style="{ borderLeftColor: isAlert(r.status) ? statusColor(r.status) : undefined, flexDirection: 'column', alignItems: 'stretch', gap: 'var(--sp-3)' }"
        >
          <div style="display: flex; align-items: center; gap: var(--sp-3);">
            <StatusIcon v-if="r.status" :status="r.status" :size="40" :icon="20" />
            <span v-else class="watch-avatar">{{ (r.name || '?').charAt(0).toUpperCase() }}</span>
            <div style="flex: 1; min-width: 0;">
              <div style="font-size: 16px; font-weight: 700; color: var(--text-hi); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">{{ r.name }}</div>
              <div style="font-size: 12px; color: var(--text-lo); margin-top: 3px; display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap;">
                <span v-if="r.phone_masked" class="inline-ico"><AppIcon name="call" :size="13" /> {{ r.phone_masked }}</span>
                <template v-if="r.status">
                  <span>·</span>
                  <span class="inline-ico"><AppIcon name="time" :size="13" /> {{ relativeTime(r.updated_at) }}</span>
                  <span v-if="r.coarse_lat != null">·</span>
                  <span v-if="r.coarse_lat != null" class="inline-ico"><AppIcon name="globe" :size="13" /> ~{{ r.coarse_lat }}, {{ r.coarse_lng }}</span>
                  <span v-if="r.reported_by === 'family'" class="inline-ico" style="color: var(--awaiting);">
                    · <AppIcon name="people" :size="13" /> via {{ r.reporter_name || 'family member' }}
                  </span>
                </template>
                <span v-else>· No status reported yet</span>
              </div>
            </div>
            <StatusBadge v-if="r.status" :status="r.status" />
            <span v-else class="no-report-chip">No report</span>
          </div>
          <div style="display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap;">
            <VisibilityChip tier="coarse" :short="true" />
            <span style="flex: 1;"></span>
            <button v-if="isAlert(r.status)" class="btn-sm update-btn" @click="reportOnBehalf(r.name)">
              <AppIcon name="create" :size="14" /> Update Status
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Privacy note -->
    <div class="privacy-note msg-row">
      <AppIcon name="lock-closed" :size="16" style="color: var(--text-lo);" />
      <span>
        Loved ones see only approximate location (±1 km) and status — never exact GPS or medical notes.
        Both people must confirm a link before any status is shared.
      </span>
    </div>
  </div>
</template>

<style scoped>
.search-form { display: flex; gap: var(--sp-2); margin-bottom: var(--sp-4); }
.search-field {
  flex: 1; display: flex; align-items: center; gap: var(--sp-2);
  padding: 0 var(--sp-3); background: var(--bg-panel);
  border: 1px solid var(--border-line); border-radius: var(--radius-md);
}
.search-field:focus-within { border-color: var(--border-focus); box-shadow: 0 0 0 3px rgb(59 130 246 / 0.10); }
.search-field input { border: none; box-shadow: none; padding: 10px 0; background: transparent; }
.search-field input:focus { box-shadow: none; }
.search-btn { flex-shrink: 0; padding: 0 var(--sp-4); gap: 6px; }

.watch-avatar {
  display: inline-grid; place-items: center; flex-shrink: 0;
  width: 36px; height: 36px; border-radius: 50%;
  background: var(--gov-blue-dim); color: var(--gov-blue-text);
  font-size: 15px; font-weight: 700;
}
.req-row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-3) var(--sp-4); }
.confirm-btn { background: var(--safe); color: #fff; border: none; gap: 4px; }
.confirm-btn:hover { filter: brightness(0.95); }
.no-report-chip {
  font-size: 11px; font-weight: 700; color: var(--text-lo);
  background: var(--bg-raised); border: 1px solid var(--border-line);
  border-radius: 999px; padding: 4px 9px; align-self: center;
}
.empty-hint { font-size: 13px; color: var(--text-lo); line-height: 1.6; margin: 0 0 var(--sp-3); }
.update-btn { background: var(--awaiting-dim); color: var(--awaiting); border: 1px solid var(--awaiting-border); gap: 4px; }
.update-btn:hover { background: var(--awaiting); color: #fff; }
.btn-ghost { gap: 4px; }

.privacy-note {
  margin-top: var(--sp-6); padding: var(--sp-3) var(--sp-4);
  background: var(--bg-raised); border: 1px solid var(--border-line);
  border-radius: var(--radius-md); font-size: 13px; color: var(--text-lo); line-height: 1.6;
}
</style>
