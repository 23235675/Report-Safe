<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute } from 'vue-router';
import { getShelters, createShelter, updateShelter, deleteShelter, getDisasters, getUserToken, getCurrentUser, createSafePlace, listPendingSafePlaces, moderateSafePlace } from '../api.js';
import { GOV_TOKEN_KEY } from '../router/index.js';
import AppIcon from '../components/AppIcon.vue';
import { shelterIcon, DISASTER_ICON } from '../iconography.js';
import { t, shelterTypeLabel, sourceLabel, disasterTypeLabel } from '../i18n/index.js';

const route    = useRoute();
const govToken = ref(sessionStorage.getItem(GOV_TOKEN_KEY) || '');
const isGov    = computed(() => !!govToken.value);

// A logged-in volunteer/government user can also manage shelters (server accepts
// their personal access token via allowGovOrVolunteer). Effective token = gov
// token if present, else the user's own access token.
const currentUser = ref(getCurrentUser());
const userRole    = computed(() => currentUser.value?.role || null);
const isVolunteer = computed(() => ['volunteer', 'government'].includes(userRole.value));
/** Who can create/edit/delete shelters: gov-token holders OR volunteer/gov users. */
const canManage   = computed(() => isGov.value || isVolunteer.value);
/** Token sent on shelter writes. */
const token       = computed(() => govToken.value || getUserToken() || '');
/** Any logged-in user (incl. citizens) can SUGGEST a safe place. */
const isLoggedIn  = computed(() => !!currentUser.value);

// Citizen "suggest a safe place" modal.
const showSafeForm = ref(false);
const safeForm = ref({ name: '', lat: '', lng: '', description: '', capacity: '' });
const safeError = ref('');
const safeSaving = ref(false);
const safeSuccess = ref('');

function openSafePlace() {
  safeForm.value = { name: '', lat: '', lng: '', description: '', capacity: '' };
  safeError.value = ''; safeSuccess.value = '';
  showSafeForm.value = true;
}

function useMyLocation() {
  if (!navigator.geolocation) { safeError.value = t('shelters.errNoGeo'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => { safeForm.value.lat = pos.coords.latitude.toFixed(5); safeForm.value.lng = pos.coords.longitude.toFixed(5); },
    () => { safeError.value = t('shelters.errGeoFailed'); },
  );
}

async function saveSafePlace() {
  safeError.value = '';
  if (!safeForm.value.name.trim()) { safeError.value = t('shelters.errNameRequired'); return; }
  if (safeForm.value.lat === '' || safeForm.value.lng === '') { safeError.value = t('shelters.errLocationRequired'); return; }
  safeSaving.value = true;
  try {
    await createSafePlace({
      name: safeForm.value.name.trim(),
      lat: Number(safeForm.value.lat),
      lng: Number(safeForm.value.lng),
      description: safeForm.value.description.trim() || null,
      capacity: safeForm.value.capacity ? Number(safeForm.value.capacity) : null,
      disaster_id: filterDisaster.value || null,
    });
    showSafeForm.value = false;
    safeSuccess.value = t('shelters.safeSuccess');
  } catch (e) {
    safeError.value = e?.status === 401
      ? t('shelters.errSignIn')
      : (e?.details?.[0]?.message || e.message || t('shelters.errSubmit'));
  } finally {
    safeSaving.value = false;
  }
}

const shelters   = ref([]);
const disasters  = ref([]);
const loading    = ref(false);
const error      = ref('');
const filterSource = ref('');
const filterDisaster = ref(route.query.disaster_id || '');

const showForm   = ref(false);
const editTarget = ref(null);
const form = ref({ name: '', lat: '', lng: '', capacity: '', current_count: '', phone: '', address: '', contact_name: '', hours_open: '', source: 'government', type: 'shelter', disaster_id: '' });
const formError = ref('');
const saving     = ref(false);

const showCapModal = ref(false);
const capTarget    = ref(null);
const capValue     = ref('');

const filtered = computed(() => {
  let list = shelters.value;
  if (filterSource.value) list = list.filter((s) => s.source === filterSource.value);
  if (filterDisaster.value) list = list.filter((s) => s.disaster_id === filterDisaster.value);
  return list;
});

function capacityClass(s) {
  if (!s.capacity) return '';
  const ratio = s.current_count / s.capacity;
  if (ratio >= 0.9) return 'cap-critical';
  if (ratio >= 0.7) return 'cap-high';
  return 'cap-ok';
}

function capacityPct(s) {
  if (!s.capacity) return null;
  return Math.round((s.current_count / s.capacity) * 100);
}

// Pending safe-place moderation queue (gov/volunteer only).
const pendingPlaces = ref([]);

async function loadPending() {
  if (!canManage.value) { pendingPlaces.value = []; return; }
  try {
    const res = await listPendingSafePlaces(token.value);
    pendingPlaces.value = res.safe_places || [];
  } catch {
    pendingPlaces.value = [];
  }
}

async function reviewPlace(id, status) {
  try {
    await moderateSafePlace(id, status, token.value);
    await loadPending();
  } catch (e) {
    error.value = e.message;
  }
}

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const [sRes, dRes] = await Promise.all([
      getShelters({ disaster_id: filterDisaster.value || undefined, source: filterSource.value || undefined }),
      getDisasters(),
    ]);
    shelters.value  = sRes.shelters || [];
    disasters.value = (dRes.disasters || []).filter((d) => d.active);
  } catch (e) {
    error.value = e.message;
  } finally {
    loading.value = false;
  }
  loadPending();
}

