<template>
  <div class="floating-icon" :style="style">{{ icon }}</div>
</template>

<script setup>
const props = defineProps({ icon: { type: String, default: '🏗️' }, animate: { type: Boolean, default: false } })
const style = { animation: props.animate ? 'float 3s ease-in-out infinite' : 'none' }
</script>

<style scoped>
@keyframes float {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-10px); }
}
</style>
