<script setup>
import { FonoTableFrame } from "fono-ui";

defineProps({
  headers: { required: true, type: Array },
  rows: { required: true, type: Array },
  title: { required: true, type: String },
});
</script>

<template>
  <FonoTableFrame :label="title">
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
  </FonoTableFrame>
</template>
