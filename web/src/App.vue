<script setup lang="ts">
import Library from "./pages/Library.vue";
import Reader from "./pages/Reader.vue";

const path = location.pathname;
</script>

<template>
  <Library v-if="path === '/' || path === '/index.html'" />
  <Reader v-else-if="path.startsWith('/reader')" />
  <Library v-else />
</template>