function openCreate() {
  editTarget.value = null;
  form.value = { name: '', lat: '', lng: '', capacity: '', current_count: '', phone: '', address: '', contact_name: '', hours_open: '', source: 'government', type: 'shelter', disaster_id: filterDisaster.value || '' };
  formError.value = '';
  showForm.value = true;
}

function openEdit(s) {
  editTarget.value = s;
  form.value = { name: s.name, lat: s.lat, lng: s.lng, capacity: s.capacity ?? '', current_count: s.current_count ?? '', phone: s.phone ?? '', address: s.address ?? '', contact_name: s.contact_name ?? '', hours_open: s.hours_open ?? '', source: s.source || 'government', type: s.type || 'shelter', disaster_id: s.disaster_id || '' };
  formError.value = '';
  showForm.value = true;
}

async function save() {
  formError.value = '';
  saving.value = true;
  try {
    const payload = {
      name: form.value.name,
      lat: Number(form.value.lat),
      lng: Number(form.value.lng),
      source: form.value.source,
      type: form.value.type,
      capacity: form.value.capacity ? Number(form.value.capacity) : null,
      current_count: form.value.current_count !== '' ? Number(form.value.current_count) : null,
      phone: form.value.phone || null,
      address: form.value.address || null,
      contact_name: form.value.contact_name || null,
      hours_open: form.value.hours_open || null,
      disaster_id: form.value.disaster_id || null,
    };
    if (editTarget.value) {
      await updateShelter(editTarget.value.id, payload, token.value);
    } else {
      await createShelter(payload, token.value);
    }
    showForm.value = false;
    await load();
  } catch (e) {
    formError.value = e.message;
  } finally {
    saving.value = false;
  }
}

function openCapacity(s) {
  capTarget.value = s;
  capValue.value  = String(s.current_count ?? '');
  showCapModal.value = true;
}

