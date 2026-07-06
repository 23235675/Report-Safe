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
.tbl-wrap { overflow:auto; border:1px solid #d0d0d0; background:#fff; }
.tbl { width:100%; border-collapse:collapse; font-size:13px; }
.tbl th { background:#e8e8e8; color:#333; font-weight:600; font-size:12px; padding:7px 8px; border-bottom:1px solid #d0d0d0; text-align:left; white-space:nowrap; }
.tbl td { padding:6px 8px; border-bottom:1px solid #eee; vertical-align:middle; color:#222; }
.tbl tr:last-child td { border-bottom:none; }
.tbl tr:hover td { background:#f9f9f9; }
.mono { font-family:var(--font-mono); color:#555; }
.sub { color:#666; font-size:12px; }
.ts { font-size:12px; color:#666; white-space:nowrap; font-family:var(--font-mono); }
.clip { max-width:150px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.acts { white-space:nowrap; }
</style>
