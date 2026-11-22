import { computed, defineComponent, ref } from '@vue-mini/core';

defineComponent({
  properties: {
    label: String,
    index: Number,
  },
  setup(props) {
    const count = ref(0);
    const bump = () => {
      count.value += 1;
    };
    return {
      label: computed(() => props.label),
      index: computed(() => props.index),
      count,
      bump,
    };
  },
});
