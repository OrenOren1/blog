<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useNav } from '@slidev/client'

const { slides, currentSlideNo, go } = useNav()

const open = ref(false)
const isPresenter = ref(false)

function updatePresenter() {
  if (typeof window !== 'undefined') {
    isPresenter.value = window.location.pathname.includes('/presenter')
  }
}

function toggle() { open.value = !open.value }
function close() { open.value = false }
function jump(n: number) { go(n); close() }

function onDocClick(e: MouseEvent) {
  const root = (e.target as HTMLElement)?.closest?.('.deck-menu')
  if (!root) close()
}
function onKey(e: KeyboardEvent) { if (e.key === 'Escape') close() }

onMounted(() => {
  updatePresenter()
  window.addEventListener('popstate', updatePresenter)
  document.addEventListener('click', onDocClick)
  document.addEventListener('keydown', onKey)
})
onBeforeUnmount(() => {
  window.removeEventListener('popstate', updatePresenter)
  document.removeEventListener('click', onDocClick)
  document.removeEventListener('keydown', onKey)
})

const items = computed(() =>
  slides.value.map((s, i) => ({
    no: i + 1,
    title: s?.meta?.slide?.title || s?.meta?.slide?.frontmatter?.title || `Slide ${i + 1}`,
  })),
)
</script>

<template>
  <div v-if="isPresenter" class="deck-menu" :class="{ 'is-open': open }">
    <button
      class="deck-menu__trigger"
      type="button"
      :aria-expanded="open"
      aria-haspopup="menu"
      :aria-label="open ? 'Minimize slide list' : 'Expand slide list'"
      :title="open ? 'Minimize' : 'Expand slide list'"
      @click.stop="toggle"
    >
      <span class="deck-menu__bars" aria-hidden="true">
        <i></i><i></i><i></i>
      </span>
      <span class="deck-menu__count">{{ currentSlideNo }} / {{ slides.length }}</span>
    </button>

    <div v-if="open" class="deck-menu__panel" role="menu" @click.stop>
      <div class="deck-menu__header">Slides</div>
      <ul class="deck-menu__list">
        <li
          v-for="it in items"
          :key="it.no"
          :class="{ active: it.no === currentSlideNo }"
        >
          <button type="button" @click="jump(it.no)">
            <span class="deck-menu__no">{{ it.no }}</span>
            <span class="deck-menu__title">{{ it.title }}</span>
          </button>
        </li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.deck-menu {
  position: fixed;
  top: 0.7rem;
  right: 0.9rem;
  z-index: 9000;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
  pointer-events: auto;
}

.deck-menu__trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.35rem 0.65rem 0.35rem 0.55rem;
  background: rgba(15, 15, 15, 0.6);
  color: #e6edf3;
  border: 1px solid rgba(126, 255, 245, 0.25);
  border-radius: 999px;
  font-size: 0.76rem;
  font-weight: 600;
  cursor: pointer;
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  transition: background 0.15s ease, border-color 0.15s ease;
}
.deck-menu__trigger:hover {
  background: rgba(126, 255, 245, 0.12);
  border-color: rgba(126, 255, 245, 0.55);
}
.deck-menu.is-open .deck-menu__trigger {
  background: rgba(126, 255, 245, 0.18);
  border-color: rgba(126, 255, 245, 0.7);
}

.deck-menu__bars {
  display: inline-flex;
  flex-direction: column;
  justify-content: space-between;
  width: 13px;
  height: 9px;
}
.deck-menu__bars i {
  display: block;
  height: 2px;
  background: currentColor;
  border-radius: 1px;
}
.deck-menu__count {
  font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
  opacity: 0.9;
}

.deck-menu__panel {
  position: absolute;
  top: calc(100% + 0.5rem);
  right: 0;
  width: 320px;
  max-height: min(72vh, 560px);
  overflow: auto;
  background: rgba(12, 12, 12, 0.94);
  color: #fff;
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 12px;
  box-shadow: 0 18px 40px rgba(0, 0, 0, 0.55);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  animation: deckMenuIn 0.14s ease-out;
}
@keyframes deckMenuIn {
  from { opacity: 0; transform: translateY(-4px) scale(0.98); }
  to   { opacity: 1; transform: none; }
}

.deck-menu__header {
  padding: 0.55rem 0.9rem 0.35rem;
  font-size: 0.7rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: rgba(126, 255, 245, 0.95);
  font-weight: 700;
}

.deck-menu__list {
  list-style: none;
  margin: 0;
  padding: 0.25rem 0.35rem 0.45rem;
}
.deck-menu__list li { margin: 0; }
.deck-menu__list button {
  display: grid;
  grid-template-columns: 2rem 1fr;
  align-items: center;
  width: 100%;
  text-align: left;
  padding: 0.4rem 0.55rem;
  background: transparent;
  color: #f0f0f0;
  border: 0;
  border-radius: 8px;
  font-size: 0.84rem;
  cursor: pointer;
}
.deck-menu__list button:hover {
  background: rgba(255, 255, 255, 0.06);
}
.deck-menu__list li.active button {
  background: rgba(126, 255, 245, 0.16);
  color: #fff;
}
.deck-menu__no {
  color: rgba(126, 255, 245, 0.9);
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  font-size: 0.76rem;
  text-align: right;
  padding-right: 0.45rem;
}
.deck-menu__title {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
