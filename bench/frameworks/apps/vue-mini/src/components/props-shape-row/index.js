import { computed, defineComponent } from '@vue-mini/core';

defineComponent({
  properties: {
    p1: String,
    p2: String,
    p3: String,
    p4: String,
    p5: String,
    p6: String,
    p7: String,
    p8: String,
    p9: String,
    p10: String,
    p11: String,
    p12: String,
    p13: String,
    p14: String,
    p15: String,
    p16: String,
  },
  setup(props) {
    return {
      p1: computed(() => props.p1),
      p2: computed(() => props.p2),
      p3: computed(() => props.p3),
      p4: computed(() => props.p4),
      p5: computed(() => props.p5),
      p6: computed(() => props.p6),
      p7: computed(() => props.p7),
      p8: computed(() => props.p8),
      p9: computed(() => props.p9),
      p10: computed(() => props.p10),
      p11: computed(() => props.p11),
      p12: computed(() => props.p12),
      p13: computed(() => props.p13),
      p14: computed(() => props.p14),
      p15: computed(() => props.p15),
      p16: computed(() => props.p16),
    };
  },
});
