import { computed, defineComponent } from '@vue-mini/core';

defineComponent({
  properties: {
    a: String,
    b: String,
    c: String,
    d: String,
    e: String,
    f: String,
    g: String,
    h: String,
  },
  setup(props) {
    return {
      a: computed(() => props.a),
      b: computed(() => props.b),
      c: computed(() => props.c),
      d: computed(() => props.d),
      e: computed(() => props.e),
      f: computed(() => props.f),
      g: computed(() => props.g),
      h: computed(() => props.h),
    };
  },
});
