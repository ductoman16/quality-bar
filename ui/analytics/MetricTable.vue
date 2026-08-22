<script setup>
defineProps({
  headers: { required: true, type: Array },
  rows: { required: true, type: Array },
});
</script>

<template>
  <div class="an-scroll">
    <table>
      <thead>
        <tr>
          <th v-for="header in headers" :key="header">{{ header }}</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="(row, index) in rows" :key="index">
          <td v-for="(value, cell) in row" :key="cell">{{ value }}</td>
        </tr>
      </tbody>
    </table>
  </div>
</template>
