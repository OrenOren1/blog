<template>
  <div class="glass-card">
    <slot />
  </div>
</template>

<style scoped>
.glass-card {
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 14px;
  padding: 1.1rem 1.4rem;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.25);
  margin: 0.6rem 0;
}
.glass-card :deep(ul) { margin: 0; padding-left: 1.2rem; }
.glass-card :deep(li) { margin: 0.25rem 0; }
</style>