async function saveCapacity() {
  if (!capTarget.value) return;
  try {
    await updateShelter(capTarget.value.id, { current_count: Number(capValue.value) }, token.value);
    showCapModal.value = false;
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

async function remove(id) {
  if (!confirm(t('shelters.confirmRemove'))) return;
  try {
    await deleteShelter(id, token.value);
    await load();
  } catch (e) {
    error.value = e.message;
  }
}

onMounted(load);
watch([filterSource, filterDisaster], load);
</script>

<template>
  <div class="shelters-page">
    <div class="page-header">
      <h1>{{ $t('shelters.title') }}</h1>
      <p class="subtitle">{{ $t('shelters.subtitle') }}</p>
    </div>

    <div v-if="error" class="msg msg-error msg-row">
      <AppIcon name="alert-circle" :size="16" /><span>{{ error }}</span>
    </div>

    <!-- ── Filters + Create ──────────────────────────────────────── -->
    <div class="toolbar">
      <span class="filter-ico"><AppIcon name="funnel" :size="16" /></span>
      <div class="filters">
        <select v-model="filterSource" class="filter-sel">
          <option value="">{{ $t('shelters.allSources') }}</option>
          <option value="government">{{ $t('source.government') }}</option>
          <option value="volunteer">{{ $t('source.volunteer') }}</option>
          <option value="citizen">{{ $t('source.citizen') }}</option>
        </select>
        <select v-model="filterDisaster" class="filter-sel">
          <option value="">{{ $t('shelters.allDisasters') }}</option>
          <option v-for="d in disasters" :key="d.id" :value="d.id">
            {{ disasterTypeLabel(d.type) }} — {{ d.description?.slice(0, 40) ?? d.id }}
          </option>
        </select>
      </div>
      <button v-if="canManage" @click="openCreate" class="btn btn-primary"><AppIcon name="add" :size="16" /> {{ $t('shelters.addShelter') }}</button>
      <button v-if="!canManage" @click="openSafePlace" class="btn btn-outline"><AppIcon name="add" :size="16" /> {{ $t('shelters.suggestSafePlace') }}</button>
    </div>

    <div v-if="safeSuccess" class="msg msg-success msg-row"><AppIcon name="checkmark-circle" :size="16" /><span>{{ safeSuccess }}</span></div>

    <!-- ── Pending safe-place submissions (gov/volunteer review) ──── -->
    <div v-if="canManage && pendingPlaces.length" class="pending-panel">
      <div class="pending-head">
        <AppIcon name="alert-circle" :size="16" style="color: var(--awaiting);" />
        <span>{{ $t('shelters.pendingReview', { n: pendingPlaces.length }) }}</span>
      </div>
      <div v-for="p in pendingPlaces" :key="p.id" class="pending-row">
        <div class="pending-info">
          <div class="pending-name">{{ p.name }}</div>
          <div class="pending-meta">
            <span class="font-mono">{{ Number(p.lat).toFixed(4) }}, {{ Number(p.lng).toFixed(4) }}</span>
            <span v-if="p.capacity"> · {{ $t('shelters.cap', { n: p.capacity }) }}</span>
            <span v-if="p.submitter_name"> · {{ $t('shelters.by', { name: p.submitter_name }) }}</span>
          </div>
          <div v-if="p.description" class="pending-desc">{{ p.description }}</div>
        </div>
        <div class="pending-actions">
          <button class="btn btn-sm approve-btn" @click="reviewPlace(p.id, 'approved')"><AppIcon name="checkmark" :size="14" /> {{ $t('shelters.approve') }}</button>
          <button class="btn btn-sm btn-ghost" style="color: var(--need-help);" @click="reviewPlace(p.id, 'rejected')"><AppIcon name="close" :size="14" /> {{ $t('shelters.decline') }}</button>
        </div>
      </div>
    </div>

    <!-- ── Shelters table ────────────────────────────────────────── -->
    <div class="table-wrap" v-if="!loading">
      <table class="data-table" v-if="filtered.length">
        <thead>
          <tr>
            <th>{{ $t('shelters.thName') }}</th>
            <th>{{ $t('shelters.thType') }}</th>
            <th>{{ $t('shelters.thSource') }}</th>
            <th>{{ $t('shelters.thCapacity') }}</th>
            <th>{{ $t('shelters.thPhone') }}</th>
            <th>{{ $t('shelters.thHours') }}</th>
            <th v-if="canManage">{{ $t('shelters.thActions') }}</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in filtered" :key="s.id">
            <td>
              <span class="shelter-name">{{ s.name }}</span>
              <span v-if="s.address" class="shelter-addr">{{ s.address }}</span>
            </td>
            <td><span class="type-badge inline-ico" :class="`type-${s.type}`"><AppIcon :name="shelterIcon(s.type)" :size="13" /> {{ shelterTypeLabel(s.type) }}</span></td>
            <td><span class="source-badge" :class="`src-${s.source || 'government'}`">{{ sourceLabel(s.source) }}</span></td>
            <td>
              <div v-if="s.capacity" class="cap-cell" :class="capacityClass(s)">
                <span class="cap-nums">{{ s.current_count }}/{{ s.capacity }}</span>
                <div class="cap-bar-wrap">
                  <div class="cap-bar" :style="{ width: `${Math.min(capacityPct(s), 100)}%` }"></div>
                </div>
                <span class="cap-pct">{{ capacityPct(s) }}%</span>
              </div>
              <span v-else class="text-lo">—</span>
            </td>
            <td><span class="text-mono text-sm">{{ s.phone || '—' }}</span></td>
            <td><span class="text-sm text-lo">{{ s.hours_open || '—' }}</span></td>
            <td v-if="canManage" class="actions-cell">
              <button @click="openCapacity(s)" class="btn-sm btn-outline"><AppIcon name="people" :size="13" /> {{ $t('shelters.capacity') }}</button>
              <button @click="openEdit(s)" class="btn-sm btn-outline"><AppIcon name="create" :size="13" /> {{ $t('common.edit') }}</button>
              <button @click="remove(s.id)" class="btn-sm btn-danger" :aria-label="$t('common.remove')"><AppIcon name="close" :size="13" /></button>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-else class="state-block">
        <div class="state-icon"><AppIcon name="home" :size="26" /></div>
        <p class="state-title">{{ $t('shelters.noShelters') }}</p>
        <p class="state-sub">{{ $t('shelters.noSheltersSub') }}<template v-if="canManage"> {{ $t('shelters.addOneToStart') }}</template></p>
        <button v-if="canManage" @click="openCreate" class="btn-secondary btn-sm" style="margin-top: var(--sp-2);"><AppIcon name="add" :size="14" /> {{ $t('shelters.addShelter') }}</button>
      </div>
    </div>
    <div v-else class="state-loading"><span class="spinner"></span> {{ $t('shelters.loadingShelters') }}</div>

    <!-- ── Create / Edit form modal ──────────────────────────────── -->
    <div v-if="showForm" class="modal-overlay" @click.self="showForm = false">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ editTarget ? $t('shelters.editShelter') : $t('shelters.addShelter') }}</h3>
          <button @click="showForm = false" class="modal-close" :aria-label="$t('common.close')"><AppIcon name="close" :size="16" /></button>
        </div>
        <div class="modal-body">
          <div v-if="formError" class="msg msg-error" style="margin-bottom: var(--sp-3);">{{ formError }}</div>
          <div class="form-grid">
            <label class="field field-wide">
              <span class="field-lbl">{{ $t('shelters.fName') }}</span>
              <input v-model="form.name" class="field-input" :placeholder="$t('shelters.phShelterName')" />
            </label>
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fLat') }}</span>
              <input v-model="form.lat" class="field-input font-mono" placeholder="22.302" type="number" step="any" />
            </label>
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fLng') }}</span>
              <input v-model="form.lng" class="field-input font-mono" placeholder="114.177" type="number" step="any" />
            </label>
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fType') }}</span>
              <select v-model="form.type" class="field-input">
                <option value="shelter">{{ $t('shelterType.shelter') }}</option>
                <option value="hospital">{{ $t('shelterType.hospital') }}</option>
                <option value="clinic">{{ $t('shelterType.clinic') }}</option>
                <option value="assembly">{{ $t('shelterType.assembly') }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fSource') }}</span>
              <select v-model="form.source" class="field-input">
                <option value="government">{{ $t('source.government') }}</option>
                <option value="volunteer">{{ $t('source.volunteer') }}</option>
                <option value="citizen">{{ $t('source.citizen') }}</option>
              </select>
            </label>
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fMaxCapacity') }}</span>
              <input v-model="form.capacity" class="field-input" type="number" min="0" placeholder="500" />
            </label>
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fCurrentCount') }}</span>
              <input v-model="form.current_count" class="field-input" type="number" min="0" placeholder="0" />
            </label>
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fPhone') }}</span>
              <input v-model="form.phone" class="field-input font-mono" placeholder="+886-2-1234-5678" />
            </label>
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fContactName') }}</span>
              <input v-model="form.contact_name" class="field-input" :placeholder="$t('shelters.phCoordinator')" />
            </label>
            <label class="field field-wide">
              <span class="field-lbl">{{ $t('shelters.fAddress') }}</span>
              <input v-model="form.address" class="field-input" :placeholder="$t('shelters.phAddress')" />
            </label>
            <label class="field field-wide">
              <span class="field-lbl">{{ $t('shelters.fHours') }}</span>
              <input v-model="form.hours_open" class="field-input" :placeholder="$t('shelters.phHours')" />
            </label>
            <label class="field field-wide">
              <span class="field-lbl">{{ $t('shelters.fDisaster') }}</span>
              <select v-model="form.disaster_id" class="field-input">
                <option value="">{{ $t('shelters.anyNotSpecific') }}</option>
                <option v-for="d in disasters" :key="d.id" :value="d.id">{{ disasterTypeLabel(d.type) }} — {{ d.description?.slice(0, 50) ?? d.id }}</option>
              </select>
            </label>
          </div>
        </div>
        <div class="modal-foot">
          <button @click="showForm = false" class="btn btn-ghost">{{ $t('common.cancel') }}</button>
          <button @click="save" :disabled="saving" class="btn btn-primary">{{ saving ? $t('shelters.saving') : (editTarget ? $t('shelters.saveChanges') : $t('shelters.createShelter')) }}</button>
        </div>
      </div>
    </div>

    <!-- ── Quick capacity update modal ───────────────────────────── -->
    <div v-if="showCapModal" class="modal-overlay" @click.self="showCapModal = false">
      <div class="modal modal-sm">
        <div class="modal-head">
          <h3>{{ $t('shelters.updateCapacity') }}</h3>
          <button @click="showCapModal = false" class="modal-close" :aria-label="$t('common.close')"><AppIcon name="close" :size="16" /></button>
        </div>
        <div class="modal-body">
          <p class="cap-modal-name">{{ capTarget?.name }}</p>
          <label class="field">
            <span class="field-lbl">{{ $t('shelters.currentOccupancy') }}</span>
            <input v-model="capValue" class="field-input font-mono" type="number" min="0" :max="capTarget?.capacity" />
          </label>
          <p v-if="capTarget?.capacity" class="cap-modal-max">{{ $t('shelters.maxCapacity', { n: capTarget.capacity }) }}</p>
        </div>
        <div class="modal-foot">
          <button @click="showCapModal = false" class="btn btn-ghost">{{ $t('common.cancel') }}</button>
          <button @click="saveCapacity" class="btn btn-primary">{{ $t('common.update') }}</button>
        </div>
      </div>
    </div>

    <!-- ── Citizen: suggest a safe place ─────────────────────────── -->
    <div v-if="showSafeForm" class="modal-overlay" @click.self="showSafeForm = false">
      <div class="modal">
        <div class="modal-head">
          <h3>{{ $t('shelters.suggestSafePlace') }}</h3>
          <button @click="showSafeForm = false" class="modal-close" :aria-label="$t('common.close')"><AppIcon name="close" :size="16" /></button>
        </div>
        <div class="modal-body">
          <p class="subtitle" style="margin-top:0;">{{ $t('shelters.safeShareDesc') }}</p>
          <div v-if="!isLoggedIn" class="msg msg-warn msg-row" style="margin-bottom:var(--sp-3);">
            <AppIcon name="alert-circle" :size="16" /><span>{{ $t('shelters.safeSignInWarn') }}</span>
          </div>
          <div v-if="safeError" class="msg msg-error msg-row" style="margin-bottom:var(--sp-3);">
            <AppIcon name="alert-circle" :size="16" /><span>{{ safeError }}</span>
          </div>
          <label class="field">
            <span class="field-lbl">{{ $t('shelters.fName') }}</span>
            <input v-model="safeForm.name" class="field-input" :placeholder="$t('shelters.phSafeName')" />
          </label>
          <div class="form-grid-2">
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fLat') }}</span>
              <input v-model="safeForm.lat" class="field-input font-mono" placeholder="22.30" />
            </label>
            <label class="field">
              <span class="field-lbl">{{ $t('shelters.fLng') }}</span>
              <input v-model="safeForm.lng" class="field-input font-mono" placeholder="114.17" />
            </label>
          </div>
          <button type="button" class="btn btn-ghost btn-sm" @click="useMyLocation" style="margin-bottom:var(--sp-2);">
            <AppIcon name="locate" :size="14" /> {{ $t('shelters.useMyLocation') }}
          </button>
          <label class="field">
            <span class="field-lbl">{{ $t('shelters.approxCapacity') }} <span class="field-hint">{{ $t('common.optional') }}</span></span>
            <input v-model="safeForm.capacity" class="field-input font-mono" type="number" min="1" placeholder="e.g. 50" />
          </label>
          <label class="field">
            <span class="field-lbl">{{ $t('shelters.description') }} <span class="field-hint">{{ $t('common.optional') }}</span></span>
            <textarea v-model="safeForm.description" class="field-input" rows="2" :placeholder="$t('shelters.phSafeDesc')"></textarea>
          </label>
        </div>
        <div class="modal-foot">
          <button @click="showSafeForm = false" class="btn btn-ghost">{{ $t('common.cancel') }}</button>
          <button @click="saveSafePlace" :disabled="safeSaving || !isLoggedIn" class="btn btn-primary">
            {{ safeSaving ? $t('shelters.submitting') : $t('common.submit') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.shelters-page { display: flex; flex-direction: column; gap: var(--sp-4); }

.form-grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-2); }

/* Pending safe-place moderation queue */
.pending-panel { background: var(--awaiting-dim); border: 1px solid var(--awaiting-border); border-radius: var(--radius-md); padding: var(--sp-3); }
.pending-head { display: flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 700; color: var(--awaiting); margin-bottom: var(--sp-2); }
.pending-row { display: flex; align-items: center; gap: var(--sp-3); padding: var(--sp-2) 0; border-top: 1px solid var(--awaiting-border); }
.pending-info { flex: 1; min-width: 0; }
.pending-name { font-weight: 600; color: var(--text-hi); }
.pending-meta { font-size: 12px; color: var(--text-lo); margin-top: 2px; }
.pending-desc { font-size: 12px; color: var(--text-md); margin-top: 2px; }
.pending-actions { display: flex; gap: var(--sp-2); flex-shrink: 0; }
.approve-btn { background: var(--safe); color: #fff; border: none; gap: 4px; }
.approve-btn:hover { filter: brightness(0.95); }

.toolbar { display: flex; align-items: center; gap: var(--sp-2); flex-wrap: wrap; }
.filter-ico { color: var(--text-lo); display: inline-flex; flex-shrink: 0; }
.filters { display: flex; gap: var(--sp-2); flex-wrap: wrap; flex: 1; }
.filter-sel { padding: 6px 10px; border: 1px solid var(--border-line); border-radius: var(--radius-sm); background: var(--bg-panel); color: var(--text-hi); font-size: 13px; cursor: pointer; }

.table-wrap { background: var(--bg-panel); border: 1px solid var(--border-line); border-radius: var(--radius-md); overflow: auto; }
.data-table { width: 100%; border-collapse: collapse; font-size: 13px; }
.data-table th { padding: 10px 12px; text-align: left; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-lo); background: var(--bg-raised); border-bottom: 1px solid var(--border-line); white-space: nowrap; }
.data-table td { padding: 10px 12px; border-bottom: 1px solid var(--border-line); vertical-align: middle; }
.data-table tr:last-child td { border-bottom: none; }
.data-table tr:hover td { background: var(--bg-raised); }

.shelter-name { display: block; font-weight: 600; color: var(--text-hi); }
.shelter-addr { display: block; font-size: 11px; color: var(--text-lo); margin-top: 2px; }

.type-badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: capitalize; }
.type-shelter  { background: var(--gov-blue-dim); color: var(--gov-blue-text); }
.type-hospital { background: var(--need-help-dim); color: var(--need-help); }
.type-clinic   { background: var(--injured-dim);   color: var(--injured); }
.type-assembly { background: var(--safe-dim);       color: var(--safe); }

