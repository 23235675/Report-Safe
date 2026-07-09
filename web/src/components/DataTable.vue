<script setup>
// Generic grey-header table shell (Admin console styling). Columns drive the
// header row and default cell rendering; complex cells (badges, action
// buttons, inline selects) override via scoped slots named `cell-<key>`.
//
// Column shape: { key, label, format?(value, row), tdClass?, title?(row) }
//  - format:  returns the cell text (default: raw row[key], like `{{ row[key] }}`)
//  - tdClass: extra class(es) on the <td> (e.g. 'mono', 'ts', 'clip')
//  - title:   value for the <td> title attribute (e.g. full id on hover)
defineProps({
  columns: { type: Array, required: true },
  rows:    { type: Array, required: true },
  rowKey:  { type: String, default: 'id' },
});
</script>

<template>
  <div class="tbl-wrap">
    <table class="tbl">
      <thead>
        <tr><th v-for="c in columns" :key="c.key" scope="col">{{ c.label }}</th></tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="row[rowKey]">
          <td v-for="c in columns" :key="c.key" :class="c.tdClass" :title="c.title ? c.title(row) : undefined"><slot :name="`cell-${c.key}`" :row="row" :value="row[c.key]">{{ c.format ? c.format(row[c.key], row) : row[c.key] }}</slot></td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<style scoped>
.tbl-wrap { overflow:auto; border:1px solid #e9e9ec; background:#fff; border-radius:14px; box-shadow:0 1px 3px rgba(0,0,0,0.04); }
.tbl { width:100%; border-collapse:collapse; font-size:13px; }
.tbl th { background:#fafafb; color:#8a8b93; font-weight:600; font-size:11.5px; letter-spacing:0.03em; text-transform:uppercase; padding:14px 24px; border-bottom:1px solid #e9e9ec; text-align:left; white-space:nowrap; position:sticky; top:0; z-index:1; }
.tbl td { padding:18px 24px; border-bottom:1px solid #f0f0f2; vertical-align:middle; color:#3a3a41; }
.tbl tbody tr:last-child td { border-bottom:none; }
.tbl tbody tr:hover td { background:#f7f7f9; }
.mono { font-family:var(--font-mono); color:#8a8b93; font-size:12px; }
.sub { color:#9a9ba3; font-size:12px; }
.ts { font-size:12px; color:#9a9ba3; white-space:nowrap; font-family:var(--font-mono); }
.clip { max-width:180px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acts { white-space:nowrap; text-align:right; }
.acts :deep(.btn) { margin-left:6px; }
</style>
