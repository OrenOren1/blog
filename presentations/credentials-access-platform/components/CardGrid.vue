<script setup lang="ts">
const props = withDefaults(defineProps<{ cols?: number | string }>(), { cols: 3 })
</script>

<template>
  <div class="card-grid" :style="{ '--cg-cols': Number(props.cols) || 3 }">
    <slot />
  </div>
</template>

<style scoped>
.card-grid {
  display: grid;
  grid-template-columns: repeat(var(--cg-cols), minmax(0, 1fr));
  gap: 0.9rem;
  margin: 0.6rem 0;
}
</style>
