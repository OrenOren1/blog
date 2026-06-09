<script setup lang="ts">
defineProps<{ title?: string }>()
</script>

<template>
  <div class="card3d">
    <div v-if="title" class="card3d-title">{{ title }}</div>
    <div class="card3d-body"><slot /></div>
  </div>
</template>

<style scoped>
.card3d {
  background: linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02));
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 14px;
  padding: 0.9rem 1.1rem;
  transform: perspective(900px) rotateX(0deg);
  transition: transform 0.25s ease, box-shadow 0.25s ease;
  box-shadow: 0 6px 18px rgba(0, 0, 0, 0.28);
}
.card3d:hover {
  transform: perspective(900px) rotateX(2deg) translateY(-2px);
  box-shadow: 0 10px 26px rgba(0, 0, 0, 0.36);
}
.card3d-title {
  font-weight: 600;
  font-size: 0.95em;
  margin-bottom: 0.4rem;
  opacity: 0.95;
}
.card3d-body { font-size: 0.88em; line-height: 1.45; }
.card3d-body :deep(ul) { margin: 0; padding-left: 1.1rem; }
</style>
