<script setup lang="ts">
defineProps<{ icon: string }>()
</script>

<template>
  <div class="floating-icon" aria-hidden="true">{{ icon }}</div>
</template>

<style scoped>
.floating-icon {
  position: absolute;
  top: 1.2rem;
  right: 1.4rem;
  font-size: 2.2rem;
  opacity: 0.85;
  filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.35));
  animation: floatY 4s ease-in-out infinite;
  pointer-events: none;
  z-index: 5;
}
@keyframes floatY {
  0%, 100% { transform: translateY(0); }
  50%      { transform: translateY(-6px); }
}
</style>
