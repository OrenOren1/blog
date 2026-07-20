<template>
  <div :style="gridStyle">
    <slot />
  </div>
</template>

<script setup>
const props = defineProps({ cols: { type: Number, default: 3 } })
const gridStyle = {
  display: 'grid',
  gridTemplateColumns: `repeat(${props.cols}, 1fr)`,
  gap: '1em',
  marginTop: '0.8em'
}
</script>