.source-badge { padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; text-transform: capitalize; }
.src-government { background: var(--bg-raised); color: var(--text-md); border: 1px solid var(--border-strong); }
.src-volunteer  { background: var(--rescued-dim);  color: var(--rescued); }
.src-citizen    { background: var(--safe-dim);      color: var(--safe); }

.cap-cell { display: flex; align-items: center; gap: var(--sp-2); }
.cap-nums  { font-family: var(--font-mono); font-size: 12px; white-space: nowrap; }
.cap-bar-wrap { flex: 1; max-width: 60px; height: 4px; background: var(--border-line); border-radius: 2px; overflow: hidden; }
.cap-bar { height: 100%; border-radius: 2px; transition: width 0.3s; }
.cap-pct { font-size: 11px; color: var(--text-lo); white-space: nowrap; }

.cap-ok .cap-bar { background: var(--safe); }
.cap-high .cap-bar { background: var(--injured); }
.cap-critical .cap-bar { background: var(--need-help); }
.cap-critical .cap-nums { color: var(--need-help); font-weight: 700; }

.actions-cell { display: flex; gap: var(--sp-1); white-space: nowrap; }
.btn-sm { padding: 3px 8px; border-radius: var(--radius-sm); font-size: 11px; font-weight: 600; cursor: pointer; border: none; }
.btn-outline { background: var(--bg-raised); color: var(--text-md); border: 1px solid var(--border-strong); }
.btn-outline:hover { border-color: var(--gov-blue); color: var(--gov-blue); }
.btn-danger  { background: var(--need-help-dim); color: var(--need-help); border: 1px solid var(--need-help-border); }
.btn-danger:hover { background: var(--need-help); color: white; }

.empty-state { padding: var(--sp-6); text-align: center; color: var(--text-lo); font-size: 14px; }
.loading-state { padding: var(--sp-5); text-align: center; color: var(--text-lo); font-size: 14px; }

/* Modal */
.modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.4); display: flex; align-items: center; justify-content: center; z-index: 1000; padding: var(--sp-4); }
.modal { background: var(--bg-panel); border-radius: var(--radius-lg); box-shadow: var(--shadow-md); width: 100%; max-width: 560px; max-height: 90vh; overflow: auto; }
.modal-sm { max-width: 360px; }
.modal-head { display: flex; align-items: center; justify-content: space-between; padding: var(--sp-4) var(--sp-5); border-bottom: 1px solid var(--border-line); }
.modal-head h3 { margin: 0; font-size: 15px; font-weight: 700; color: var(--text-hi); }
.modal-close { background: none; border: none; cursor: pointer; font-size: 20px; color: var(--text-lo); line-height: 1; padding: 0; }
.modal-close:hover { color: var(--text-hi); }
.modal-body { padding: var(--sp-4) var(--sp-5); }
.modal-foot { display: flex; justify-content: flex-end; gap: var(--sp-2); padding: var(--sp-4) var(--sp-5); border-top: 1px solid var(--border-line); }

.form-grid { display: grid; grid-template-columns: 1fr 1fr; gap: var(--sp-3); }
.field { display: flex; flex-direction: column; gap: 4px; }
.field-wide { grid-column: 1 / -1; }
.field-lbl { font-size: 12px; font-weight: 600; color: var(--text-md); }
.field-input { padding: 7px 10px; border: 1px solid var(--border-line); border-radius: var(--radius-sm); background: var(--bg-panel); color: var(--text-hi); font-size: 13px; outline: none; }
.field-input:focus { border-color: var(--border-focus); box-shadow: 0 0 0 3px var(--gov-blue-dim); }
.font-mono { font-family: var(--font-mono); }

.cap-modal-name { font-size: 14px; font-weight: 600; color: var(--text-hi); margin: 0 0 var(--sp-3); }
.cap-modal-max  { font-size: 12px; color: var(--text-lo); margin: var(--sp-2) 0 0; }

.text-lo   { color: var(--text-lo); }
.text-sm   { font-size: 12px; }
.text-mono { font-family: var(--font-mono); }
</style>
